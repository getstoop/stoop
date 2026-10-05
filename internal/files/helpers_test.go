package files_test

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
)

type fixture struct {
	svc     *files.Service
	store   *blob.FS
	pool    *pgxpool.Pool
	owner   string // a member who manages the space
	member  string
	other   string // signed in, not a member
	space   string
	spaces  *fakeSpaces
	avatars *fakeAvatars
	sess    *fakeSessions
	bus     *events.InProcBus
	// queue records what the uploads enqueue; nil means none is wired.
	queue *fakeJobQueue
}

// setup is the service on a fresh database and a scratch store, with its
// ports faked and a space that owner manages and member belongs to.
func setup(t *testing.T) *fixture {
	t.Helper()
	pool := dbtest.New(t)
	ctx := context.Background()
	store, err := blob.NewFS(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{pool: pool, store: store,
		owner:  dbtest.NewUser(t, pool, "owner", "member"),
		member: dbtest.NewUser(t, pool, "member", "member"),
		other:  dbtest.NewUser(t, pool, "other", "member"),
	}
	f.space = uuid.NewString()
	if _, err := pool.Exec(ctx, "INSERT INTO spaces (id, name, owner_id) VALUES ($1, 'S', $2)", f.space, f.owner); err != nil {
		t.Fatal(err)
	}
	f.spaces = &fakeSpaces{
		managers: map[string]bool{f.owner: true},
		members:  map[string]bool{f.owner: true, f.member: true},
		spaceID:  f.space,
		// Any well-formed id: the fake doesn't consult the channels table.
		channelID: uuid.NewString(),
	}
	f.sess = &fakeSessions{users: map[string]authctx.Identity{
		"owner":  {UserID: f.owner, Role: authctx.RoleMember},
		"member": {UserID: f.member, Role: authctx.RoleMember},
		"other":  {UserID: f.other, Role: authctx.RoleMember},
		"admin":  {UserID: f.other, Role: authctx.RoleAdmin},
	}}
	f.bus = events.NewInProcBus()
	f.queue = &fakeJobQueue{}
	f.avatars = &fakeAvatars{current: map[string]string{}}
	f.svc = newService(f, f.avatars)
	return f
}

func newService(f *fixture, avatars files.Avatars) *files.Service {
	svc := files.New(f.pool, f.store, f.bus, avatars, f.spaces, f.sess,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if f.queue != nil {
		svc.UseJobs(f.queue)
	}
	return svc
}

// performImage runs the oldest queued normalise_image job against the
// fixture's service, as the dispatcher would, and fails the test if it
// fails.
func (f *fixture) performImage(t *testing.T) {
	t.Helper()
	if err := f.queue.perform(t, f.svc, false); err != nil {
		t.Fatal(err)
	}
}

func as(userID string) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: userID, Role: authctx.RoleMember})
}
