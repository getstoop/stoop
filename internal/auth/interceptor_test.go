package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/gen/stoop/auth/v1/authv1connect"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// interceptedClient serves the auth handler behind the real interceptor and
// returns a client for it, plus a session token for a fresh account casey.
func interceptedClient(t *testing.T, procedures map[string]authctx.Rule) (authv1connect.AuthServiceClient, string) {
	t.Helper()
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2, Procedures: procedures})
	ctx := context.Background()
	if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Username: "casey", Password: "correct horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	login, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Username: "casey", Password: "correct horse battery",
	}))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle(authv1connect.NewAuthServiceHandler(svc, connect.WithInterceptors(svc.NewInterceptor())))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return authv1connect.NewAuthServiceClient(server.Client(), server.URL), login.Msg.Token
}

func withToken[T any](request *connect.Request[T], token string) *connect.Request[T] {
	request.Header().Set("Authorization", "Bearer "+token)
	return request
}

func TestInterceptorRefusesEverythingWithoutProcedures(t *testing.T) {
	client, token := interceptedClient(t, nil)
	ctx := context.Background()

	_, err := client.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Username: "casey", Password: "correct horse battery",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("Login with no table: code %v, want unauthenticated", connect.CodeOf(err))
	}

	_, err = client.GetMe(ctx, withToken(connect.NewRequest(&authv1.GetMeRequest{}), token))
	if connect.CodeOf(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "no access rule") {
		t.Errorf("GetMe with no table: %v, want permission denied, no access rule", err)
	}
}

func TestInterceptorAppliesTheTable(t *testing.T) {
	client, token := interceptedClient(t, map[string]authctx.Rule{
		authv1connect.AuthServiceLoginProcedure: {Public: true},
		authv1connect.AuthServiceGetMeProcedure: {},
	})
	ctx := context.Background()

	login, err := client.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Username: "casey", Password: "correct horse battery",
	}))
	if err != nil || login.Msg.Token == "" {
		t.Errorf("public Login with no credential: %v", err)
	}

	me, err := client.GetMe(ctx, withToken(connect.NewRequest(&authv1.GetMeRequest{}), token))
	if err != nil || me.Msg.User.Username != "casey" {
		t.Errorf("listed GetMe with a session: %v", err)
	}

	_, err = client.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("listed GetMe with no credential: code %v, want unauthenticated", connect.CodeOf(err))
	}

	_, err = client.ListSessions(ctx, withToken(connect.NewRequest(&authv1.ListSessionsRequest{}), token))
	if connect.CodeOf(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "no access rule") {
		t.Errorf("unlisted ListSessions: %v, want permission denied, no access rule", err)
	}
}
