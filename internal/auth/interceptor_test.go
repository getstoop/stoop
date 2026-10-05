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
	"github.com/jackc/pgx/v5/pgxpool"
)

// interceptedClient serves the auth handler behind the real interceptor and
// returns a client for it, plus a session token for a fresh account casey.
func interceptedClient(t *testing.T, procedures map[string]authctx.Rule) (authv1connect.AuthServiceClient, string) {
	t.Helper()
	client, token, _ := interceptedRig(t, procedures)
	return client, token
}

// interceptedRig is interceptedClient with the pool behind it, for a test
// that breaks the database.
func interceptedRig(t *testing.T, procedures map[string]authctx.Rule) (authv1connect.AuthServiceClient, string, *pgxpool.Pool) {
	t.Helper()
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2, Procedures: procedures})
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
	return authv1connect.NewAuthServiceClient(server.Client(), server.URL), login.Msg.Token, pool
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

// Signed out is an answer about the caller; a credential lookup that fails
// is not, and neither a listed nor a public procedure may treat it as one.
func TestInterceptorTellsNoSessionFromAFailedCheck(t *testing.T) {
	client, token, pool := interceptedRig(t, map[string]authctx.Rule{
		authv1connect.AuthServiceLoginProcedure: {Public: true},
		authv1connect.AuthServiceGetMeProcedure: {},
	})
	ctx := context.Background()
	login := func(token string) error {
		_, err := client.Login(ctx, withToken(connect.NewRequest(&authv1.LoginRequest{
			Username: "casey", Password: "correct horse battery",
		}), token))
		return err
	}

	_, err := client.GetMe(ctx, withToken(connect.NewRequest(&authv1.GetMeRequest{}), "not-a-token"))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("GetMe with an unknown token: code %v, want unauthenticated", connect.CodeOf(err))
	}
	if err := login("not-a-token"); err != nil {
		t.Errorf("public Login with an unknown token: %v", err)
	}

	pool.Close()
	_, err = client.GetMe(ctx, withToken(connect.NewRequest(&authv1.GetMeRequest{}), token))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("GetMe with the database gone: %v, want unavailable", err)
	}
	if err := login(token); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("public Login with the database gone: %v, want unavailable", err)
	}
}
