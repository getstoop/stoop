package auth_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
)

// ageSession backdates the caller's session past the ten minutes a
// sign-in counts as recent.
func ageSession(t *testing.T, pool *pgxpool.Pool, ctx context.Context) {
	t.Helper()
	id, _ := authctx.From(ctx)
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET created_at = now() - interval '11 minutes' WHERE id = $1`, id.Credential.ID); err != nil {
		t.Fatal(err)
	}
}

// An account without a password has nothing to type to prove it's the
// person. Every change the password would guard asks for a recent sign-in
// instead, so a stolen session can't set a password or move the email
// address and keep the account (STOOP-511).
func TestPasswordlessChangesNeedRecentSignIn(t *testing.T) {
	changes := []struct {
		name string
		do   func(ctx context.Context, svc *auth.Service) error
	}{
		{"set a first password", func(ctx context.Context, svc *auth.Service) error {
			_, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{NewPassword: "a brand new password"}))
			return err
		}},
		{"change the email address", func(ctx context.Context, svc *auth.Service) error {
			_, err := requestEmail(ctx, svc, "mine@example.com", "")
			return err
		}},
		{"remove the email address", func(ctx context.Context, svc *auth.Service) error {
			_, err := svc.RemoveEmail(ctx, connect.NewRequest(&authv1.RemoveEmailRequest{}))
			return err
		}},
		{"delete the account", func(ctx context.Context, svc *auth.Service) error {
			_, err := svc.DeleteAccount(ctx, connect.NewRequest(&authv1.DeleteAccountRequest{}))
			return err
		}},
	}
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			svc, pool, _ := emailService(t)
			signIn(t, svc, "owner", casePassword) // the first account is the owner

			stale, _ := socialUser(t, svc, pool, "stale", "sso")
			ageSession(t, pool, stale)
			err := change.do(stale, svc)
			if codeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "sign in again first") {
				t.Fatalf("session older than ten minutes: want failed_precondition asking to sign in again, got %v", err)
			}

			fresh, _ := socialUser(t, svc, pool, "fresh", "sso")
			if err := change.do(fresh, svc); err != nil {
				t.Fatalf("just signed in: %v", err)
			}
		})
	}
}

// A request with no session behind it (no credential at all) is never a
// recent sign-in.
func TestRecentSignInNeedsASession(t *testing.T) {
	svc, pool, _ := emailService(t)
	signIn(t, svc, "owner", casePassword)
	ctx, _ := socialUser(t, svc, pool, "sasha", "sso")
	id, _ := authctx.From(ctx)
	id.Credential = authctx.Credential{}
	_, err := svc.ChangePassword(authctx.WithIdentity(context.Background(), id),
		connect.NewRequest(&authv1.ChangePasswordRequest{NewPassword: "a brand new password"}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("want failed_precondition, got %v", err)
	}
}
