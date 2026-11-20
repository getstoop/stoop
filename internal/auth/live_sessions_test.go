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

// LiveSessions keeps only sessions that would verify now: not an expired
// one, one whose account is deactivated or deleted while the session row
// still stands (before revocation, or if it failed), a personal token, or
// an id that is no credential.
func TestLiveSessions(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	sessionOf := func(ctx context.Context) string {
		id, _ := authctx.From(ctx)
		return id.SessionID
	}
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	bea, _ := signIn(t, svc, "bea", "correct horse battery")
	cass, _ := signIn(t, svc, "cass", "correct horse battery")
	dee, _ := signIn(t, svc, "dee", "correct horse battery")
	live, expired, deactivated, deleted := sessionOf(ada), sessionOf(bea), sessionOf(cass), sessionOf(dee)
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired); err != nil {
		t.Fatal(err)
	}
	// The account states alone, the session rows left in place.
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET deactivated_at = now() WHERE id = (SELECT holder_id FROM credentials WHERE id = $1)`, deactivated); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET deleted_at = now(), deactivated_at = now() WHERE id = (SELECT holder_id FROM credentials WHERE id = $1)`, deleted); err != nil {
		t.Fatal(err)
	}
	adaID, _ := authctx.From(ada)
	mintToken(t, pool, adaID.UserID, []string{"preferences.manage"}, false)
	var tokenID string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM credentials WHERE kind = 'personal_token'`).Scan(&tokenID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.LiveSessions(context.Background(), []string{live, expired, deactivated, deleted, tokenID, uuid.NewString()})
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
