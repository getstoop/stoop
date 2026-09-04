package files_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/files"
)

// upload posts a multipart form as the given test user and returns the
// status and decoded JSON body.
func (f *fixture) upload(t *testing.T, user, channelID, filename string, body []byte) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if channelID != "" {
		_ = w.WriteField("channel_id", channelID)
	}
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(body)
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, "/files/upload", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	rec := httptest.NewRecorder()
	f.svc.UploadHandler().ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestUploadAttachmentStoresAsSent(t *testing.T) {
	f := setup(t)
	ch := f.spaces.channelID
	text := []byte("hello, this is a plain text file\n")
	status, body := f.upload(t, "member", ch, "../../notes.txt", text)
	if status != http.StatusCreated {
		t.Fatalf("status %d: %v", status, body)
	}
	id, _ := body["id"].(string)
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("id %q: %v", id, err)
	}
	if body["name"] != "notes.txt" {
		t.Errorf("name = %v, want the sanitised basename", body["name"])
	}
	if ct, _ := body["contentType"].(string); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("contentType = %v, want sniffed text/plain", ct)
	}
	if body["size"] != float64(len(text)) {
		t.Errorf("size = %v", body["size"])
	}
	if !f.blobExists(t, "attachment/"+id) {
		t.Fatal("blob missing")
	}

	// Served as a download (not raster), members only, bytes untouched.
	res := f.get(t, id, "member")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET as member: %d", res.StatusCode)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	got, _ := io.ReadAll(res.Body)
	if !bytes.Equal(got, text) {
		t.Error("served bytes differ from the upload")
	}
	if got := f.get(t, id, "other").StatusCode; got != http.StatusForbidden {
		t.Errorf("GET as non-member: %d", got)
	}

	// The port sees it, and deletion removes row and blob.
	infos, err := f.svc.GetFiles(context.Background(), []string{id, uuid.NewString()})
	if err != nil || len(infos) != 1 || infos[0].Kind != files.KindAttachment || infos[0].SpaceID != f.space || infos[0].OwnerID != f.member {
		t.Fatalf("GetFiles: %v %+v", err, infos)
	}
	if err := f.svc.DeleteFiles(context.Background(), []string{id}); err != nil {
		t.Fatal(err)
	}
	if f.blobExists(t, "attachment/"+id) {
		t.Error("blob still present after DeleteFiles")
	}
	if got := f.get(t, id, "member").StatusCode; got != http.StatusNotFound {
		t.Errorf("GET after delete: %d", got)
	}
}

func TestUploadAttachmentSniffsImagesAndSVG(t *testing.T) {
	f := setup(t)
	ch := f.spaces.channelID
	// A PNG named .txt is still an image (rendered inline)…
	_, body := f.upload(t, "member", ch, "photo.txt", pngBytes(t, 8, 8))
	if body["contentType"] != "image/png" {
		t.Errorf("png: contentType = %v", body["contentType"])
	}
	if cd := f.get(t, body["id"].(string), "member").Header.Get("Content-Disposition"); cd != "inline" {
		t.Errorf("png disposition = %q", cd)
	}
	// …and an SVG named .png is never inline.
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	_, body = f.upload(t, "member", ch, "logo.png", svg)
	ct, _ := body["contentType"].(string)
	if strings.HasPrefix(ct, "image/") && ct != "image/svg+xml" {
		t.Errorf("svg sniffed as raster: %q", ct)
	}
	res := f.get(t, body["id"].(string), "member")
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("svg disposition = %q (content-type %q)", cd, res.Header.Get("Content-Type"))
	}
}

func TestUploadAttachmentRejects(t *testing.T) {
	f := setup(t)
	ch := f.spaces.channelID
	cases := []struct {
		name    string
		user    string
		channel string
		file    []byte
		want    int
	}{
		{"signed out", "", ch, []byte("x"), http.StatusUnauthorized},
		{"non-member", "other", ch, []byte("x"), http.StatusForbidden},
		{"unknown channel", "member", uuid.NewString(), []byte("x"), http.StatusNotFound},
		{"missing channel", "member", "", []byte("x"), http.StatusBadRequest},
		{"empty file", "member", ch, nil, http.StatusBadRequest},
		{"oversize", "member", ch, make([]byte, files.MaxAttachmentBytes+1), http.StatusRequestEntityTooLarge},
	}
	for _, c := range cases {
		status, body := f.upload(t, c.user, c.channel, "f.bin", c.file)
		if status != c.want {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.want, body)
		}
		if body["error"] == nil {
			t.Errorf("%s: no error message in body", c.name)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(f.store.Root(), "attachment"))
	if len(entries) != 0 {
		t.Errorf("rejected uploads left %d blobs", len(entries))
	}
}

// The operator's per-file cap is enforced, reported in the message, and
// can only lower the module's own ceiling — never raise it.
func TestUploadAttachmentPerFileLimit(t *testing.T) {
	f := setup(t)
	ch := f.spaces.channelID
	f.svc.UsePolicy(fakePolicy{maxUpload: 4 << 20})

	status, body := f.upload(t, "member", ch, "big.bin", make([]byte, (4<<20)+1))
	if status != http.StatusRequestEntityTooLarge {
		t.Errorf("over the limit: status %d, want %d (%v)", status, http.StatusRequestEntityTooLarge, body)
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "4 MB") {
		t.Errorf("error names the wrong limit: %q", msg)
	}
	if status, body := f.upload(t, "member", ch, "ok.bin", make([]byte, 1<<20)); status != http.StatusCreated {
		t.Errorf("under the limit: status %d (%v)", status, body)
	}

	// A setting past the ceiling doesn't raise it.
	f.svc.UsePolicy(fakePolicy{maxUpload: files.MaxAttachmentBytes * 2})
	status, body = f.upload(t, "member", ch, "huge.bin", make([]byte, files.MaxAttachmentBytes+1))
	if status != http.StatusRequestEntityTooLarge {
		t.Errorf("past the ceiling: status %d, want %d (%v)", status, http.StatusRequestEntityTooLarge, body)
	}
}
