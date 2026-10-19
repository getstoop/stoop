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
	"github.com/getstoop/stoop/internal/db/dbtest"
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

// A token is never a sign-in, however new: only a session counts.
func TestRecentSignInNeedsASession(t *testing.T) {
	svc, pool, _ := emailService(t)
	signIn(t, svc, "owner", casePassword)
	ctx, _ := socialUser(t, svc, pool, "sasha", "sso")
	id, _ := authctx.From(ctx)
	// The same just-made credential, presented as a token rather than a
	// session.
	id.SessionID = ""
	id.Credential.Kind = authctx.CredentialPersonalToken
	_, err := svc.ChangePassword(authctx.WithIdentity(context.Background(), id),
		connect.NewRequest(&authv1.ChangePasswordRequest{NewPassword: "a brand new password"}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("want failed_precondition, got %v", err)
	}
}

// A personal token outlives the session that made it, so making one needs
// a recent sign-in, password or not.
func TestCreatingATokenNeedsRecentSignIn(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	create := func(ctx context.Context) error {
		_, err := svc.CreatePersonalToken(ctx, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
			Name: "script", Permissions: readOnly, ExpiresInDays: 30,
		}))
		return err
	}

	stale, _ := signIn(t, svc, "ada", casePassword)
	ageSession(t, pool, stale)
	if err := create(stale); codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("session older than ten minutes: want failed_precondition, got %v", err)
	}
	fresh, _ := signIn(t, svc, "ada", casePassword)
	if err := create(fresh); err != nil {
		t.Fatalf("just signed in: %v", err)
	}
}

// Signing out everywhere else takes personal tokens with it: one made
// from a stolen session would otherwise keep its holder in.
func TestSignOutEverywhereRevokesTokens(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, token := signIn(t, svc, "ada", casePassword)
	made, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "script", Permissions: readOnly, ExpiresInDays: 30,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RevokeOtherSessions(ada, connect.NewRequest(&authv1.RevokeOtherSessionsRequest{})); err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	if _, err := svc.VerifyToken(bg, made.Msg.Secret); err == nil {
		t.Error("the personal token survived signing out everywhere")
	}
	if _, err := svc.VerifyToken(bg, token); err != nil {
		t.Errorf("the caller's own session was signed out: %v", err)
	}
}

// The password a signed-in person types to confirm a change is guarded
// like the login form's, on the same budget: a stolen session is not a
// way to guess it without limit.
func TestAccountPasswordChecksShareTheLockout(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", casePassword)
	change := func(current string) error {
		_, err := svc.ChangePassword(ada, connect.NewRequest(&authv1.ChangePasswordRequest{
			CurrentPassword: current, NewPassword: "a brand new password",
		}))
		return err
	}
	for range 5 {
		if err := change("not the password"); codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("wrong password: want invalid_argument, got %v", err)
		}
	}
	if err := change(casePassword); codeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("after five wrong guesses: want resource_exhausted, got %v", err)
	}
	_, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: casePassword}))
	if codeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the login form should share the lockout, got %v", err)
	}
}
