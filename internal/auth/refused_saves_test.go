package auth_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// A save refused because of one field writes none of the others: each case
// pairs a valid new username with a field that is refused.
func TestARefusedSaveChangesNothing(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	background := context.Background()
	text := func(value string) *string { return &value }
	usernameOf := func(userID string) string {
		t.Helper()
		user, err := svc.GetUserProfile(ada, connect.NewRequest(&authv1.GetUserProfileRequest{UserId: userID}))
		if err != nil {
			t.Fatal(err)
		}
		return user.Msg.Profile.Username
	}

	_, err := svc.UpdateProfile(ada, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Ada", Username: text("ada_new"), Bio: text(strings.Repeat("x", 301)),
	}))
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a bio over the limit: want invalid_argument, got %v", err)
	}
	if got := usernameOf(authctx.UserID(ada)); got != "ada" {
		t.Errorf("own profile: username = %q after a refused save, want ada", got)
	}

	bea, _ := signIn(t, svc, "bea", "correct horse battery")
	if _, err := svc.RenameAccount(background, authctx.UserID(bea), text("bea_new"), text("   ")); codeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an empty display name: want invalid_argument, got %v", err)
	}
	if got := usernameOf(authctx.UserID(bea)); got != "bea" {
		t.Errorf("admin rename: username = %q after a refused save, want bea", got)
	}

	bot, err := svc.CreateBot(background, "uptime", "Uptime Kuma")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBot(background, bot.ID, text("uptime_new"), text(strings.Repeat("x", 51)), nil); codeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a display name over the limit: want invalid_argument, got %v", err)
	}
	if got, err := svc.GetBot(background, bot.ID); err != nil || got.Username != "uptime" {
		t.Errorf("bot: username = %q (%v) after a refused save, want uptime", got.Username, err)
	}
}

// A write that fails after the username is written takes the username
// back with it: a trigger refuses the marker value in the second write.
func TestAFailedLaterWriteRollsBackTheUsername(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	background := context.Background()
	if _, err := pool.Exec(background, `
		CREATE FUNCTION refuse_marker() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.display_name = 'fail-me' OR NEW.bio = 'fail-me' THEN
				RAISE EXCEPTION 'refused by the test';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER refuse_marker BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION refuse_marker();`); err != nil {
		t.Fatal(err)
	}
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	text := func(value string) *string { return &value }
	usernameOf := func(userID string) string {
		t.Helper()
		var username string
		if err := pool.QueryRow(background, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username); err != nil {
			t.Fatal(err)
		}
		return username
	}

	if _, err := svc.UpdateProfile(ada, connect.NewRequest(&authv1.UpdateProfileRequest{
		DisplayName: "Ada", Username: text("ada_new"), Bio: text("fail-me"),
	})); err == nil {
		t.Fatal("own profile: the failing write was not reported")
	}
	if got := usernameOf(authctx.UserID(ada)); got != "ada" {
		t.Errorf("own profile: username = %q after a failed write, want ada", got)
	}

	bea, _ := signIn(t, svc, "bea", "correct horse battery")
	if _, err := svc.RenameAccount(background, authctx.UserID(bea), text("bea_new"), text("fail-me")); err == nil {
		t.Fatal("admin rename: the failing write was not reported")
	}
	if got := usernameOf(authctx.UserID(bea)); got != "bea" {
		t.Errorf("admin rename: username = %q after a failed write, want bea", got)
	}

	bot, err := svc.CreateBot(background, "uptime", "Uptime Kuma")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBot(background, bot.ID, text("uptime_new"), nil, text("fail-me")); err == nil {
		t.Fatal("bot: the failing write was not reported")
	}
	if got := usernameOf(bot.ID); got != "uptime" {
		t.Errorf("bot: username = %q after a failed write, want uptime", got)
	}
}
