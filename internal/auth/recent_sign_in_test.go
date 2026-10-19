package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

// ageSession backdates the caller's session past the five minutes a
// sign-in counts as recent.
func ageSession(t *testing.T, pool *pgxpool.Pool, ctx context.Context) {
	t.Helper()
	id, _ := authctx.From(ctx)
	if _, err := pool.Exec(context.Background(),
		`UPDATE credentials SET created_at = now() - interval '6 minutes' WHERE id = $1`, id.Credential.ID); err != nil {
		t.Fatal(err)
	}
}

// asSession is the identity behind a session token, as the interceptor
// would set it.
func asSession(t *testing.T, svc *auth.Service, token string) context.Context {
	t.Helper()
	id, err := svc.VerifyToken(context.Background(), token)
	if err != nil {
		t.Fatalf("verify %q: %v", token, err)
	}
	return authctx.WithIdentity(context.Background(), id)
}

// Every change that could keep an account after its session is stolen
// asks for a recent sign-in, password or not, so a stolen session can't
// set a password, move the email address, or remove the account (STOOP-511).
func TestSensitiveChangesNeedRecentSignIn(t *testing.T) {
	changes := []struct {
		name string
		do   func(ctx context.Context, svc *auth.Service) error
	}{
		{"set or change the password", func(ctx context.Context, svc *auth.Service) error {
			_, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{NewPassword: "a brand new password"}))
			return err
		}},
		{"change the email address", func(ctx context.Context, svc *auth.Service) error {
			_, err := requestEmail(ctx, svc, "mine@example.com")
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
	accounts := []struct {
		kind string
		make func(t *testing.T, svc *auth.Service, pool *pgxpool.Pool, name string) context.Context
	}{
		{"with a password", func(t *testing.T, svc *auth.Service, _ *pgxpool.Pool, name string) context.Context {
			ctx, _ := signIn(t, svc, name, casePassword)
			return ctx
		}},
		{"without one", func(t *testing.T, svc *auth.Service, pool *pgxpool.Pool, name string) context.Context {
			ctx, _ := socialUser(t, svc, pool, name, "sso")
			return ctx
		}},
	}
	for _, account := range accounts {
		for _, change := range changes {
			t.Run(account.kind+"/"+change.name, func(t *testing.T) {
				svc, pool, _ := emailService(t)
				signIn(t, svc, "owner", casePassword) // the first account is the owner

				stale := account.make(t, svc, pool, "stale")
				ageSession(t, pool, stale)
				err := change.do(stale, svc)
				if codeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "sign in again first") {
					t.Fatalf("session older than five minutes: want failed_precondition asking to sign in again, got %v", err)
				}

				fresh := account.make(t, svc, pool, "fresh")
				if err := change.do(fresh, svc); err != nil {
					t.Fatalf("just signed in: %v", err)
				}
			})
		}
	}
}

// Unlinking is gated too; the fresh case is TestUnlinkIdentityGuard's.
func TestUnlinkNeedsRecentSignIn(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx, _ := socialUser(t, svc, pool, "quinn", "sso")
	ageSession(t, pool, ctx)
	_, err := svc.UnlinkIdentity(ctx, connect.NewRequest(&authv1.UnlinkIdentityRequest{Provider: "sso"}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("want failed_precondition, got %v", err)
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
		t.Fatalf("session older than five minutes: want failed_precondition, got %v", err)
	}
	fresh, _ := signIn(t, svc, "ada", casePassword)
	if err := create(fresh); err != nil {
		t.Fatalf("just signed in: %v", err)
	}
}

// Signing out everywhere ends every session, this one included, and every
// personal token: a copy of this session, or a token made from a stolen
// one, would otherwise keep its holder in.
func TestSignOutEverywhere(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, token := signIn(t, svc, "ada", casePassword)
	_, other := signIn(t, svc, "ada", casePassword)
	made, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "script", Permissions: readOnly, ExpiresInDays: 30,
	}))
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.SignOutEverywhere(ada, connect.NewRequest(&authv1.SignOutEverywhereRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.Sessions != 2 || res.Msg.Tokens != 1 {
		t.Errorf("ended %d sessions and %d tokens, want 2 and 1", res.Msg.Sessions, res.Msg.Tokens)
	}
	if !strings.Contains(res.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Errorf("the cookie isn't cleared: %q", res.Header().Get("Set-Cookie"))
	}
	bg := context.Background()
	for what, gone := range map[string]string{"this session": token, "the other device": other, "the personal token": made.Msg.Secret} {
		if _, err := svc.VerifyToken(bg, gone); err == nil {
			t.Errorf("%s survived signing out everywhere", what)
		}
	}
}

// A token is written only while the session making it still exists, so
// one signed out between the request's checks and the insert can't leave
// a token behind (the insert holds the session against SignOutEverywhere).
func TestNoTokenFromASignedOutSession(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", casePassword)
	id, _ := authctx.From(ada)
	if _, err := svc.SignOutEverywhere(ada, connect.NewRequest(&authv1.SignOutEverywhereRequest{})); err != nil {
		t.Fatal(err)
	}
	_, err := dbgen.New(pool).CreatePersonalToken(context.Background(), dbgen.CreatePersonalTokenParams{
		ID: uuid.NewString(), HolderID: id.UserID, TokenHash: []byte("hash"), Name: "script",
		Grants: []string{}, Hint: "abcd", SessionID: id.SessionID,
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a token was written for a signed-out session: %v", err)
	}
}

// Reauthenticating with the password replaces the session: the new one is
// a recent sign-in, and the old one stops working wherever it was copied.
func TestReauthenticate(t *testing.T) {
	svc, pool, _ := emailService(t)
	ada, old := signIn(t, svc, "ada", casePassword)
	_, phone := signIn(t, svc, "ada", casePassword) // another device
	ageSession(t, pool, ada)

	res, err := svc.Reauthenticate(ada, connect.NewRequest(&authv1.ReauthenticateRequest{Password: casePassword}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Header().Get("Set-Cookie"), res.Msg.Token) {
		t.Error("the new session isn't set as the cookie")
	}
	bg := context.Background()
	if _, err := svc.VerifyToken(bg, old); err == nil {
		t.Error("the replaced session still works")
	}
	if _, err := svc.VerifyToken(bg, phone); err != nil {
		t.Errorf("another device was signed out: %v", err)
	}
	if _, err := requestEmail(asSession(t, svc, res.Msg.Token), svc, "ada@example.com"); err != nil {
		t.Errorf("the new session isn't a recent sign-in: %v", err)
	}
}

// A session is replaced once. Two replacements of the same one (the
// person confirming and a thief holding a copy, racing) can't both leave
// a live successor: the second finds it gone and gets nothing.
func TestASessionIsReplacedOnce(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", casePassword)
	confirm := func() (*connect.Response[authv1.ReauthenticateResponse], error) {
		return svc.Reauthenticate(ada, connect.NewRequest(&authv1.ReauthenticateRequest{Password: casePassword}))
	}
	first, err := confirm()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := confirm(); codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("a second replacement of the same session: want unauthenticated, got %v", err)
	}
	list, err := svc.ListSessions(asSession(t, svc, first.Msg.Token), connect.NewRequest(&authv1.ListSessionsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Sessions) != 1 {
		t.Errorf("%d sessions after replacing one, want 1", len(list.Msg.Sessions))
	}
}

// Every refusal says the same thing, and an account without a password
// has none to confirm with.
func TestReauthenticateRefusals(t *testing.T) {
	svc, pool, _ := emailService(t)
	signIn(t, svc, "owner", casePassword)
	ada, _ := signIn(t, svc, "ada", casePassword)
	sasha, _ := socialUser(t, svc, pool, "sasha", "sso")
	for name, try := range map[string]func() error{
		"a wrong password": func() error {
			_, err := svc.Reauthenticate(ada, connect.NewRequest(&authv1.ReauthenticateRequest{Password: "not it"}))
			return err
		},
		"no password on the account": func() error {
			_, err := svc.Reauthenticate(sasha, connect.NewRequest(&authv1.ReauthenticateRequest{Password: casePassword}))
			return err
		},
	} {
		err := try()
		if codeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "Couldn't confirm it's you") {
			t.Errorf("%s: want the generic refusal, got %v", name, err)
		}
	}
}

// The password typed to confirm it's you is guarded like the login form's,
// on the same budget: a stolen session is not a way to guess it without
// limit.
func TestReauthenticateSharesTheLockout(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", casePassword)
	confirm := func(password string) error {
		_, err := svc.Reauthenticate(ada, connect.NewRequest(&authv1.ReauthenticateRequest{Password: password}))
		return err
	}
	for range 5 {
		if err := confirm("not the password"); codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("wrong password: want invalid_argument, got %v", err)
		}
	}
	if err := confirm(casePassword); codeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("after five wrong guesses: want resource_exhausted, got %v", err)
	}
	_, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: casePassword}))
	if codeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the login form should share the lockout, got %v", err)
	}
}
