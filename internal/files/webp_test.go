package files_test

import (
	"bytes"
	"image"
	"strings"
	"testing"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
)

// riffChunk frames one WebP chunk: id, little-endian size, payload,
// padded to an even length.
func riffChunk(id string, payload []byte) []byte {
	out := []byte(id)
	size := len(payload)
	out = append(out, byte(size), byte(size>>8), byte(size>>16), byte(size>>24))
	out = append(out, payload...)
	if size%2 == 1 {
		out = append(out, 0)
	}
	return out
}

// animatedWebP is a complete two-frame animated WebP, one black pixel a
// frame: the extended header with the animation flag, the ANIM chunk,
// and two ANMF frames each wrapping a lossless VP8L bitstream that the
// decoder reads on its own. Decoding the whole file fails the way the
// upload used to, with "webp: invalid format".
func animatedWebP(t *testing.T) []byte {
	t.Helper()
	vp8l := []byte{0x2f, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08}
	if _, _, err := image.Decode(bytes.NewReader(riffFile(riffChunk("VP8L", vp8l)))); err != nil {
		t.Fatalf("the frame on its own must decode: %v", err)
	}
	// Frame header: x, y, width-1, height-1 (three bytes each), duration
	// (three bytes), flags; then the frame's bitstream.
	frame := append(make([]byte, 16), riffChunk("VP8L", vp8l)...)
	const animationFlag = 0x02
	file := riffFile(
		riffChunk("VP8X", []byte{animationFlag, 0, 0, 0, 0, 0, 0, 0, 0, 0}),
		riffChunk("ANIM", []byte{0, 0, 0, 0, 0, 0}),
		riffChunk("ANMF", frame),
		riffChunk("ANMF", frame),
	)
	if _, _, err := image.Decode(bytes.NewReader(file)); err == nil {
		t.Fatal("the decoder reads animated WebP now; this refusal can go")
	}
	return file
}

func riffFile(chunks ...[]byte) []byte {
	body := []byte("WEBP")
	for _, chunk := range chunks {
		body = append(body, chunk...)
	}
	out := []byte("RIFF")
	size := len(body)
	out = append(out, byte(size), byte(size>>8), byte(size>>16), byte(size>>24))
	return append(out, body...)
}

func TestAnimatedWebPUploadIsRefusedInTheRequest(t *testing.T) {
	f := setup(t)
	file := animatedWebP(t)

	_, err := f.svc.UploadAvatar(as(f.member), connect.NewRequest(&filesv1.UploadAvatarRequest{Data: file}))
	apierrtest.RequireCode(t, err, connect.CodeInvalidArgument, "avatar")
	if !strings.Contains(err.Error(), "animated WebP is not supported") {
		t.Fatalf("avatar: err = %v, want it to name animated WebP", err)
	}
	_, err = f.svc.UploadSpaceIcon(as(f.owner), connect.NewRequest(&filesv1.UploadSpaceIconRequest{SpaceId: f.space, Data: file}))
	apierrtest.RequireCode(t, err, connect.CodeInvalidArgument, "icon")
	if !strings.Contains(err.Error(), "animated WebP is not supported") {
		t.Fatalf("icon: err = %v, want it to name animated WebP", err)
	}
	if len(f.queue.jobs) != 0 {
		t.Errorf("queued %d jobs, want none", len(f.queue.jobs))
	}
	var pending int
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM files WHERE pending`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Errorf("%d pending files stored, want none", pending)
	}
}
