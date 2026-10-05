package auth_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

func TestResetPassword(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{})
	bg := context.Background()
	casey, _ := signIn(t, svc, "casey", "correct horse battery") // the owner
	ctx, token := signIn(t, svc, "ada", "correct horse battery")
	_, other := signIn(t, svc, "ada", "correct horse battery")

	temp, summary, err := svc.ResetPassword(bg, authctx.UserID(ctx))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Username != "ada" || len(temp) < 12 {
		t.Errorf("reset: %+v %q", summary, temp)
	}
	// Every session is gone, the old password no longer works, the
	// temporary one does.
	for _, tok := range []string{token, other} {
		if _, err := svc.VerifyToken(bg, tok); err == nil {
			t.Errorf("session still valid after reset")
		}
	}
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: "correct horse battery"})); err == nil {
		t.Errorf("old password still works")
	}
	if _, err := svc.Login(bg, connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: temp})); err != nil {
		t.Errorf("temporary password refused: %v", err)
	}
	// By username, for the CLI; unknown users are NotFound.
	if _, _, err := svc.ResetPasswordByUsername(bg, "Ada"); err != nil {
		t.Errorf("by username: %v", err)
	}
	if _, _, err := svc.ResetPasswordByUsername(bg, "nobody"); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("unknown user: want not_found, got %v", err)
	}
	// The owner's password: never through the admin path, always through
	// the CLI.
	if _, _, err := svc.ResetPassword(bg, authctx.UserID(casey)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("admin reset of the owner: want permission_denied, got %v", err)
	}
	if _, _, err := svc.ResetPasswordByUsername(bg, "casey"); err != nil {
		t.Errorf("CLI reset of the owner: %v", err)
	}
}

func TestResetPasswordSummaryHasPassword(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	signIn(t, svc, "casey", "correct horse battery") // the owner
	_, userID := socialUser(t, pool, "bea", "sso")

	_, summary, err := svc.ResetPassword(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if !summary.HasPassword {
		t.Errorf("summary after reset says no password: %+v", summary)
	}
}
