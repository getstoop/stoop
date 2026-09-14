package auth_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

type tokenSetting struct{ v string }

func (t *tokenSetting) PersonalTokens(context.Context) (string, error) { return t.v, nil }

var readOnly = []accessv1.Permission{
	accessv1.Permission_PERMISSION_SPACE_READ, accessv1.Permission_PERMISSION_MESSAGES_READ,
}

func TestPersonalTokens(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	setting := &tokenSetting{v: auth.TokensEveryone}
	svc.UseTokenPolicy(setting)
	casey, _ := signIn(t, svc, "casey", "correct horse battery") // the first account is admin
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	adaID, _ := authctx.From(ada)
	bg := context.Background()

	spaceID := uuid.NewString()
	if _, err := pool.Exec(bg, `INSERT INTO spaces (id, name, owner_id) VALUES ($1, 'Homelab', $2)`, spaceID, adaID.UserID); err != nil {
		t.Fatal(err)
	}

	made, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "backup script", Permissions: readOnly, ExpiresInDays: 90,
	}))
	if err != nil {
		t.Fatal(err)
	}
	secret := made.Msg.Secret
	if !strings.HasPrefix(secret, "stp_pat_") || made.Msg.Token.Hint != secret[len(secret)-4:] || made.Msg.Token.ExpiresAt == nil {
		t.Errorf("unexpected token %+v / %q", made.Msg.Token, secret)
	}

	id, err := svc.VerifyToken(bg, secret)
	if err != nil {
		t.Fatal(err)
	}
	if id.Credential.Kind != authctx.CredentialPersonalToken || id.SessionID != "" {
		t.Errorf("verified as %+v", id)
	}
	if id.Credential.Bounded || !id.Credential.Reaches(spaceID, "") || !id.Credential.Covers(authctx.MessagesRead) || id.Credential.Covers(authctx.MessagesPost) {
		t.Errorf("the token's grant or bounds are wrong: %+v", id.Credential)
	}

	listed, err := svc.ListPersonalTokens(ada, connect.NewRequest(&authv1.ListPersonalTokensRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.Tokens) != 1 || listed.Msg.Tokens[0].LastUsedAt == nil || listed.Msg.Tokens[0].Blocked {
		t.Errorf("list = %+v", listed.Msg.Tokens)
	}

	// No token can make, list or revoke tokens.
	byToken := authctx.WithIdentity(bg, id)
	if _, err := svc.CreatePersonalToken(byToken, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "offspring", Permissions: readOnly, ExpiresInDays: 30,
	})); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a token made a token: %v", err)
	}
	if _, err := svc.ListPersonalTokens(byToken, connect.NewRequest(&authv1.ListPersonalTokensRequest{})); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a token listed tokens: %v", err)
	}

	for name, req := range map[string]*authv1.CreatePersonalTokenRequest{
		"no permissions":   {Name: "x", ExpiresInDays: 30},
		"account security": {Name: "x", Permissions: []accessv1.Permission{accessv1.Permission_PERMISSION_ACCOUNT_SECURITY}, ExpiresInDays: 30},
		"over a year":      {Name: "x", Permissions: readOnly, ExpiresInDays: 400},
		"blank name":       {Name: "  ", Permissions: readOnly, ExpiresInDays: 30},
	} {
		if _, err := svc.CreatePersonalToken(ada, connect.NewRequest(req)); codeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: want invalid_argument, got %v", name, err)
		}
	}

	// Activity with a read grant beside it is fine.
	pings, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "pings", Permissions: []accessv1.Permission{accessv1.Permission_PERMISSION_ACTIVITY_READ, accessv1.Permission_PERMISSION_DMS_READ}, ExpiresInDays: 30,
	}))
	if err != nil {
		t.Fatalf("activity with dms.read: %v", err)
	}
	if _, err := svc.RevokePersonalToken(ada, connect.NewRequest(&authv1.RevokePersonalTokenRequest{TokenId: pings.Msg.Token.Id})); err != nil {
		t.Fatal(err)
	}

	// The server's setting is checked at every use.
	setting.v = auth.TokensAdmins
	if _, err := svc.VerifyToken(bg, secret); err == nil {
		t.Error("a member's token worked while tokens were admins-only")
	}
	listed, _ = svc.ListPersonalTokens(ada, connect.NewRequest(&authv1.ListPersonalTokensRequest{}))
	if len(listed.Msg.Tokens) != 1 || !listed.Msg.Tokens[0].Blocked {
		t.Error("a blocked token should stay listed, marked blocked")
	}
	if _, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "x", Permissions: readOnly, ExpiresInDays: 30,
	})); codeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member made a token while tokens were admins-only: %v", err)
	}
	caseys, err := svc.CreatePersonalToken(casey, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "monitoring", Permissions: []accessv1.Permission{accessv1.Permission_PERMISSION_INSTANCE_READ},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if caseys.Msg.Token.ExpiresAt != nil {
		t.Error("expires_in_days 0 should never expire")
	}
	if _, err := svc.VerifyToken(bg, caseys.Msg.Secret); err != nil {
		t.Errorf("an admin's token failed while tokens were admins-only: %v", err)
	}
	setting.v = auth.TokensOff
	if _, err := svc.VerifyToken(bg, caseys.Msg.Secret); err == nil {
		t.Error("a token worked while tokens were off")
	}
	setting.v = auth.TokensEveryone
	if _, err := svc.VerifyToken(bg, secret); err != nil {
		t.Errorf("a token didn't come back when the setting did: %v", err)
	}

	// Revoking: your own, once; never someone else's.
	if _, err := svc.RevokePersonalToken(ada, connect.NewRequest(&authv1.RevokePersonalTokenRequest{TokenId: caseys.Msg.Token.Id})); codeOf(err) != connect.CodeNotFound {
		t.Errorf("ada revoked casey's token: %v", err)
	}
	if _, err := svc.RevokePersonalToken(ada, connect.NewRequest(&authv1.RevokePersonalTokenRequest{TokenId: made.Msg.Token.Id})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(bg, secret); err == nil {
		t.Error("a revoked token still verifies")
	}
	if _, err := svc.RevokePersonalToken(ada, connect.NewRequest(&authv1.RevokePersonalTokenRequest{TokenId: made.Msg.Token.Id})); codeOf(err) != connect.CodeNotFound {
		t.Errorf("revoking twice: %v", err)
	}
}

func TestChangePasswordCanRevokeTokens(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	made, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "script", Permissions: readOnly, ExpiresInDays: 30,
	}))
	if err != nil {
		t.Fatal(err)
	}
	bg := context.Background()

	if _, err := svc.ChangePassword(ada, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "correct horse battery", NewPassword: "another horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(bg, made.Msg.Secret); err != nil {
		t.Errorf("a password change without the flag revoked the token: %v", err)
	}
	if _, err := svc.ChangePassword(ada, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: "another horse battery", NewPassword: "third horse battery", RevokePersonalTokens: true,
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(bg, made.Msg.Secret); err == nil {
		t.Error("the token survived a password change asked to revoke it")
	}
}

func TestSweepKeepsExpiredTokensAMonth(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	adaID, _ := authctx.From(ada)
	bg := context.Background()
	for name, age := range map[string]string{"recent": "29 days", "old": "31 days"} {
		if _, err := pool.Exec(bg,
			`INSERT INTO credentials (id, holder_id, kind, token_hash, name, grants, expires_at)
			 VALUES ($1, $2, 'personal_token', $3, $4, '{messages.read}', now() - $5::interval)`,
			uuid.NewString(), adaID.UserID, []byte(name), name, age); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SweepCredentials(bg); err != nil {
		t.Fatal(err)
	}
	listed, err := svc.ListPersonalTokens(ada, connect.NewRequest(&authv1.ListPersonalTokensRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.Tokens) != 1 || listed.Msg.Tokens[0].Name != "recent" {
		t.Errorf("after the sweep: %+v", listed.Msg.Tokens)
	}
	if _, err := svc.VerifyToken(bg, "anything"); err == nil {
		t.Error("sanity: an unknown token verified")
	}
	if id, _ := authctx.From(ada); id.SessionID == "" {
		t.Error("the live session was swept")
	} else if _, err := svc.GetMe(ada, connect.NewRequest(&authv1.GetMeRequest{})); err != nil {
		t.Errorf("the session's account is gone: %v", err)
	}
}

func TestAdminSeesAndRevokesTokens(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	signIn(t, svc, "casey", "correct horse battery")
	ada, _ := signIn(t, svc, "ada", "correct horse battery")
	adaID, _ := authctx.From(ada)
	bg := context.Background()
	made, err := svc.CreatePersonalToken(ada, connect.NewRequest(&authv1.CreatePersonalTokenRequest{
		Name: "script", Permissions: readOnly, ExpiresInDays: 30,
	}))
	if err != nil {
		t.Fatal(err)
	}

	accounts, err := svc.ListAccounts(bg)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range accounts {
		if a.ID == adaID.UserID && a.PersonalTokens != 1 {
			t.Errorf("ada's token count = %d", a.PersonalTokens)
		}
	}
	tokens, err := svc.ListTokensOf(bg, adaID.UserID)
	if err != nil || len(tokens) != 1 {
		t.Fatalf("ListTokensOf = %v, %v", tokens, err)
	}
	if err := svc.RevokeTokenOf(bg, adaID.UserID, made.Msg.Token.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(bg, made.Msg.Secret); err == nil {
		t.Error("an admin-revoked token still verifies")
	}
}
