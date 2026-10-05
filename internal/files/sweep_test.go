package files_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/files"
)

// fileRow inserts a file row and its blob directly, aged by `age`.
func (f *fixture) fileRow(t *testing.T, kind string, age time.Duration) (id, key string) {
	t.Helper()
	ctx := context.Background()
	id = uuid.NewString()
	key = kind + "/" + id
	body := []byte("blob " + id)
	if err := f.store.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO files (id, kind, owner_id, content_type, size, sha256, storage_key, name, created_at)
		VALUES ($1, $2, $3, 'text/plain', $4, '\x00', $5, 'f', now() - $6::interval)`,
		id, kind, f.owner, len(body), key, age.String()); err != nil {
		t.Fatal(err)
	}
	// The blob's mtime is what the store walk ages by.
	then := time.Now().Add(-age)
	if err := os.Chtimes(filepath.Join(f.store.Root(), filepath.FromSlash(key)), then, then); err != nil {
		t.Fatal(err)
	}
	return id, key
}

func (f *fixture) rowExists(t *testing.T, id string) bool {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM files WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func TestSweep(t *testing.T) {
	f := setup(t)
	f.spaces.referenced = map[string]bool{}
	old := 48 * time.Hour

	referenced, refKey := f.fileRow(t, "attachment", old)
	f.spaces.referenced[referenced] = true
	orphan, orphanKey := f.fileRow(t, "attachment", old)
	fresh, freshKey := f.fileRow(t, "attachment", time.Minute) // unreferenced but young
	avatar, avatarKey := f.fileRow(t, "avatar", old)
	f.svc = nil // rebuilt below with an avatars fake that knows this one
	avatars := &fakeAvatars{current: map[string]string{f.member: avatar}}
	f.svc = newService(f, avatars)

	// A blob with no row at all, old; and one that is young.
	ctx := context.Background()
	strayKey := "attachment/" + uuid.NewString()
	if err := f.store.Put(ctx, strayKey, bytes.NewReader([]byte("stray")), 5, "text/plain"); err != nil {
		t.Fatal(err)
	}
	then := time.Now().Add(-old)
	if err := os.Chtimes(filepath.Join(f.store.Root(), filepath.FromSlash(strayKey)), then, then); err != nil {
		t.Fatal(err)
	}
	youngStray := "attachment/" + uuid.NewString()
	if err := f.store.Put(ctx, youngStray, bytes.NewReader([]byte("young")), 5, "text/plain"); err != nil {
		t.Fatal(err)
	}

	rep, err := f.svc.Sweep(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Files != 1 || rep.StrayBlobs != 1 || rep.Errors != 0 {
		t.Errorf("report: %+v", rep)
	}
	for name, tc := range map[string]struct {
		id, key string
		want    bool
	}{
		"referenced attachment stays": {referenced, refKey, true},
		"orphan attachment goes":      {orphan, orphanKey, false},
		"young orphan stays":          {fresh, freshKey, true},
		"current avatar stays":        {avatar, avatarKey, true},
	} {
		if f.rowExists(t, tc.id) != tc.want || f.blobExists(t, tc.key) != tc.want {
			t.Errorf("%s: row %v blob %v, want %v", name, f.rowExists(t, tc.id), f.blobExists(t, tc.key), tc.want)
		}
	}
	if f.blobExists(t, strayKey) {
		t.Errorf("old stray blob should be gone")
	}
	if !f.blobExists(t, youngStray) {
		t.Errorf("young stray blob should stay")
	}

	admin := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.other, Role: authctx.RoleAdmin})
	usage, err := f.svc.GetStorageUsage(admin, connect.NewRequest(&filesv1.GetStorageUsageRequest{}))
	if err != nil || usage.Msg.FileCount != 3 {
		t.Errorf("usage: %v %v", usage, err)
	}
}

// queuedJob is one enqueue as the fake saw it; args is decoded for
// normalise_image, the one kind files queues with arguments.
type queuedJob struct {
	kind     string
	lane     string
	sequence int64
	args     files.NormaliseImageArgs
}

// fakeJobQueue records what was enqueued and answers with a counting id.
type fakeJobQueue struct {
	jobs []queuedJob
	// fail is what every enqueue answers when set.
	fail error
}

func (q *fakeJobQueue) Enqueue(_ context.Context, kind string, args any) (string, error) {
	return q.record(kind, args, "", 0)
}

func (q *fakeJobQueue) EnqueueInLane(_ context.Context, kind string, args any, lane string, sequence int64) (string, error) {
	return q.record(kind, args, lane, sequence)
}

func (q *fakeJobQueue) record(kind string, args any, lane string, sequence int64) (string, error) {
	if q.fail != nil {
		return "", q.fail
	}
	job := queuedJob{kind: kind, lane: lane, sequence: sequence}
	if kind == files.NormaliseImageKind {
		// Through JSON, as the real queue carries them.
		encoded, err := json.Marshal(args)
		if err != nil {
			return "", err
		}
		if err := json.Unmarshal(encoded, &job.args); err != nil {
			return "", err
		}
	}
	q.jobs = append(q.jobs, job)
	return fmt.Sprintf("job-%d", len(q.jobs)), nil
}

// perform runs the oldest queued normalise_image job as the dispatcher
// would and returns what the performer returned.
func (q *fakeJobQueue) perform(t *testing.T, svc *files.Service, lastAttempt bool) error {
	t.Helper()
	for index, job := range q.jobs {
		if job.kind != files.NormaliseImageKind {
			continue
		}
		q.jobs = append(q.jobs[:index], q.jobs[index+1:]...)
		return svc.NormaliseImage(context.Background(), job.args, lastAttempt)
	}
	t.Fatal("no normalise_image job queued")
	return nil
}

// The RPC is admin-only; it queues one sweep_files job rather than
// sweeping in the request, and refuses when no queue is wired.
func TestSweepFilesEnqueues(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	member := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.member, Role: authctx.RoleMember})
	admin := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.other, Role: authctx.RoleAdmin})
	request := func() *connect.Request[filesv1.SweepFilesRequest] {
		return connect.NewRequest(&filesv1.SweepFilesRequest{})
	}

	f.queue = nil
	f.svc = newService(f, f.avatars)
	_, err := f.svc.SweepFiles(admin, request())
	apierrtest.ExpectCode(t, err, connect.CodeUnavailable, "no queue")
	queue := &fakeJobQueue{}
	f.svc.UseJobs(queue)
	_, err = f.svc.SweepFiles(member, request())
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "member sweep")
	res, err := f.svc.SweepFiles(admin, request())
	if err != nil || res.Msg.JobId != "job-1" {
		t.Errorf("admin sweep: %v %v", res, err)
	}
	if len(queue.jobs) != 1 || queue.jobs[0].kind != files.SweepFilesKind {
		t.Errorf("enqueued %v, want one %s", queue.jobs, files.SweepFilesKind)
	}
}

func TestQuota(t *testing.T) {
	f := setup(t)
	f.svc.UsePolicy(fakePolicy{quota: 100})
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `INSERT INTO channels (id, space_id, name, kind) VALUES ($1, $2, 'general', 1)`, f.spaces.channelID, f.space); err != nil {
		t.Fatal(err)
	}
	status, body := f.upload(t, "member", f.spaces.channelID, "big.txt", bytes.Repeat([]byte("x"), 150))
	if status != 507 {
		t.Errorf("over quota: want 507, got %d %v", status, body)
	}
	status, _ = f.upload(t, "member", f.spaces.channelID, "small.txt", bytes.Repeat([]byte("x"), 60))
	if status != 201 {
		t.Errorf("under quota: want 201, got %d", status)
	}
	status, body = f.upload(t, "member", f.spaces.channelID, "second.txt", bytes.Repeat([]byte("x"), 60))
	if status != 507 {
		t.Errorf("cumulative: want 507, got %d %v", status, body)
	}
	// Images go through the same check.
	_, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 8, 8)}))
	apierrtest.ExpectCode(t, err, connect.CodeResourceExhausted, "avatar over quota")
}

// Parallel uploads that each fit alone must not all land: whatever the
// interleaving, the quota holds and the losers' blobs are gone.
func TestQuotaParallelUploads(t *testing.T) {
	f := setup(t)
	f.svc.UsePolicy(fakePolicy{quota: 100})
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `INSERT INTO channels (id, space_id, name, kind) VALUES ($1, $2, 'general', 1)`, f.spaces.channelID, f.space); err != nil {
		t.Fatal(err)
	}
	const racers = 3 // within one account's in-flight limit
	statuses := make([]int, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i], _ = f.upload(t, "member", f.spaces.channelID, fmt.Sprintf("p%d.txt", i), bytes.Repeat([]byte("x"), 60))
		}()
	}
	wg.Wait()
	created := 0
	for _, st := range statuses {
		switch st {
		case 201:
			created++
		case 507:
		default:
			t.Errorf("unexpected status %d", st)
		}
	}
	if created != 1 {
		t.Errorf("created = %d, want 1 (statuses %v)", created, statuses)
	}
	var used int64
	if err := f.pool.QueryRow(ctx, "SELECT COALESCE(SUM(size), 0) FROM files").Scan(&used); err != nil {
		t.Fatal(err)
	}
	if used > 100 {
		t.Errorf("usage %d exceeds the quota", used)
	}
	blobs := 0
	if err := f.store.Walk(ctx, func(string, blob.Stat) error { blobs++; return nil }); err != nil {
		t.Fatal(err)
	}
	if blobs != 1 {
		t.Errorf("blobs on disk = %d, want 1 (losers must clean up)", blobs)
	}
}
