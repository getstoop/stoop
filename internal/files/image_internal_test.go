package files

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

func solid(w, h int, c color.Color) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func decodeSize(t *testing.T, data []byte) (string, int, int) {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	return format, cfg.Width, cfg.Height
}

func TestProcessImageResizesToSquarePNG(t *testing.T) {
	out, err := processImage(encodePNG(t, solid(300, 200, color.NRGBA{R: 255, A: 255})), AvatarSize)
	if err != nil {
		t.Fatal(err)
	}
	if format, w, h := decodeSize(t, out); format != "png" || w != AvatarSize || h != AvatarSize {
		t.Fatalf("got %s %dx%d, want png %dx%d", format, w, h, AvatarSize, AvatarSize)
	}
	// Tiny inputs are scaled up to the fixed size too.
	out, err = processImage(encodePNG(t, solid(10, 40, color.Black)), SpaceIconSize)
	if err != nil {
		t.Fatal(err)
	}
	if _, w, h := decodeSize(t, out); w != SpaceIconSize || h != SpaceIconSize {
		t.Fatalf("got %dx%d", w, h)
	}
}

func TestProcessImageAcceptsJPEGAndGIF(t *testing.T) {
	var j bytes.Buffer
	if err := jpeg.Encode(&j, solid(64, 64, color.NRGBA{G: 200, A: 255}), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := processImage(j.Bytes(), AvatarSize); err != nil {
		t.Fatalf("jpeg: %v", err)
	}
	var g bytes.Buffer
	pal := image.NewPaletted(image.Rect(0, 0, 8, 8), color.Palette{color.Black, color.White})
	if err := gif.Encode(&g, pal, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := processImage(g.Bytes(), AvatarSize); err != nil {
		t.Fatalf("gif: %v", err)
	}
}

func TestProcessImageRejectsNonImagesBySniffing(t *testing.T) {
	// A text file renamed .png: the name is never seen, the bytes are.
	if _, err := processImage([]byte("hello, this is not a picture\n"), AvatarSize); !errors.Is(err, errNotAnImage) {
		t.Fatalf("text: want errNotAnImage, got %v", err)
	}
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if _, err := processImage(svg, AvatarSize); !errors.Is(err, errNotAnImage) {
		t.Fatalf("svg: want errNotAnImage, got %v", err)
	}
	// A PNG signature followed by junk sniffs as PNG but doesn't decode.
	junk := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	if _, err := processImage(junk, AvatarSize); !errors.Is(err, errNotAnImage) {
		t.Fatalf("truncated png: want errNotAnImage, got %v", err)
	}
	if _, err := processImage(nil, AvatarSize); !errors.Is(err, errEmptyUpload) {
		t.Fatalf("empty: want errEmptyUpload, got %v", err)
	}
}

func TestProcessImageCaps(t *testing.T) {
	big := make([]byte, MaxImageBytes+1)
	copy(big, "\x89PNG\r\n\x1a\n")
	if _, err := processImage(big, AvatarSize); !errors.Is(err, errTooLarge) {
		t.Fatalf("oversize: want errTooLarge, got %v", err)
	}
	// Small on disk, enormous when decoded.
	bomb := encodePNG(t, image.NewGray(image.Rect(0, 0, 4200, 4200)))
	if len(bomb) > MaxImageBytes {
		t.Fatalf("test image unexpectedly large: %d bytes", len(bomb))
	}
	if _, err := processImage(bomb, AvatarSize); !errors.Is(err, errHugeImage) {
		t.Fatalf("pixel bomb: want errHugeImage, got %v", err)
	}
}

func TestIsRaster(t *testing.T) {
	for ct, want := range map[string]bool{
		"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
		"image/svg+xml": false, "text/html": false, "application/pdf": false, "": false,
	} {
		if got := isRaster(ct); got != want {
			t.Errorf("isRaster(%q) = %v", ct, got)
		}
	}
}
