package files_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	filesv1 "github.com/Jhut89/stoop/gen/stoop/files/v1"
	"github.com/Jhut89/stoop/internal/authctx"
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

	// The RPC is admin-only and reports the same numbers.
	member := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.member, Role: authctx.RoleMember})
	if _, err := f.svc.SweepFiles(member, connect.NewRequest(&filesv1.SweepFilesRequest{})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("member sweep: want permission_denied, got %v", err)
	}
	admin := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.other, Role: authctx.RoleAdmin})
	res, err := f.svc.SweepFiles(admin, connect.NewRequest(&filesv1.SweepFilesRequest{}))
	if err != nil || res.Msg.FilesRemoved != 0 {
		t.Errorf("second sweep: %v %v", res, err)
	}
	usage, err := f.svc.GetStorageUsage(admin, connect.NewRequest(&filesv1.GetStorageUsageRequest{}))
	if err != nil || usage.Msg.FileCount != 3 {
		t.Errorf("usage: %v %v", usage, err)
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
	if _, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 8, 8)})); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Errorf("avatar over quota: want resource_exhausted, got %v", err)
	}
}
