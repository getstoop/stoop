package auth_test

import (
	"context"
	"crypto/sha256"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// mintToken writes a personal token straight into the table; the RPC that
// mints one arrives with personal tokens.
func mintToken(t *testing.T, pool *pgxpool.Pool, holderID string, grants []string, bounded bool, spaces ...string) string {
	t.Helper()
	ctx := context.Background()
	token := uuid.NewString()
	hash := sha256.Sum256([]byte(token))
	credID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO credentials (id, holder_id, kind, token_hash, grants, bounded)
		 VALUES ($1, $2, 'personal_token', $3, $4, $5)`,
		credID, holderID, hash[:], grants, bounded); err != nil {
		t.Fatal(err)
	}
	for _, s := range spaces {
		if _, err := pool.Exec(ctx, `INSERT INTO credential_bounds (credential_id, space_id) VALUES ($1, $2)`, credID, s); err != nil {
			t.Fatal(err)
		}
	}
	return token
}

func TestSessionIsACredential(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	ctx, _ := signIn(t, svc, "ada", "correct horse battery")
	id, _ := authctx.From(ctx)
	if id.Kind != authctx.KindPerson || id.Credential.Kind != authctx.CredentialSession {
		t.Errorf("want a person holding a session, got %q holding %q", id.Kind, id.Credential.Kind)
	}
	if id.SessionID == "" || id.SessionID != id.Credential.ID {
		t.Errorf("session id %q should be the credential id %q", id.SessionID, id.Credential.ID)
	}
	if id.Credential.Grants != nil || id.Credential.Bounded {
		t.Error("a session covers everything, unbounded")
	}
}

func TestGetMePermissions(t *testing.T) {
	svc := auth.New(dbtest.New(t), auth.Options{Argon2Params: testArgon2})
	admin, _ := signIn(t, svc, "casey", "correct horse battery") // the first account is admin
	member, _ := signIn(t, svc, "ada", "correct horse battery")
	has := func(ctx context.Context, p accessv1.Permission) bool {
		t.Helper()
		res, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return slices.Contains(res.Msg.Permissions, p)
	}

	if !has(admin, accessv1.Permission_PERMISSION_INSTANCE_READ) || !has(admin, accessv1.Permission_PERMISSION_ACCOUNT_SECURITY) {
		t.Error("an admin's session should list instance.read and account.security")
	}
	if has(member, accessv1.Permission_PERMISSION_INSTANCE_READ) || !has(member, accessv1.Permission_PERMISSION_PROFILE_MANAGE) {
		t.Error("a member lists their own-account actions and no instance ones")
	}
	if has(admin, accessv1.Permission_PERMISSION_CHANNELS_MANAGE) {
		t.Error("space actions arrive on each Space, not on GetMe")
	}

	id, _ := authctx.From(admin)
	id.Credential = authctx.Credential{Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.InstanceRead}}
	narrow := authctx.WithIdentity(context.Background(), id)
	if !has(narrow, accessv1.Permission_PERMISSION_INSTANCE_READ) ||
		has(narrow, accessv1.Permission_PERMISSION_PROFILE_MANAGE) || has(narrow, accessv1.Permission_PERMISSION_ACCOUNT_SECURITY) {
		t.Error("a token lists only what it was granted, and never account.security")
	}
}

func TestBotsNeverGetASession(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	creds := &authv1.RegisterRequest{Username: "uptime", Password: "correct horse battery"}
	if _, err := svc.Register(ctx, connect.NewRequest(creds)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET kind = 'bot' WHERE username = 'uptime'`); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: creds.Username, Password: creds.Password}))
	if err == nil {
		t.Fatalf("a bot signed in and got token %q", res.Msg.Token)
	}
}

func TestTokenBounds(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	signedIn, _ := signIn(t, svc, "ada", "correct horse battery")
	ada, _ := authctx.From(signedIn)
	ctx := context.Background()

	spaceID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO spaces (id, name, owner_id) VALUES ($1, 'Homelab', $2)`, spaceID, ada.UserID); err != nil {
		t.Fatal(err)
	}
	token := mintToken(t, pool, ada.UserID, []string{"messages.read"}, true, spaceID)

	id, err := svc.VerifyToken(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if id.SessionID != "" || id.Credential.Kind != authctx.CredentialPersonalToken {
		t.Errorf("a token is not a session: %+v", id)
	}
	if !slices.Equal(id.Credential.Grants, []authctx.Action{authctx.MessagesRead}) {
		t.Errorf("grants = %v", id.Credential.Grants)
	}
	if !id.Credential.Reaches(spaceID, "") || id.Credential.Reaches("", "") {
		t.Error("the token should reach its space and nothing else")
	}

	// The space goes, and its bound row with it: the token must not widen.
	if _, err := pool.Exec(ctx, `DELETE FROM spaces WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	id, err = svc.VerifyToken(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if !id.Credential.Bounded || len(id.Credential.Spaces) != 0 || id.Credential.Reaches(spaceID, "") {
		t.Errorf("a token whose bounds are gone must reach nothing: %+v", id.Credential)
	}
}

func TestDeactivationRevokesEveryCredential(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	signedIn, session := signIn(t, svc, "ada", "correct horse battery")
	ada, _ := authctx.From(signedIn)
	ctx := context.Background()
	mintToken(t, pool, ada.UserID, []string{"messages.read"}, false)
	legacy := sha256.Sum256([]byte("legacy"))
	if _, err := pool.Exec(ctx,
		`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
		uuid.NewString(), ada.UserID, legacy[:]); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.SetAccountActive(ctx, ada.UserID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(ctx, session); err == nil {
		t.Error("the session still verifies")
	}
	var credentials, sessions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM credentials WHERE holder_id = $1`, ada.UserID).Scan(&credentials); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id = $1`, ada.UserID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if credentials != 0 {
		t.Errorf("%d credentials left after deactivation", credentials)
	}
	if sessions != 0 {
		t.Errorf("%d legacy sessions left; a rollback would bring them back", sessions)
	}
}

func TestLastAdminCountsPeople(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	if _, err := svc.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{Username: "casey", Password: "correct horse battery"})); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, username, role, kind) VALUES ($1, 'opsbot', 'admin', 'bot')`, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.CountActiveAdmins(ctx); err != nil || n != 1 {
		t.Errorf("CountActiveAdmins = %d, %v; want 1 (people only)", n, err)
	}
	if _, err := svc.SetRoleByUsername(ctx, "casey", authctx.RoleMember); err == nil {
		t.Error("demoted the last person admin because a bot admin remained")
	}
	if _, err := svc.SetRoleByUsername(ctx, "opsbot", authctx.RoleMember); err != nil {
		t.Errorf("demoting a bot admin is never guarded: %v", err)
	}
}
