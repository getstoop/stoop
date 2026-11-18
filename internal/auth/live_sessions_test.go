package auth_test

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// LiveSessions keeps only sessions that have not expired: not an
// expired one, a personal token, or an id that is no credential.
func TestLiveSessions(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	sessionOf := func(ctx context.Context) string {
		id, _ := authctx.From(ctx)
		return id.SessionID
	}
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	bea, _ := signIn(t, svc, "bea", "correct horse battery")
	live, expired := sessionOf(ada), sessionOf(bea)
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired); err != nil {
		t.Fatal(err)
	}
	adaID, _ := authctx.From(ada)
	mintToken(t, pool, adaID.UserID, []string{"preferences.manage"}, false)
	var tokenID string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM credentials WHERE kind = 'personal_token'`).Scan(&tokenID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.LiveSessions(context.Background(), []string{live, expired, tokenID, uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, []string{live}) {
		t.Errorf("live = %v, want only %s", got, live)
	}
	if got, err := svc.LiveSessions(context.Background(), nil); err != nil || len(got) != 0 {
		t.Errorf("none asked: %v, %v", got, err)
	}
}
