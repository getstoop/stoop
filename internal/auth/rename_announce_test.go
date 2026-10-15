package auth_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

type renameLog struct{ userIDs []string }

func (r *renameLog) AnnounceRename(_ context.Context, userID string) {
	r.userIDs = append(r.userIDs, userID)
}

// Every way a username changes is announced, and a save that keeps it
// is not.
func TestRenamesAreAnnounced(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	renames := &renameLog{}
	svc.UseRenameAnnouncer(renames)
	casey, _ := signIn(t, svc, "casey", "correct horse battery")
	caseyID := authctx.UserID(casey)
	bg := context.Background()

	profile := func(username *string) {
		t.Helper()
		if _, err := svc.UpdateProfile(casey, connect.NewRequest(&authv1.UpdateProfileRequest{
			DisplayName: "Casey", Username: username,
		})); err != nil {
			t.Fatal(err)
		}
	}
	same, renamed := "casey", "casey_k"
	profile(nil)
	profile(&same)
	if len(renames.userIDs) != 0 {
		t.Fatalf("a save that kept the username was announced: %v", renames.userIDs)
	}
	profile(&renamed)

	admin := "casey_admin"
	if _, err := svc.RenameAccount(bg, caseyID, &admin, nil); err != nil {
		t.Fatal(err)
	}
	display := "Casey K"
	if _, err := svc.RenameAccount(bg, caseyID, nil, &display); err != nil {
		t.Fatal(err)
	}

	bot, err := svc.CreateBot(bg, "uptime", "Uptime")
	if err != nil {
		t.Fatal(err)
	}
	botName := "uptime_kuma"
	if _, err := svc.UpdateBot(bg, bot.ID, &botName, nil, nil); err != nil {
		t.Fatal(err)
	}

	if want := []string{caseyID, caseyID, bot.ID}; !slices.Equal(renames.userIDs, want) {
		t.Errorf("announced %v, want %v", renames.userIDs, want)
	}
}
