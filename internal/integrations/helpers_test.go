package integrations

import (
	"context"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

type fixture struct {
	pool    *pgxpool.Pool
	svc     *Service
	bots    *fakeBots
	spaces  *fakeSpaces
	poster  *fakePoster
	policy  *fakePolicy
	jobs    *fakeJobs
	admin   context.Context
	member  context.Context
	space   string
	channel string
}

// setup is the service on a fresh database with its ports faked: casey,
// an instance admin, owns a space with one channel, and ada is a member.
func setup(t *testing.T) *fixture {
	t.Helper()
	pool := dbtest.New(t)
	ctx := context.Background()
	adminID, memberID := dbtest.NewUser(t, pool, "casey", "admin"), dbtest.NewUser(t, pool, "ada", "member")
	spaceID, channelID := uuid.NewString(), uuid.NewString()
	for _, statement := range []string{
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + spaceID + `', 'Porch', '` + adminID + `')`,
		`INSERT INTO space_members (space_id, user_id, role) VALUES ('` + spaceID + `', '` + memberID + `', 'member')`,
		`INSERT INTO channels (id, space_id, name, position) VALUES ('` + channelID + `', '` + spaceID + `', 'general', 0)`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	f := &fixture{
		svc: New(pool, events.NewInProcBus(), slog.Default()), bots: newFakeBots(pool),
		pool:   pool,
		spaces: &fakeSpaces{pool: pool, channel: map[string]string{channelID: spaceID}, admin: map[string]bool{}},
		poster: &fakePoster{}, policy: &fakePolicy{incoming: true, outgoing: true},
		space: spaceID, channel: channelID,
	}
	f.svc.UseBotIdentities(f.bots)
	f.svc.UseSpaceAccess(f.spaces)
	f.svc.UsePoster(f.poster)
	f.svc.UsePolicy(f.policy)
	f.admin = authctx.WithIdentity(ctx, authctx.Identity{UserID: adminID, Role: authctx.RoleAdmin, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialSession}})
	f.member = authctx.WithIdentity(ctx, authctx.Identity{UserID: memberID, Role: authctx.RoleMember, Kind: authctx.KindPerson,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialSession}})
	return f
}
