package app_test

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"testing"
	"time"
)

// An avatar is normalised by the normalise_image job, not in the request:
// the upload returns the file's id at once, the file is served once the
// job has re-encoded it, and the account carries it from then on.
func TestE2EAvatarUploadIsNormalisedByJob(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	caseyID := h.userID(casey)
	stoop, _ := h.space(casey, "The Stoop")

	upload := h.rpc(casey, "stoop.files.v1.FileService/UploadAvatar", map[string]any{
		"data": base64.StdEncoding.EncodeToString(encodedPNG(t, 300, 200)),
	}).expect(t, "ok")
	fileID := upload.str("fileId")
	if fileID == "" {
		t.Fatalf("no fileId: %s", upload.raw)
	}

	served := h.awaitFile(casey, "/files/"+fileID, 10*time.Second)
	if got := served.header.Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q", got)
	}
	cfg, err := png.DecodeConfig(strings.NewReader(served.raw))
	if err != nil || cfg.Width != 256 || cfg.Height != 256 {
		t.Errorf("served avatar: %v %dx%d, want 256x256", err, cfg.Width, cfg.Height)
	}

	// The pointer moved with the file: the account and its membership show it.
	deadline := time.Now().Add(10 * time.Second)
	for h.rpc(casey, "stoop.auth.v1.AuthService/GetMe", map[string]any{}).expect(t, "ok").str("user.avatarFileId") != fileID {
		if time.Now().After(deadline) {
			t.Fatal("GetMe never carried the new avatar")
		}
		time.Sleep(100 * time.Millisecond)
	}
	for _, entry := range h.rpc(casey, "stoop.chat.v1.ChatService/ListMembers", map[string]any{"spaceId": stoop}).expect(t, "ok").list("members") {
		member, _ := entry.(map[string]any)
		if member["userId"] == caseyID && member["avatarFileId"] != fileID {
			t.Errorf("member avatarFileId = %v, want %s", member["avatarFileId"], fileID)
		}
	}
}

// awaitFile polls a download until it is 200, or fails after the deadline
// with the last status seen.
func (h *harness) awaitFile(token, path string, deadline time.Duration) reply {
	h.t.Helper()
	var last reply
	until := time.Now().Add(deadline)
	for time.Now().Before(until) {
		last = h.get(token, path)
		if last.status == http.StatusOK {
			return last
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.t.Fatalf("%s did not become 200 in %s; last %d", path, deadline, last.status)
	return last
}

func encodedPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
