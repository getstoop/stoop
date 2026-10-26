package files_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"math/rand/v2"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/files"
)

// The thumbnail_attachment job and the paths that serve and remove what
// it makes. The pixels themselves are tested in
// thumbnail_image_internal_test.go.

// uploadImage posts an image attachment as member and returns its id.
func (f *fixture) uploadImage(t *testing.T, name string, data []byte) string {
	t.Helper()
	status, body := f.upload(t, "member", f.spaces.channelID, name, data)
	if status != http.StatusCreated {
		t.Fatalf("upload %s: %d %v", name, status, body)
	}
	return body["id"].(string)
}

// thumbnailJobs takes the queued thumbnail_attachment jobs' file ids off
// the fake queue.
func (f *fixture) thumbnailJobs() []string {
	var ids []string
	kept := f.queue.jobs[:0]
	for _, job := range f.queue.jobs {
		if job.kind == files.ThumbnailAttachmentKind {
			ids = append(ids, job.thumbnail.FileID)
			continue
		}
		kept = append(kept, job)
	}
	f.queue.jobs = kept
	return ids
}

// makeThumbnail runs the job for an original and returns the thumbnail's
// id from what the message would carry.
func (f *fixture) makeThumbnail(t *testing.T, originalID string) string {
	t.Helper()
	ctx := context.Background()
	if err := f.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: originalID}); err != nil {
		t.Fatal(err)
	}
	infos, err := f.svc.GetFiles(ctx, []string{originalID})
	if err != nil || len(infos) != 1 || infos[0].ThumbnailFileID == "" {
		t.Fatalf("after the job: %+v %v", infos, err)
	}
	return infos[0].ThumbnailFileID
}

func (f *fixture) age(t *testing.T, ids ...string) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), `UPDATE files SET created_at = now() - interval '48 hours' WHERE id = ANY($1::uuid[])`, ids); err != nil {
		t.Fatal(err)
	}
}

func TestThumbnailJob(t *testing.T) {
	fixture := setup(t)
	ctx := context.Background()
	photo := fixture.uploadImage(t, "photo.jpg", jpegBytes(t, 2000, 1500))
	fixture.uploadImage(t, "small.jpg", jpegBytes(t, 800, 600))
	if queued := fixture.thumbnailJobs(); len(queued) != 1 || queued[0] != photo {
		t.Fatalf("queued %v, want only the large photo's", queued)
	}

	thumbnail := fixture.makeThumbnail(t, photo)
	var kind, contentType string
	var of *string
	var width, height int32
	if err := fixture.pool.QueryRow(ctx, `SELECT kind, content_type, thumbnail_of::text, width, height FROM files WHERE id = $1`, thumbnail).
		Scan(&kind, &contentType, &of, &width, &height); err != nil {
		t.Fatal(err)
	}
	if kind != "attachment_thumbnail" || contentType != "image/jpeg" || of == nil || *of != photo || width != 1024 || height != 768 {
		t.Errorf("thumbnail row: %s %s of %v, %d×%d", kind, contentType, of, width, height)
	}
	if !fixture.blobExists(t, "attachment_thumbnail/"+thumbnail) {
		t.Error("thumbnail blob missing")
	}

	// A second run, a retry, makes nothing more.
	if err := fixture.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: photo}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := fixture.pool.QueryRow(ctx, `SELECT count(*) FROM files WHERE thumbnail_of = $1`, photo).Scan(&count); err != nil || count != 1 {
		t.Errorf("thumbnails after a retry: %d %v", count, err)
	}

	// Served as its original is, a picture of the right size.
	res := fixture.get(t, thumbnail, "member")
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "image/jpeg" || res.Header.Get("Content-Disposition") != "inline" {
		t.Fatalf("GET thumbnail as member: %d %v", res.StatusCode, res.Header)
	}
	cfg, _, err := image.DecodeConfig(res.Body)
	if err != nil || cfg.Width != 1024 || cfg.Height != 768 {
		t.Errorf("served thumbnail: %+v %v", cfg, err)
	}
	if res := fixture.get(t, thumbnail, "other"); res.StatusCode != http.StatusForbidden {
		t.Errorf("GET thumbnail as a non-member: %d, want 403", res.StatusCode)
	}

	// Counted on the disk, though no quota stood in its way.
	usage, err := fixture.svc.StorageUsage(ctx)
	if err != nil || usage.Files != 3 {
		t.Errorf("usage: %+v %v", usage, err)
	}

	// Gone, or bytes that won't decode, are permanent.
	if err := fixture.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: uuid.NewString()}); !errors.Is(err, files.ErrNoThumbnail) {
		t.Errorf("a missing file: %v", err)
	}
	broken := fixture.uploadImage(t, "broken.jpg", append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte("x"), 600)...))
	if queued := fixture.thumbnailJobs(); len(queued) != 0 {
		t.Errorf("a JPEG that won't measure was queued: %v", queued)
	}
	if err := fixture.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: broken}); !errors.Is(err, files.ErrNoThumbnail) {
		t.Errorf("bytes that won't decode: %v", err)
	}
	// An image that needs none is a success with nothing made.
	small := fixture.uploadImage(t, "small.png", pngBytes(t, 300, 200))
	if err := fixture.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: small}); err != nil {
		t.Errorf("a small image: %v", err)
	}
	if infos, _ := fixture.svc.GetFiles(ctx, []string{small}); len(infos) != 1 || infos[0].ThumbnailFileID != "" {
		t.Errorf("a small image got a thumbnail: %+v", infos)
	}
	// Nor is one whose thumbnail would be no smaller: noise saved at the
	// lowest quality, against a thumbnail at a good one.
	noise := image.NewGray(image.Rect(0, 0, 1100, 1000))
	random := rand.New(rand.NewPCG(1, 2))
	for i := range noise.Pix {
		noise.Pix[i] = uint8(random.IntN(256))
	}
	var coarse bytes.Buffer
	if err := jpeg.Encode(&coarse, noise, &jpeg.Options{Quality: 1}); err != nil {
		t.Fatal(err)
	}
	cheap := fixture.uploadImage(t, "coarse.jpg", coarse.Bytes())
	if err := fixture.svc.ThumbnailAttachment(ctx, files.ThumbnailAttachmentArgs{FileID: cheap}); err != nil {
		t.Errorf("a coarse image: %v", err)
	}
	if infos, _ := fixture.svc.GetFiles(ctx, []string{cheap}); len(infos) != 1 || infos[0].ThumbnailFileID != "" {
		t.Errorf("a %d-byte image got a larger thumbnail: %+v", coarse.Len(), infos)
	}
}

// A DM's attachment is readable through message_attachments, which holds
// only the original's id: the thumbnail is authorised by asking about
// the original.
func TestThumbnailOfDirectMessageAttachment(t *testing.T) {
	fixture := setup(t)
	ctx := context.Background()
	original := uuid.NewString()
	data := jpegBytes(t, 1600, 1200)
	if err := fixture.store.Put(ctx, "attachment/"+original, bytes.NewReader(data), int64(len(data)), "image/jpeg"); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(ctx, `INSERT INTO files (id, kind, owner_id, content_type, size, sha256, storage_key, name)
		VALUES ($1, 'attachment', $2, 'image/jpeg', $3, '\x00', $4, 'dm.jpg')`, original, fixture.owner, len(data), "attachment/"+original); err != nil {
		t.Fatal(err)
	}
	thumbnail := fixture.makeThumbnail(t, original)
	fixture.spaces.readableFiles = map[string]bool{original: true}
	for user, want := range map[string]int{
		"owner":  http.StatusOK, // a participant
		"member": http.StatusOK, // a participant
		"other":  http.StatusForbidden,
		"admin":  http.StatusForbidden, // no admin bypass
	} {
		if res := fixture.get(t, thumbnail, user); res.StatusCode != want {
			t.Errorf("DM thumbnail as %s: %d, want %d", user, res.StatusCode, want)
		}
	}
}

// Every path that removes an original takes its thumbnail's row and
// blob; the ones that keep an original keep its thumbnail.
func TestThumbnailRemoval(t *testing.T) {
	fixture := setup(t)
	ctx := context.Background()
	fixture.spaces.referenced = map[string]bool{}
	type pair struct{ original, thumbnail string }
	withThumbnail := func(name string) pair {
		original := fixture.uploadImage(t, name, jpegBytes(t, 1500, 1100))
		return pair{original, fixture.makeThumbnail(t, original)}
	}
	exists := func(p pair) (bool, bool) {
		return fixture.rowExists(t, p.thumbnail), fixture.blobExists(t, "attachment_thumbnail/"+p.thumbnail)
	}

	// Retention: an expiring original's thumbnail goes; a pinned one's stays.
	expiring, pinned := withThumbnail("old.jpg"), withThumbnail("pinned.jpg")
	fixture.spaces.pinned = []string{pinned.original}
	fixture.svc.UsePolicy(fakePolicy{retentionDays: 30})
	var originalBytes, thumbnailBytes int64
	if err := fixture.pool.QueryRow(ctx, `SELECT
		(SELECT size FROM files WHERE id = $1), (SELECT size FROM files WHERE id = $2)`, expiring.original, expiring.thumbnail).
		Scan(&originalBytes, &thumbnailBytes); err != nil {
		t.Fatal(err)
	}
	if n, freed, err := fixture.svc.CountExpiringAttachments(ctx, time.Now().Add(31*24*time.Hour), 30); err != nil || n != 1 || freed != originalBytes+thumbnailBytes {
		t.Errorf("retention preview: %d files, %d bytes, %v; want 1 and %d", n, freed, err, originalBytes+thumbnailBytes)
	}
	if n, err := fixture.svc.SweepAttachments(ctx, time.Now().Add(31*24*time.Hour)); err != nil || n != 1 {
		t.Fatalf("retention: %d %v", n, err)
	}
	if row, blob := exists(expiring); row || blob {
		t.Errorf("expired original's thumbnail: row %v blob %v, want both gone", row, blob)
	}
	if row, blob := exists(pinned); !row || !blob {
		t.Errorf("pinned original's thumbnail: row %v blob %v, want both kept", row, blob)
	}
	if infos, _ := fixture.svc.GetFiles(ctx, []string{expiring.original}); len(infos) != 1 || infos[0].ThumbnailFileID != "" {
		t.Errorf("an expired original still names a thumbnail: %+v", infos)
	}

	// A thumbnail the expiry missed answers 410, after the usual check, and
	// the sweep takes it.
	missed := withThumbnail("missed.jpg")
	fixture.spaces.referenced[missed.original] = true
	if _, err := fixture.pool.Exec(ctx, `UPDATE files SET expired_at = now() WHERE id = $1`, missed.original); err != nil {
		t.Fatal(err)
	}
	if res := fixture.get(t, missed.thumbnail, "member"); res.StatusCode != http.StatusGone {
		t.Errorf("thumbnail of an expired original: %d, want 410", res.StatusCode)
	}
	if res := fixture.get(t, missed.thumbnail, "other"); res.StatusCode != http.StatusForbidden {
		t.Errorf("a non-member learns it expired: %d, want 403", res.StatusCode)
	}

	// The sweep keeps a thumbnail while its original is live and
	// referenced, and takes it with an original nothing points at.
	kept, unclaimed := withThumbnail("kept.jpg"), withThumbnail("unclaimed.jpg")
	fixture.spaces.referenced[kept.original] = true
	fixture.age(t, missed.original, missed.thumbnail, kept.original, kept.thumbnail, unclaimed.original, unclaimed.thumbnail, pinned.original, pinned.thumbnail)
	fixture.spaces.referenced[pinned.original] = true
	rep, err := fixture.svc.Sweep(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Files != 3 || rep.Errors != 0 {
		t.Errorf("sweep report %+v, want 3 files: missed's thumbnail, unclaimed and its thumbnail", rep)
	}
	for name, tc := range map[string]struct {
		pair pair
		want bool
	}{
		"live original's thumbnail":      {kept, true},
		"expired original's thumbnail":   {missed, false},
		"unclaimed original's thumbnail": {unclaimed, false},
	} {
		if row, blob := exists(tc.pair); row != tc.want || blob != tc.want {
			t.Errorf("%s: row %v blob %v, want %v", name, row, blob, tc.want)
		}
	}
	if !fixture.rowExists(t, missed.original) || fixture.rowExists(t, unclaimed.original) {
		t.Error("the sweep should keep the expired original and take the unclaimed one")
	}

	// Deleting a message's files takes their thumbnails.
	if err := fixture.svc.DeleteFiles(ctx, []string{kept.original}); err != nil {
		t.Fatal(err)
	}
	if row, blob := exists(kept); row || blob {
		t.Errorf("after DeleteFiles: row %v blob %v, want both gone", row, blob)
	}
}
