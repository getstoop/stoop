package app

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Until /ws and downloads filter by credential (STOOP-274), only a session
// opens them.
func TestOnlySessionsOpenWsAndDownloads(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{
		Argon2Params: &argon2id.Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32},
	})
	ctx := context.Background()
	creds := &authv1.RegisterRequest{Username: "ada", Password: "correct horse battery"}
	if _, err := svc.Register(ctx, connect.NewRequest(creds)); err != nil {
		t.Fatal(err)
	}
	login, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: creds.Username, Password: creds.Password}))
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.VerifyToken(ctx, login.Msg.Token)
	if err != nil {
		t.Fatal(err)
	}
	made, err := svc.CreatePersonalToken(authctx.WithIdentity(ctx, session), connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name:        "script",
		Permissions: []accessv1.Permission{accessv1.Permission_PERMISSION_SPACE_READ, accessv1.Permission_PERMISSION_MESSAGES_READ},
	}))
	if err != nil {
		t.Fatal(err)
	}

	bearer := func(token string) http.Header {
		h := http.Header{}
		h.Set("Authorization", "Bearer "+token)
		return h
	}
	for name, token := range map[string]string{"session": login.Msg.Token, "personal token": made.Msg.Secret} {
		want := name == "session"
		if _, err := (identityVerifier{svc}).VerifyRequest(ctx, bearer(token)); (err == nil) != want {
			t.Errorf("downloads with a %s: err = %v", name, err)
		}
		if _, err := (sessionVerifier{svc}).VerifyRequest(ctx, bearer(token)); (err == nil) != want {
			t.Errorf("/ws with a %s: err = %v", name, err)
		}
	}
}
