package files

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	"testing"
)

// byteOrder is what a TIFF block is written in.
type byteOrder interface {
	binary.ByteOrder
	binary.AppendByteOrder
}

// exifTIFF is a TIFF block whose first IFD holds an Orientation tag, as
// a camera writes it: a filler tag before it, so the walk has to step.
func exifTIFF(order byteOrder, orientation uint16) []byte {
	out := make([]byte, 0, 64)
	if order == binary.LittleEndian {
		out = append(out, "II*\x00"...)
	} else {
		out = append(out, "MM\x00*"...)
	}
	out = order.AppendUint32(out, 8) // IFD0 follows the header
	out = order.AppendUint16(out, 2) // two entries
	// ImageWidth, a LONG: not the tag we want.
	out = order.AppendUint16(out, 0x0100)
	out = order.AppendUint16(out, 4)
	out = order.AppendUint32(out, 1)
	out = order.AppendUint32(out, 4032)
	// Orientation, one SHORT, left-justified in the value field.
	out = order.AppendUint16(out, 0x0112)
	out = order.AppendUint16(out, 3)
	out = order.AppendUint32(out, 1)
	out = order.AppendUint16(out, orientation)
	out = order.AppendUint16(out, 0)
	return order.AppendUint32(out, 0) // no next IFD
}

// jpegWithSegment puts an APPn segment straight after a JPEG's SOI.
func jpegWithSegment(plain []byte, marker byte, payload []byte) []byte {
	out := append([]byte{}, plain[:2]...)
	out = append(out, 0xFF, marker)
	out = binary.BigEndian.AppendUint16(out, uint16(len(payload)+2))
	out = append(out, payload...)
	return append(out, plain[2:]...)
}

// jpegWithOrientation is a width×height JPEG (as stored) carrying an
// EXIF Orientation tag.
func jpegWithOrientation(tb testing.TB, width, height int, orientation uint16) []byte {
	tb.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, width, height)), nil); err != nil {
		tb.Fatal(err)
	}
	payload := append([]byte("Exif\x00\x00"), exifTIFF(binary.BigEndian, orientation)...)
	return jpegWithSegment(buf.Bytes(), 0xE1, payload)
}

// webpWithExif is an extended WebP header for a width×height canvas
// with the EXIF flag set, an image chunk the walk must step over (odd
// length, so padded) and then the EXIF chunk, where the format puts it.
func webpWithExif(width, height int, exif []byte) []byte {
	const exifFlag = 0x08
	vp8x := []byte{exifFlag, 0, 0, 0}
	vp8x = append(vp8x, byte(width-1), byte((width-1)>>8), byte((width-1)>>16))
	vp8x = append(vp8x, byte(height-1), byte((height-1)>>8), byte((height-1)>>16))
	chunk := func(id string, payload []byte) []byte {
		out := binary.LittleEndian.AppendUint32([]byte(id), uint32(len(payload)))
		out = append(out, payload...)
		if len(payload)%2 == 1 {
			out = append(out, 0)
		}
		return out
	}
	body := []byte("WEBP")
	body = append(body, chunk("VP8X", vp8x)...)
	body = append(body, chunk("VP8L", make([]byte, 7))...)
	body = append(body, chunk("EXIF", exif)...)
	out := binary.LittleEndian.AppendUint32([]byte("RIFF"), uint32(len(body)))
	return append(out, body...)
}

func TestExifOrientationEveryValue(t *testing.T) {
	for orientation := uint16(1); orientation <= 8; orientation++ {
		for _, order := range []byteOrder{binary.LittleEndian, binary.BigEndian} {
			tiff := exifTIFF(order, orientation)
			if got := tiffOrientation(tiff); got != int(orientation) {
				t.Errorf("%v TIFF, orientation %d: got %d", order, orientation, got)
			}
		}
		file := jpegWithOrientation(t, 40, 30, orientation)
		if got := exifOrientation(bytes.NewReader(file), "image/jpeg"); got != int(orientation) {
			t.Errorf("JPEG, orientation %d: got %d", orientation, got)
		}
		width, height, ok := measureImage(bytes.NewReader(file), "image/jpeg")
		wantWidth, wantHeight := int32(40), int32(30)
		if orientation >= 5 {
			wantWidth, wantHeight = 30, 40
		}
		if !ok || width != wantWidth || height != wantHeight {
			t.Errorf("JPEG, orientation %d: measured %d×%d (%v), want %d×%d", orientation, width, height, ok, wantWidth, wantHeight)
		}
	}
}

func TestExifOrientationWebP(t *testing.T) {
	file := webpWithExif(40, 30, exifTIFF(binary.LittleEndian, 6))
	if got := exifOrientation(bytes.NewReader(file), "image/webp"); got != 6 {
		t.Errorf("WebP EXIF chunk: got %d, want 6", got)
	}
	prefixed := webpWithExif(40, 30, append([]byte("Exif\x00\x00"), exifTIFF(binary.LittleEndian, 8)...))
	if got := exifOrientation(bytes.NewReader(prefixed), "image/webp"); got != 8 {
		t.Errorf("WebP EXIF chunk with JPEG's prefix: got %d, want 8", got)
	}
	width, height, ok := measureImage(bytes.NewReader(file), "image/webp")
	if !ok || width != 30 || height != 40 {
		t.Errorf("WebP measured %d×%d (%v), want 30×40", width, height, ok)
	}
}

func TestExifOrientationNone(t *testing.T) {
	var plain bytes.Buffer
	if err := jpeg.Encode(&plain, image.NewGray(image.Rect(0, 0, 40, 30)), nil); err != nil {
		t.Fatal(err)
	}
	xmpPayload := []byte("http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>")
	xmp := jpegWithSegment(plain.Bytes(), 0xE1, xmpPayload)
	// An XMP APP1 first, then the EXIF one: the walk passes the first.
	exif := jpegWithSegment(plain.Bytes(), 0xE1, append([]byte("Exif\x00\x00"), exifTIFF(binary.LittleEndian, 6)...))
	both := jpegWithSegment(exif, 0xE1, xmpPayload)
	cases := []struct {
		name        string
		file        []byte
		contentType string
		want        int
	}{
		{"JPEG without APP1", plain.Bytes(), "image/jpeg", 0},
		{"JPEG with only XMP", xmp, "image/jpeg", 0},
		{"JPEG with XMP and EXIF", both, "image/jpeg", 6},
		{"PNG", []byte("\x89PNG\r\n\x1a\n"), "image/png", 0},
		{"WebP without the EXIF flag", webpWithExif(4, 4, nil)[:20], "image/webp", 0},
	}
	for _, tc := range cases {
		if got := exifOrientation(bytes.NewReader(tc.file), tc.contentType); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestExifOrientationMalformed(t *testing.T) {
	good := exifTIFF(binary.LittleEndian, 6)
	edit := func(change func(tiff []byte)) []byte {
		out := append([]byte{}, good...)
		change(out)
		return out
	}
	tiffs := map[string][]byte{
		"empty":                nil,
		"header only":          good[:8],
		"bad byte order":       edit(func(tiff []byte) { copy(tiff, "XX*\x00") }),
		"IFD past the end":     edit(func(tiff []byte) { binary.LittleEndian.PutUint32(tiff[4:], 0xFFFFFFF0) }),
		"IFD at the last byte": edit(func(tiff []byte) { binary.LittleEndian.PutUint32(tiff[4:], uint32(len(good)-1)) }),
		"count past the end": edit(func(tiff []byte) {
			binary.LittleEndian.PutUint16(tiff[8:], 0xFFFF)
			binary.LittleEndian.PutUint16(tiff[22:], 0x0113) // and no Orientation among the real entries
		}),
		"wrong type":           edit(func(tiff []byte) { binary.LittleEndian.PutUint16(tiff[24:], 4) }),
		"two values":           edit(func(tiff []byte) { binary.LittleEndian.PutUint32(tiff[26:], 2) }),
		"value 0":              edit(func(tiff []byte) { binary.LittleEndian.PutUint16(tiff[30:], 0) }),
		"value 9":              edit(func(tiff []byte) { binary.LittleEndian.PutUint16(tiff[30:], 9) }),
		"cut inside the entry": good[:28],
	}
	for name, tiff := range tiffs {
		if got := tiffOrientation(tiff); got != 0 {
			t.Errorf("%s: got %d, want 0", name, got)
		}
	}

	// Every prefix of a good file, and every byte of it flipped, reads
	// without a panic; most give 0, and measuring never fails loudly.
	files := map[string][]byte{
		"image/jpeg": jpegWithOrientation(t, 4, 3, 6),
		"image/webp": webpWithExif(4, 3, good),
	}
	for contentType, file := range files {
		for cut := range len(file) {
			exifOrientation(bytes.NewReader(file[:cut]), contentType)
			measureImage(bytes.NewReader(file[:cut]), contentType)
		}
		for i := range file {
			flipped := append([]byte{}, file...)
			flipped[i] ^= 0xFF
			exifOrientation(bytes.NewReader(flipped), contentType)
		}
	}

	// A JPEG segment length under its own two bytes, and a WebP EXIF
	// chunk claiming more than the bound, stop the walk.
	short := []byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x01}
	if got := exifOrientation(bytes.NewReader(short), "image/jpeg"); got != 0 {
		t.Errorf("short JPEG segment: got %d", got)
	}
	huge := webpWithExif(4, 3, good)
	binary.LittleEndian.PutUint32(huge[len(huge)-len(good)-4:], 1<<31)
	if got := exifOrientation(bytes.NewReader(huge), "image/webp"); got != 0 {
		t.Errorf("huge WebP EXIF chunk: got %d", got)
	}
}

func FuzzExifOrientation(f *testing.F) {
	f.Add(jpegWithOrientation(f, 4, 3, 6), true)
	f.Add(webpWithExif(4, 3, exifTIFF(binary.BigEndian, 8)), false)
	f.Fuzz(func(t *testing.T, file []byte, isJPEG bool) {
		contentType := "image/webp"
		if isJPEG {
			contentType = "image/jpeg"
		}
		if got := exifOrientation(bytes.NewReader(file), contentType); got < 0 || got > 8 {
			t.Fatalf("orientation %d", got)
		}
		measureImage(bytes.NewReader(file), contentType)
	})
}
