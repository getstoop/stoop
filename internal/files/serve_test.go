package files_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// getRange is get with extra request headers and a choice of method.
func (f *fixture) getRange(t *testing.T, method, id, user string, headers map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, "/files/"+id, nil)
	req.Header.Set("X-Test-User", user)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	mux.Handle("GET /files/{id}", f.svc.Handler())
	mux.Handle("HEAD /files/{id}", f.svc.Handler())
	mux.ServeHTTP(rec, req)
	return rec.Result()
}

// A minimal MP4 header (ftyp box, brand mp42) followed by filler: enough
// for the sniffer, which is all the server looks at.
func fakeMP4(size int) []byte {
	b := []byte("\x00\x00\x00\x14ftypmp42\x00\x00\x00\x00mp42")
	for len(b) < size {
		b = append(b, byte(len(b)))
	}
	return b[:size]
}

func TestVideoAttachmentIsServedInlineWithRanges(t *testing.T) {
	f := setup(t)
	video := fakeMP4(1000)
	status, body := f.upload(t, "member", f.spaces.channelID, "clip.mp4", video)
	if status != http.StatusCreated {
		t.Fatalf("upload: %d %v", status, body)
	}
	if body["contentType"] != "video/mp4" {
		t.Fatalf("contentType = %v", body["contentType"])
	}
	id := body["id"].(string)

	// Plain GET: whole file, inline, advertises ranges.
	res := f.getRange(t, http.MethodGet, id, "member", nil)
	got, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || len(got) != len(video) {
		t.Fatalf("GET: %d, %d bytes", res.StatusCode, len(got))
	}
	if cd := res.Header.Get("Content-Disposition"); cd != "inline" {
		t.Errorf("Content-Disposition = %q, want inline", cd)
	}
	if ar := res.Header.Get("Accept-Ranges"); ar != "bytes" {
		t.Errorf("Accept-Ranges = %q", ar)
	}

	// A window, as a media element seeking would ask.
	res = f.getRange(t, http.MethodGet, id, "member", map[string]string{"Range": "bytes=100-199"})
	got, _ = io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent {
		t.Fatalf("ranged GET: %d", res.StatusCode)
	}
	if string(got) != string(video[100:200]) {
		t.Errorf("ranged body: %d bytes, wrong slice", len(got))
	}
	if cr := res.Header.Get("Content-Range"); cr != "bytes 100-199/1000" {
		t.Errorf("Content-Range = %q", cr)
	}
	if cl := res.Header.Get("Content-Length"); cl != "100" {
		t.Errorf("Content-Length = %q", cl)
	}

	// The iOS probe, then a suffix.
	res = f.getRange(t, http.MethodGet, id, "member", map[string]string{"Range": "bytes=0-1"})
	got, _ = io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || string(got) != string(video[:2]) {
		t.Errorf("probe: %d, %q", res.StatusCode, got)
	}
	res = f.getRange(t, http.MethodGet, id, "member", map[string]string{"Range": "bytes=-10"})
	got, _ = io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || string(got) != string(video[990:]) {
		t.Errorf("suffix: %d, %d bytes", res.StatusCode, len(got))
	}

	// Past the end.
	res = f.getRange(t, http.MethodGet, id, "member", map[string]string{"Range": "bytes=1000-"})
	if res.StatusCode != http.StatusRequestedRangeNotSatisfiable || res.Header.Get("Content-Range") != "bytes */1000" {
		t.Errorf("unsatisfiable: %d, Content-Range %q", res.StatusCode, res.Header.Get("Content-Range"))
	}

	// If-Range with a stale validator serves the whole file.
	res = f.getRange(t, http.MethodGet, id, "member", map[string]string{"Range": "bytes=0-1", "If-Range": `"stale"`})
	got, _ = io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || len(got) != len(video) {
		t.Errorf("stale If-Range: %d, %d bytes", res.StatusCode, len(got))
	}

	// HEAD with a range reports the window and sends no body.
	res = f.getRange(t, http.MethodHead, id, "member", map[string]string{"Range": "bytes=0-9"})
	got, _ = io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || len(got) != 0 || res.Header.Get("Content-Range") != "bytes 0-9/1000" {
		t.Errorf("HEAD: %d, %d bytes, Content-Range %q", res.StatusCode, len(got), res.Header.Get("Content-Range"))
	}

	// Authorisation is unchanged by the Range header.
	if res := f.getRange(t, http.MethodGet, id, "other", map[string]string{"Range": "bytes=0-1"}); res.StatusCode != http.StatusForbidden {
		t.Errorf("non-member ranged GET: %d", res.StatusCode)
	}
}

func TestQuickTimeAttachmentIsPlayable(t *testing.T) {
	f := setup(t)
	mov := append([]byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  "), strings.Repeat("x", 100)...)
	_, body := f.upload(t, "member", f.spaces.channelID, "IMG_0001.MOV", mov)
	if body["contentType"] != "video/quicktime" {
		t.Fatalf("contentType = %v", body["contentType"])
	}
	res := f.get(t, body["id"].(string), "member")
	if cd := res.Header.Get("Content-Disposition"); cd != "inline" {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if ct := res.Header.Get("Content-Type"); ct != "video/quicktime" {
		t.Errorf("Content-Type = %q", ct)
	}
}

// Ranges also work on a non-media download; a range on a non-playable
// type still downloads.
func TestRangeOnDownload(t *testing.T) {
	f := setup(t)
	text := []byte(strings.Repeat("abcdefghij", 10))
	_, body := f.upload(t, "member", f.spaces.channelID, "notes.txt", text)
	res := f.getRange(t, http.MethodGet, body["id"].(string), "member", map[string]string{"Range": "bytes=10-19"})
	got, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || string(got) != "abcdefghij" {
		t.Errorf("ranged text: %d %q", res.StatusCode, got)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("Content-Disposition = %q", cd)
	}
}
