package files_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
)

// Fake ports: the module under test only needs their contracts.

type fakeAvatars struct{ current map[string]string }

func (f *fakeAvatars) ReferencedFiles(_ context.Context, ids []string) ([]string, error) {
	current := map[string]bool{}
	for _, id := range f.current {
		current[id] = true
	}
	var out []string
	for _, id := range ids {
		if current[id] {
			out = append(out, id)
		}
	}
	return out, nil
}
func (f *fakeAvatars) SetAvatar(_ context.Context, userID, fileID string) (string, error) {
	prev := f.current[userID]
	f.current[userID] = fileID
	return prev, nil
}

type fakeSpaces struct {
	managers   map[string]bool // userID → may manage
	members    map[string]bool // userID → member
	icon       string
	spaceID    string
	channelID  string
	referenced map[string]bool // file ids chat "still points at" (sweep)
}

func (f *fakeSpaces) ReferencedFiles(_ context.Context, ids []string) ([]string, error) {
	var out []string
	for _, id := range ids {
		if f.referenced[id] || id == f.icon {
			out = append(out, id)
		}
	}
	return out, nil
}

// fakePolicy is the quota port with fixed caps: quota is the total,
// maxUpload the per-file limit (0 = none, so the module's ceiling wins).
type fakePolicy struct {
	quota     int64
	maxUpload int64
}

func (p fakePolicy) StorageQuotaBytes(context.Context) (int64, error) { return p.quota, nil }
func (p fakePolicy) MaxUploadBytes(context.Context) (int64, error)    { return p.maxUpload, nil }

func (f *fakeSpaces) RequireManageSpace(ctx context.Context, _ string) error {
	if !f.managers[authctx.UserID(ctx)] {
		return connect.NewError(connect.CodePermissionDenied, errors.New("no"))
	}
	return nil
}
func (f *fakeSpaces) SetSpaceIcon(_ context.Context, _ string, fileID string) (string, error) {
	prev := f.icon
	f.icon = fileID
	return prev, nil
}
func (f *fakeSpaces) IsSpaceMember(_ context.Context, userID, _ string) (bool, error) {
	return f.members[userID], nil
}
func (f *fakeSpaces) ListSpaceIDs(context.Context, string) ([]string, error) {
	return []string{f.spaceID}, nil
}
func (f *fakeSpaces) IsAttachmentReadable(_ context.Context, userID, _ string) (bool, error) {
	return f.members[userID], nil
}
func (f *fakeSpaces) ChannelSpaceForMember(_ context.Context, userID, channelID string) (string, error) {
	if channelID != f.channelID {
		return "", connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
	}
	if !f.members[userID] {
		return "", connect.NewError(connect.CodePermissionDenied, errors.New("not a member"))
	}
	return f.spaceID, nil
}

type fakeSessions struct{ users map[string]authctx.Identity }

func (f *fakeSessions) VerifyRequest(_ context.Context, h http.Header) (authctx.Identity, error) {
	if id, ok := f.users[h.Get("X-Test-User")]; ok {
		return id, nil
	}
	return authctx.Identity{}, errors.New("no session")
}

type fixture struct {
	svc    *files.Service
	store  *blob.FS
	pool   *pgxpool.Pool
	owner  string // a member who manages the space
	member string
	other  string // signed in, not a member
	space  string
	spaces *fakeSpaces
	sess   *fakeSessions
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := dbtest.New(t)
	ctx := context.Background()
	store, err := blob.NewFS(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	mk := func(name string) string {
		id := uuid.NewString()
		if _, err := pool.Exec(ctx, "INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, 'x')", id, name, name); err != nil {
			t.Fatal(err)
		}
		return id
	}
	f := &fixture{pool: pool, store: store, owner: mk("owner"), member: mk("member"), other: mk("other")}
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
	f.svc = newService(f, &fakeAvatars{current: map[string]string{}})
	return f
}

func newService(f *fixture, avatars files.Avatars) *files.Service {
	return files.New(f.pool, f.store, events.NewInProcBus(), avatars, f.spaces, f.sess,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func as(userID string) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: userID, Role: authctx.RoleMember})
}

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 128, A: 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (f *fixture) blobExists(t *testing.T, key string) bool {
	t.Helper()
	_, err := f.store.Stat(context.Background(), key)
	if err != nil && !errors.Is(err, blob.ErrNotFound) {
		t.Fatal(err)
	}
	return err == nil
}

func (f *fixture) get(t *testing.T, id, user string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/files/"+id, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("GET /files/{id}", f.svc.Handler())
	mux.ServeHTTP(rec, req)
	return rec.Result()
}

func TestUploadAvatarStoresAndReplaces(t *testing.T) {
	f := setup(t)
	ctx := as(f.member)

	first, err := f.svc.UploadAvatar(ctx, connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 300, 200)}))
	if err != nil {
		t.Fatal(err)
	}
	id1 := first.Msg.FileId
	if !f.blobExists(t, "avatar/"+id1) {
		t.Fatal("first blob missing")
	}
	// The served file is a 256 px PNG with the required headers.
	res := f.get(t, id1, "other")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET as another signed-in user: %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q", ct)
	}
	if v := res.Header.Get("X-Content-Type-Options"); v != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q", v)
	}
	if v := res.Header.Get("Cache-Control"); v != "private, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", v)
	}
	if v := res.Header.Get("Content-Disposition"); v != "inline" {
		t.Errorf("Content-Disposition = %q", v)
	}
	body, _ := io.ReadAll(res.Body)
	cfg, err := png.DecodeConfig(bytes.NewReader(body))
	if err != nil || cfg.Width != files.AvatarSize || cfg.Height != files.AvatarSize {
		t.Fatalf("served image: %v %dx%d", err, cfg.Width, cfg.Height)
	}

	// Replacing deletes the previous row and blob.
	second, err := f.svc.UploadAvatar(ctx, connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 50, 50)}))
	if err != nil {
		t.Fatal(err)
	}
	id2 := second.Msg.FileId
	if id2 == id1 {
		t.Fatal("expected a new file id")
	}
	if f.blobExists(t, "avatar/"+id1) {
		t.Error("old blob still on disk")
	}
	if !f.blobExists(t, "avatar/"+id2) {
		t.Error("new blob missing")
	}
	if res := f.get(t, id1, "member"); res.StatusCode != http.StatusNotFound {
		t.Errorf("old id after replace: %d", res.StatusCode)
	}
	var n int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM files WHERE owner_id = $1", f.member).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("file rows for user = %d, want 1", n)
	}
}

func TestUploadRejectsBadInput(t *testing.T) {
	f := setup(t)
	ctx := as(f.member)
	cases := map[string][]byte{
		"text renamed png": []byte("just some text\n"),
		"oversize":         append(pngBytes(t, 4, 4), make([]byte, files.MaxImageBytes)...),
		"empty":            nil,
	}
	for name, data := range cases {
		_, err := f.svc.UploadAvatar(ctx, connect.NewRequest(&filesv1.UploadAvatarRequest{Data: data}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: want InvalidArgument, got %v", name, err)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(f.store.Root(), "avatar"))
	if len(entries) != 0 {
		t.Errorf("rejected uploads left %d blobs behind", len(entries))
	}
}

func TestSpaceIconAuthorisation(t *testing.T) {
	f := setup(t)
	// A plain member can't set the icon, and nothing is written.
	_, err := f.svc.UploadSpaceIcon(as(f.member), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 64, 64)}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("member upload: want PermissionDenied, got %v", err)
	}
	if entries, _ := os.ReadDir(filepath.Join(f.store.Root(), "space_icon")); len(entries) != 0 {
		t.Fatal("denied upload wrote a blob")
	}

	res, err := f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 700, 100)}))
	if err != nil {
		t.Fatal(err)
	}
	id := res.Msg.FileId
	if f.spaces.icon != id {
		t.Fatalf("port not told about the new icon (%q)", f.spaces.icon)
	}
	body, _ := io.ReadAll(f.get(t, id, "owner").Body)
	if cfg, err := png.DecodeConfig(bytes.NewReader(body)); err != nil || cfg.Width != files.SpaceIconSize {
		t.Fatalf("icon: %v %dx%d", err, cfg.Width, cfg.Height)
	}

	for user, want := range map[string]int{
		"":       http.StatusUnauthorized,
		"other":  http.StatusForbidden,
		"member": http.StatusOK,
		"owner":  http.StatusOK,
		"admin":  http.StatusOK, // instance admin, not a member
	} {
		if got := f.get(t, id, user).StatusCode; got != want {
			t.Errorf("GET icon as %q: %d, want %d", user, got, want)
		}
	}
	if got := f.get(t, uuid.NewString(), "owner").StatusCode; got != http.StatusNotFound {
		t.Errorf("unknown id: %d", got)
	}
	if got := f.get(t, "not-a-uuid", "owner").StatusCode; got != http.StatusNotFound {
		t.Errorf("malformed id: %d", got)
	}
}
