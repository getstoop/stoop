package files_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
)

// Fake ports: the module under test only needs their contracts.

type fakeAvatars struct {
	current map[string]string
	bots    map[string]bool
	// setErr is what SetAvatar answers when set.
	setErr error
}

func (f *fakeAvatars) IsBot(_ context.Context, userID string) (bool, error) {
	return f.bots[userID], nil
}

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
	if f.setErr != nil {
		return "", f.setErr
	}
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
	pinned     []string        // files on pinned messages (retention)
	setIconErr error           // what SetSpaceIcon answers when set
	invite     string          // a usable invite code to the space
}

func (f *fakeSpaces) InviteShowsIcon(_ context.Context, code, fileID string) (bool, error) {
	return f.invite != "" && code == f.invite && fileID == f.icon, nil
}

func (f *fakeSpaces) PinnedFileIDs(context.Context) ([]string, error) { return f.pinned, nil }

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
	quota         int64
	maxUpload     int64
	retentionDays int
}

func (p fakePolicy) StorageQuotaBytes(context.Context) (int64, error) { return p.quota, nil }
func (p fakePolicy) MaxUploadBytes(context.Context) (int64, error)    { return p.maxUpload, nil }
func (p fakePolicy) AttachmentRetentionDays(context.Context) (int, error) {
	return p.retentionDays, nil
}

func (f *fakeSpaces) RequireManageSpace(ctx context.Context, _ string) error {
	if !f.managers[authctx.UserID(ctx)] {
		return connect.NewError(connect.CodePermissionDenied, errors.New("no"))
	}
	return nil
}
func (f *fakeSpaces) SetSpaceIcon(_ context.Context, _ string, fileID string) (string, error) {
	if f.setIconErr != nil {
		return "", f.setIconErr
	}
	prev := f.icon
	f.icon = fileID
	return prev, nil
}
func (f *fakeSpaces) MayReadSpace(ctx context.Context, _ string) (bool, error) {
	return f.members[authctx.UserID(ctx)] || authctx.IsAdmin(ctx), nil
}
func (f *fakeSpaces) ListSpaceIDs(context.Context, string) ([]string, error) {
	return []string{f.spaceID}, nil
}
func (f *fakeSpaces) IsAttachmentReadable(_ context.Context, userID, _ string) (bool, error) {
	return f.members[userID], nil
}
func (f *fakeSpaces) ChannelSpaceToPostIn(_ context.Context, userID, channelID string) (string, error) {
	if channelID != f.channelID {
		return "", connect.NewError(connect.CodeNotFound, errors.New("channel not found"))
	}
	if !f.members[userID] {
		return "", connect.NewError(connect.CodePermissionDenied, errors.New("not a member"))
	}
	return f.spaceID, nil
}

type fakeSessions struct{ users map[string]authctx.Identity }

func (f *fakeSessions) VerifyRequest(_ context.Context, header http.Header) (authctx.Identity, error) {
	if id, ok := f.users[header.Get("X-Test-User")]; ok {
		return id, nil
	}
	return authctx.Identity{}, authctx.ErrNoSession
}

func testImage(width, height int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for row := 0; row < height; row++ {
		for column := 0; column < width; column++ {
			img.Set(column, row, color.NRGBA{R: uint8(column), G: uint8(row), B: 128, A: 255})
		}
	}
	return img
}

func pngBytes(t *testing.T, width, height int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, testImage(width, height)); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func jpegBytes(t *testing.T, width, height int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, testImage(width, height), nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
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
	return f.fetch(t, http.MethodGet, id, user)
}

// getWithInvite is a GET from someone not signed in, carrying an invite code.
func (f *fixture) getWithInvite(t *testing.T, id, code string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/files/"+id+"?invite="+code, nil)
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("GET /files/{id}", f.svc.Handler())
	mux.ServeHTTP(rec, req)
	return rec.Result()
}

func (f *fixture) fetch(t *testing.T, method, id, user string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, "/files/"+id, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("GET /files/{id}", f.svc.Handler())
	mux.Handle("HEAD /files/{id}", f.svc.Handler())
	mux.ServeHTTP(rec, req)
	return rec.Result()
}

// expectServedPNG checks a GET of a normalised image: 200, the headers
// every file carries, and a size×size PNG body.
func expectServedPNG(t *testing.T, res *http.Response, size int) {
	t.Helper()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET: %d", res.StatusCode)
	}
	for header, want := range map[string]string{
		"Content-Type":           "image/png",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "private, max-age=31536000, immutable",
		"Content-Disposition":    "inline",
	} {
		if got := res.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	body, _ := io.ReadAll(res.Body)
	cfg, err := png.DecodeConfig(bytes.NewReader(body))
	if err != nil || cfg.Width != size || cfg.Height != size {
		t.Fatalf("served image: %v %dx%d, want %dx%d", err, cfg.Width, cfg.Height, size, size)
	}
}

func TestUploadAvatarRefusesBots(t *testing.T) {
	f := setup(t)
	ctx := authctx.WithIdentity(context.Background(), authctx.Identity{UserID: f.member, Role: authctx.RoleMember, Kind: authctx.KindBot})
	_, err := f.svc.UploadAvatar(ctx, connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 300, 200)}))
	apierrtest.ExpectCode(t, err, connect.CodeFailedPrecondition, "a bot set its own avatar")
}

func TestUploadBotAvatar(t *testing.T) {
	f := setup(t)
	avatars := &fakeAvatars{current: map[string]string{}, bots: map[string]bool{f.member: true}}
	svc := newService(f, avatars)
	admin := authctx.WithIdentity(context.Background(), authctx.Identity{UserID: f.other, Role: authctx.RoleAdmin})
	data := pngBytes(t, 300, 200)
	adminDevices := f.bus.Subscribe(events.UserTopic(f.other))
	defer adminDevices.Close()

	// A member can't; an admin can't aim it at a person.
	_, err := svc.UploadBotAvatar(as(f.owner), connect.NewRequest(&filesv1.UploadBotAvatarRequest{UserId: f.member, Data: data}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "a member set a bot's avatar")
	_, err = svc.UploadBotAvatar(admin, connect.NewRequest(&filesv1.UploadBotAvatarRequest{UserId: f.owner, Data: data}))
	apierrtest.ExpectCode(t, err, connect.CodeFailedPrecondition, "an admin set a person's avatar")
	_, err = svc.UploadBotAvatar(admin, connect.NewRequest(&filesv1.UploadBotAvatarRequest{UserId: "not-an-id", Data: data}))
	apierrtest.ExpectCode(t, err, connect.CodeNotFound, "a junk id")

	res, err := svc.UploadBotAvatar(admin, connect.NewRequest(&filesv1.UploadBotAvatarRequest{UserId: f.member, Data: data}))
	if err != nil {
		t.Fatal(err)
	}
	if job := f.queue.jobs[0]; job.lane != "avatar:"+f.member || job.args.UserID != f.member || job.args.UploaderID != f.other {
		t.Errorf("queued %+v, want the bot's lane, uploaded by the admin", job)
	}
	if avatars.current[f.member] != "" {
		t.Errorf("avatar set before the job ran: %q", avatars.current[f.member])
	}
	if err := f.queue.perform(t, svc, false); err != nil {
		t.Fatal(err)
	}
	if avatars.current[f.member] != res.Msg.FileId || !f.blobExists(t, "avatar/"+res.Msg.FileId) {
		t.Errorf("avatar not set: current %q, file %q", avatars.current[f.member], res.Msg.FileId)
	}
	// The admin shares no space with the bot; their own devices hear it.
	if updated := awaitMemberUpdated(t, adminDevices); updated.SpaceId != "" || updated.UserId != f.member {
		t.Errorf("MemberUpdated on the admin's topic %+v, want no space and user %s", updated, f.member)
	}
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
	f.performImage(t)
	// The served file is a 256 px PNG with the required headers.
	expectServedPNG(t, f.get(t, id1, "other"), files.AvatarSize)

	// Replacing deletes the previous row and blob once the job has run.
	second, err := f.svc.UploadAvatar(ctx, connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 50, 50)}))
	if err != nil {
		t.Fatal(err)
	}
	id2 := second.Msg.FileId
	if !f.blobExists(t, "avatar/"+id1) || f.avatars.current[f.member] != id1 {
		t.Error("the old avatar went before the job ran")
	}
	f.performImage(t)
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
	var count int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM files WHERE owner_id = $1", f.member).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("file rows for user = %d, want 1", count)
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
		apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, name)
	}
	entries, _ := os.ReadDir(filepath.Join(f.store.Root(), "avatar"))
	if len(entries) != 0 {
		t.Errorf("rejected uploads left %d blobs behind", len(entries))
	}
	if len(f.queue.jobs) != 0 {
		t.Errorf("rejected uploads queued %d jobs", len(f.queue.jobs))
	}
}

func TestSpaceIconAuthorisation(t *testing.T) {
	f := setup(t)
	// A plain member can't set the icon, and nothing is written.
	_, err := f.svc.UploadSpaceIcon(as(f.member), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 64, 64)}))
	apierrtest.RequireCode(t, err, connect.CodePermissionDenied, "member upload")
	if entries, _ := os.ReadDir(filepath.Join(f.store.Root(), "space_icon")); len(entries) != 0 {
		t.Fatal("denied upload wrote a blob")
	}

	res, err := f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 700, 100)}))
	if err != nil {
		t.Fatal(err)
	}
	id := res.Msg.FileId
	if job := f.queue.jobs[0]; job.lane != "space_icon:"+f.space || job.args.SpaceID != f.space || job.args.UserID != "" {
		t.Errorf("queued %+v, want the space's lane", job)
	}
	f.performImage(t)
	if f.spaces.icon != id {
		t.Fatalf("port not told about the new icon (%q)", f.spaces.icon)
	}
	expectServedPNG(t, f.get(t, id, "owner"), files.SpaceIconSize)

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

	// Not signed in: the icon loads only with a usable invite to its space,
	// and every other case reads as a plain 401.
	f.spaces.invite = "goodcode"
	expectServedPNG(t, f.getWithInvite(t, id, "goodcode"), files.SpaceIconSize)
	avatar, _ := f.fileRow(t, "avatar", 0)
	for name, got := range map[string]int{
		"wrong code":        f.getWithInvite(t, id, "badcode").StatusCode,
		"another file":      f.getWithInvite(t, avatar, "goodcode").StatusCode,
		"unknown id":        f.getWithInvite(t, uuid.NewString(), "goodcode").StatusCode,
		"malformed id":      f.getWithInvite(t, "not-a-uuid", "goodcode").StatusCode,
		"no invite to show": f.getWithInvite(t, id, "").StatusCode,
	} {
		if got != http.StatusUnauthorized {
			t.Errorf("signed out, %s: %d, want 401", name, got)
		}
	}

	if got := f.get(t, uuid.NewString(), "owner").StatusCode; got != http.StatusNotFound {
		t.Errorf("unknown id: %d", got)
	}
	if got := f.get(t, "not-a-uuid", "owner").StatusCode; got != http.StatusNotFound {
		t.Errorf("malformed id: %d", got)
	}
}
