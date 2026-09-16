package files_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// Attachment retention: old attachments lose their bytes and names and
// stay as expired rows; a pinned message's files and avatars are kept.
func TestAttachmentRetention(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	up := func(name string) string {
		t.Helper()
		status, body := f.upload(t, "member", f.spaces.channelID, name, []byte("contents of "+name))
		if status != http.StatusCreated {
			t.Fatalf("upload %s: %d %v", name, status, body)
		}
		return body["id"].(string)
	}
	old, pinned := up("old.txt"), up("pinned.txt")
	f.spaces.pinned = []string{pinned}
	avatar, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: pngBytes(t, 64, 64)}))
	if err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(31 * 24 * time.Hour)

	// Off: nothing to count, nothing swept.
	if n, err := f.svc.SweepAttachments(ctx, later); err != nil || n != 0 {
		t.Fatalf("sweep with no policy: %d %v", n, err)
	}
	f.svc.UsePolicy(fakePolicy{retentionDays: 30})
	if n, _, err := f.svc.CountExpiringAttachments(ctx, time.Now(), 30); err != nil || n != 0 {
		t.Errorf("count today: %d %v", n, err)
	}
	n, bytes, err := f.svc.CountExpiringAttachments(ctx, later, 30)
	if err != nil || n != 1 || bytes != int64(len("contents of old.txt")) {
		t.Errorf("count in a month: %d files, %d bytes, %v", n, bytes, err)
	}

	if n, err := f.svc.SweepAttachments(ctx, later); err != nil || n != 1 {
		t.Fatalf("sweep: %d %v", n, err)
	}
	infos, err := f.svc.GetFiles(ctx, []string{old, pinned, avatar.Msg.FileId})
	if err != nil {
		t.Fatal(err)
	}
	for _, info := range infos {
		switch info.ID {
		case old:
			if !info.Expired || info.Name != "" || info.Size == 0 {
				t.Errorf("old attachment after the sweep: %+v", info)
			}
		default:
			if info.Expired {
				t.Errorf("kept file expired: %+v", info)
			}
		}
	}
	if f.blobExists(t, "attachment/"+old) || !f.blobExists(t, "attachment/"+pinned) {
		t.Error("the sweep should delete the old blob and only that one")
	}
	if res := f.get(t, old, "member"); res.StatusCode != http.StatusGone {
		t.Errorf("download of an expired attachment: %d, want 410", res.StatusCode)
	}
	if res := f.get(t, old, "other"); res.StatusCode != http.StatusForbidden {
		t.Errorf("a non-member learns it expired: %d, want 403", res.StatusCode)
	}
	if res := f.get(t, pinned, "member"); res.StatusCode != http.StatusOK {
		t.Errorf("download of a pinned message's file: %d", res.StatusCode)
	}

	// Expired files stop counting towards storage, and a second pass has
	// nothing left to do.
	admin := authctx.WithIdentity(ctx, authctx.Identity{UserID: f.other, Role: authctx.RoleAdmin})
	usage, err := f.svc.GetStorageUsage(admin, connect.NewRequest(&filesv1.GetStorageUsageRequest{}))
	if err != nil || usage.Msg.FileCount != 2 {
		t.Errorf("usage after expiry: %v %v", usage, err)
	}
	if n, err := f.svc.SweepAttachments(ctx, later); err != nil || n != 0 {
		t.Errorf("second sweep: %d %v", n, err)
	}
}
