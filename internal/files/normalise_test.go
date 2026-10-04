package files_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/files"
)

// The normalise_image job: an avatar or icon upload is stored as sent and
// pending, invisible to GET and not yet the account's or space's image;
// the job re-encodes it, readies it, swaps the pointer and announces it.

// storedFile is what the row says about a file.
type storedFile struct {
	pending     bool
	contentType string
	size        int64
}

func (f *fixture) storedFile(t *testing.T, id string) storedFile {
	t.Helper()
	var row storedFile
	if err := f.pool.QueryRow(context.Background(), `SELECT pending, content_type, size FROM files WHERE id = $1`, id).Scan(&row.pending, &row.contentType, &row.size); err != nil {
		t.Fatal(err)
	}
	return row
}

// awaitMemberUpdated waits for the event the job publishes, or fails.
func awaitMemberUpdated(t *testing.T, sub *events.Subscription) *realtimev1.MemberUpdated {
	t.Helper()
	select {
	case event := <-sub.Events():
		updated, ok := event.Payload.(*realtimev1.ServerEvent_MemberUpdated)
		if !ok {
			t.Fatalf("published %T, want MemberUpdated", event.Payload)
		}
		return updated.MemberUpdated
	case <-time.After(2 * time.Second):
		t.Fatal("no MemberUpdated published")
		return nil
	}
}

func TestAvatarUploadIsNormalisedByJob(t *testing.T) {
	f := setup(t)
	sub := f.bus.Subscribe(events.SpaceTopic(f.space))
	defer sub.Close()
	ownDevices := f.bus.Subscribe(events.UserTopic(f.member))
	defer ownDevices.Close()
	original := jpegBytes(t, 300, 200)

	res, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: original}))
	if err != nil {
		t.Fatal(err)
	}
	id := res.Msg.FileId

	// Stored as sent, pending, queued in the user's lane, invisible, not yet the avatar.
	if row := f.storedFile(t, id); !row.pending || row.contentType != "image/jpeg" || row.size != int64(len(original)) {
		t.Errorf("pending row = %+v, want pending image/jpeg of %d bytes", row, len(original))
	}
	if len(f.queue.jobs) != 1 {
		t.Fatalf("queued %d jobs, want 1", len(f.queue.jobs))
	}
	job := f.queue.jobs[0]
	want := files.NormaliseImageArgs{FileID: id, UserID: f.member}
	if job.kind != files.NormaliseImageKind || job.lane != "avatar:"+f.member || job.sequence <= 0 || job.args != want {
		t.Errorf("queued %+v, want %s in lane avatar:%s with %+v", job, files.NormaliseImageKind, f.member, want)
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		if got := f.fetch(t, method, id, "other").StatusCode; got != http.StatusNotFound {
			t.Errorf("%s while pending: %d, want 404", method, got)
		}
	}
	if f.avatars.current[f.member] != "" {
		t.Errorf("pointer set before the job: %q", f.avatars.current[f.member])
	}

	f.performImage(t)

	if row := f.storedFile(t, id); row.pending || row.contentType != "image/png" || row.size == int64(len(original)) {
		t.Errorf("ready row = %+v, want a ready PNG of a new size", row)
	}
	expectServedPNG(t, f.get(t, id, "other"), files.AvatarSize)
	if f.avatars.current[f.member] != id {
		t.Errorf("pointer = %q, want %s", f.avatars.current[f.member], id)
	}
	if updated := awaitMemberUpdated(t, sub); updated.SpaceId != f.space || updated.UserId != f.member {
		t.Errorf("MemberUpdated %+v, want space %s user %s", updated, f.space, f.member)
	}
	if updated := awaitMemberUpdated(t, ownDevices); updated.SpaceId != "" || updated.UserId != f.member {
		t.Errorf("MemberUpdated on the user topic %+v, want no space and user %s", updated, f.member)
	}
}

func TestSpaceIconUploadIsNormalisedByJob(t *testing.T) {
	f := setup(t)
	original := pngBytes(t, 700, 100)

	res, err := f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: original}))
	if err != nil {
		t.Fatal(err)
	}
	id := res.Msg.FileId
	if row := f.storedFile(t, id); !row.pending || row.size != int64(len(original)) {
		t.Errorf("pending row = %+v", row)
	}
	job := f.queue.jobs[0]
	want := files.NormaliseImageArgs{FileID: id, SpaceID: f.space}
	if job.kind != files.NormaliseImageKind || job.lane != "space_icon:"+f.space || job.args != want {
		t.Errorf("queued %+v, want lane space_icon:%s with %+v", job, f.space, want)
	}
	if got := f.get(t, id, "owner").StatusCode; got != http.StatusNotFound {
		t.Errorf("GET while pending: %d, want 404", got)
	}
	if f.spaces.icon != "" {
		t.Errorf("icon set before the job: %q", f.spaces.icon)
	}

	f.performImage(t)

	if row := f.storedFile(t, id); row.pending || row.contentType != "image/png" {
		t.Errorf("ready row = %+v", row)
	}
	expectServedPNG(t, f.get(t, id, "member"), files.SpaceIconSize)
	if f.spaces.icon != id {
		t.Errorf("icon = %q, want %s", f.spaces.icon, id)
	}
}

// A truncated PNG: the signature and header pass the request's checks,
// the decode in the job does not. The file is discarded for good.
func TestNormaliseImageDiscardsUndecodableBytes(t *testing.T) {
	f := setup(t)
	const signatureAndHeader = 8 + 25
	truncated := pngBytes(t, 300, 200)[:signatureAndHeader]

	res, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: truncated}))
	if err != nil {
		t.Fatalf("the request should accept what only a decode refuses: %v", err)
	}
	id := res.Msg.FileId
	if !f.rowExists(t, id) || !f.blobExists(t, "avatar/"+id) {
		t.Fatal("pending file not stored")
	}

	err = f.queue.perform(t, f.svc, false)
	if !errors.Is(err, files.ErrImageUnusable) {
		t.Fatalf("want ErrImageUnusable, got %v", err)
	}
	if f.rowExists(t, id) || f.blobExists(t, "avatar/"+id) {
		t.Error("the unusable file was not discarded")
	}
	if f.avatars.current[f.member] != "" {
		t.Errorf("pointer touched: %q", f.avatars.current[f.member])
	}
}

// A port failure that is not NotFound is transient: the file stays for the
// retry, unless this was the last attempt, when it goes.
func TestNormaliseImageTransientFailure(t *testing.T) {
	f := setup(t)
	f.avatars.setErr = errors.New("database away")
	upload := func() string {
		t.Helper()
		res, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 40, 40)}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.FileId
	}

	retried := upload()
	err := f.queue.perform(t, f.svc, false)
	if err == nil || errors.Is(err, files.ErrImageUnusable) {
		t.Fatalf("want a transient error, got %v", err)
	}
	if !f.rowExists(t, retried) || !f.blobExists(t, "avatar/"+retried) {
		t.Error("a file awaiting a retry was discarded")
	}

	final := upload()
	err = f.queue.perform(t, f.svc, true)
	if err == nil || errors.Is(err, files.ErrImageUnusable) {
		t.Fatalf("want the transient error returned, got %v", err)
	}
	if f.rowExists(t, final) || f.blobExists(t, "avatar/"+final) {
		t.Error("the last attempt left the file behind")
	}
	if f.avatars.current[f.member] != "" {
		t.Errorf("pointer touched: %q", f.avatars.current[f.member])
	}
}

// NotFound from the port means the account or space is gone: permanent.
func TestNormaliseImageTargetGone(t *testing.T) {
	f := setup(t)
	gone := connect.NewError(connect.CodeNotFound, errors.New("gone"))
	f.avatars.setErr = gone
	f.spaces.setIconErr = gone

	avatar, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 40, 40)}))
	if err != nil {
		t.Fatal(err)
	}
	icon, err := f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 40, 40)}))
	if err != nil {
		t.Fatal(err)
	}
	// The jobs run in queue order: the avatar's, then the icon's.
	for _, key := range []string{"avatar/" + avatar.Msg.FileId, "space_icon/" + icon.Msg.FileId} {
		if err := f.queue.perform(t, f.svc, false); !errors.Is(err, files.ErrImageUnusable) {
			t.Errorf("want ErrImageUnusable, got %v", err)
		}
		if f.blobExists(t, key) {
			t.Errorf("blob %s kept for a target that is gone", key)
		}
	}
	for _, id := range []string{avatar.Msg.FileId, icon.Msg.FileId} {
		if f.rowExists(t, id) {
			t.Errorf("row %s kept for a target that is gone", id)
		}
	}
}

// The sweep took an old pending file nothing pointed at; its job then
// finds no row and is discarded.
func TestNormaliseImageAfterSweepIsDiscarded(t *testing.T) {
	f := setup(t)
	f.spaces.referenced = map[string]bool{}
	id, key := f.fileRow(t, "avatar", 48*time.Hour)
	if _, err := f.pool.Exec(context.Background(), `UPDATE files SET pending = true WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.rowExists(t, id) || f.blobExists(t, key) {
		t.Fatal("an old unreferenced pending file survived the sweep")
	}
	err := f.svc.NormaliseImage(context.Background(), files.NormaliseImageArgs{FileID: id, UserID: f.member}, false)
	if !errors.Is(err, files.ErrImageUnusable) {
		t.Errorf("want ErrImageUnusable, got %v", err)
	}
}

func TestUploadWithoutQueueIsUnavailable(t *testing.T) {
	f := setup(t)
	f.queue = nil
	f.svc = newService(f, f.avatars)

	_, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 40, 40)}))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("avatar: want Unavailable, got %v", err)
	}
	_, err = f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: pngBytes(t, 40, 40)}))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("icon: want Unavailable, got %v", err)
	}
	var rows int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM files`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d rows stored with no queue", rows)
	}
}
