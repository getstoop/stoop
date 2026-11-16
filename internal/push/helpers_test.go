package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

type fixture struct {
	pool *pgxpool.Pool
	svc  *Service
	user string
}

// setup is the service on a fresh database with one person, ada.
func setup(t *testing.T) *fixture {
	t.Helper()
	pool := dbtest.New(t)
	return &fixture{pool: pool, svc: New(pool), user: dbtest.NewUser(t, pool, "ada", "member")}
}

// session adds a session row for ada and returns a context signed in
// with it, and its id.
func (fix *fixture) session(t *testing.T) (context.Context, string) {
	t.Helper()
	id := uuid.NewString()
	token := make([]byte, 32)
	_, _ = rand.Read(token)
	if _, err := fix.pool.Exec(context.Background(),
		`INSERT INTO credentials (id, holder_id, kind, token_hash, expires_at) VALUES ($1, $2, 'session', $3, now() + interval '1 day')`,
		id, fix.user, token); err != nil {
		t.Fatalf("add session: %v", err)
	}
	return authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: fix.user, SessionID: id, Role: authctx.RoleMember, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: id, Kind: authctx.CredentialSession},
	}), id
}

// token is a context signed in with a personal token: no session.
func (fix *fixture) token() context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: fix.user, Role: authctx.RoleMember, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialPersonalToken,
			Grants: []authctx.Action{authctx.PreferencesManage}},
	})
}

// subscriptions counts the rows for a session.
func (fix *fixture) subscriptions(t *testing.T, sessionID string) int {
	t.Helper()
	var rows int
	if err := fix.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM push_subscriptions WHERE credential_id = $1`, sessionID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

// validRegistration is a request every check accepts.
func validRegistration(t *testing.T) *pushv1.RegisterPushSubscriptionRequest {
	t.Helper()
	device, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return &pushv1.RegisterPushSubscriptionRequest{
		Endpoint:      "https://relay.example/push/abc",
		P256Dh:        device.PublicKey().Bytes(),
		Auth:          auth,
		LocalServerId: "k3x9pq",
		Kinds:         []chatv1.ActivityKind{chatv1.ActivityKind_ACTIVITY_KIND_MENTION, chatv1.ActivityKind_ACTIVITY_KIND_DM},
	}
}
