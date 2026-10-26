package files

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"runtime"
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

func encodeGIFFrames(t *testing.T, w, h, frames int) []byte {
	t.Helper()
	pal := color.Palette{color.Black, color.White}
	g := &gif.GIF{LoopCount: 0}
	for i := 0; i < frames; i++ {
		f := image.NewPaletted(image.Rect(0, 0, w, h), pal)
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				f.SetColorIndex(x, y, uint8((x+i)%2))
			}
		}
		g.Image = append(g.Image, f)
		g.Delay = append(g.Delay, 10)
	}
	var b bytes.Buffer
	if err := gif.EncodeAll(&b, g); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestProcessImageFitKeepsAnimation(t *testing.T) {
	out, ctype, w, h, err := processImageFit(encodeGIFFrames(t, 10, 8, 3), 480)
	if err != nil {
		t.Fatal(err)
	}
	if ctype != "image/gif" || w != 10 || h != 8 {
		t.Fatalf("got %s %dx%d", ctype, w, h)
	}
	g, err := gif.DecodeAll(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Image) != 3 || g.LoopCount != 0 {
		t.Errorf("frames %d loop %d", len(g.Image), g.LoopCount)
	}
}

func TestProcessImageFitStillGIFIsPNG(t *testing.T) {
	_, ctype, _, _, err := processImageFit(encodeGIFFrames(t, 10, 8, 1), 480)
	if err != nil {
		t.Fatal(err)
	}
	if ctype != "image/png" {
		t.Errorf("a single frame should be re-encoded as PNG, got %s", ctype)
	}
}

// A still GIF's frame may be smaller than its screen; the result keeps
// the frame's own shape.
func TestProcessImageFitSizesFromTheFrame(t *testing.T) {
	frame := image.NewPaletted(image.Rect(0, 0, 100, 100), color.Palette{color.Black, color.White})
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{
		Image: []*image.Paletted{frame}, Delay: []int{0},
		Config: image.Config{ColorModel: frame.Palette, Width: 1000, Height: 100},
	}); err != nil {
		t.Fatal(err)
	}
	out, _, width, height, err := processImageFit(buf.Bytes(), LinkPreviewMaxDim)
	if err != nil {
		t.Fatal(err)
	}
	if _, gotWidth, gotHeight := decodeSize(t, out); width != 100 || height != 100 || gotWidth != 100 || gotHeight != 100 {
		t.Errorf("said %d×%d, wrote %d×%d, want 100×100", width, height, gotWidth, gotHeight)
	}
}

func TestProcessImageFitCapsAnimation(t *testing.T) {
	if _, _, _, _, err := processImageFit(encodeGIFFrames(t, 1, 1, maxGIFFrames+1), 480); !errors.Is(err, errHugeImage) {
		t.Errorf("too many frames should be refused, got %v", err)
	}
}

func TestGIFFrames(t *testing.T) {
	data := encodeGIFFrames(t, 4, 4, 7)
	if n, err := gifFrames(data); err != nil || n != 7 {
		t.Errorf("frames = %d, %v", n, err)
	}
	if _, err := gifFrames(data[:len(data)/2]); err == nil {
		t.Error("a truncated gif should be an error")
	}
	if _, err := gifFrames([]byte("GIF89a")); err == nil {
		t.Error("a header alone should be an error")
	}
}

// vp8xHeader is the start of an extended-format WebP: a VP8X chunk with
// the given flags and a canvas size, which is all DecodeConfig reads.
func vp8xHeader(flags byte, width, height int) []byte {
	chunk := make([]byte, 18)
	copy(chunk, "VP8X")
	chunk[4] = 10 // chunk size, little-endian
	chunk[8] = flags
	w, h := width-1, height-1
	chunk[12], chunk[13], chunk[14] = byte(w), byte(w>>8), byte(w>>16)
	chunk[15], chunk[16], chunk[17] = byte(h), byte(h>>8), byte(h>>16)
	header := make([]byte, 12)
	copy(header, "RIFF")
	header[4] = byte(4 + len(chunk))
	copy(header[8:], "WEBP")
	return append(header, chunk...)
}

func TestValidateImageRefusesAnimatedWebP(t *testing.T) {
	const animation = 0x02
	_, err := validateImage(vp8xHeader(animation, 267, 199), AvatarSize)
	if !errors.Is(err, errAnimatedWebP) {
		t.Fatalf("animated webp: err = %v, want %v", err, errAnimatedWebP)
	}
	contentType, err := validateImage(vp8xHeader(0, 267, 199), AvatarSize)
	if err != nil || contentType != "image/webp" {
		t.Fatalf("still vp8x webp: %q, %v; want image/webp, nil", contentType, err)
	}
}

// An avatar, icon or link preview image is refused, before anything is
// decoded, when decoding it and scaling it would hold more than
// maxDecodeMemory: a 4096² 16-bit PNG fits, a progressive JPEG that size
// does not.
func TestImageDecodeBound(t *testing.T) {
	progressive := jpegHeader(0xC2, 4096, 4096)
	if _, err := validateImage(progressive, SpaceIconSize); !errors.Is(err, errHugeImage) {
		t.Errorf("4096² progressive icon: %v, want errHugeImage", err)
	}
	if _, _, _, _, err := processImageFit(progressive, LinkPreviewMaxDim); !errors.Is(err, errHugeImage) {
		t.Errorf("4096² progressive preview: %v, want errHugeImage", err)
	}
	baseline := jpegHeader(0xC0, 4096, 4096)
	if _, err := validateImage(baseline, SpaceIconSize); err != nil {
		t.Errorf("4096² baseline icon: %v, want it accepted", err)
	}
	if _, _, _, _, err := processImageFit(baseline, LinkPreviewMaxDim); !errors.Is(err, errNotAnImage) {
		t.Errorf("4096² baseline preview: %v, want it decoded (and fail)", err)
	}

	// A long screenshot is cropped to its width before scaling, so the
	// scaler reads 1080 rows, not 15,000.
	tall := rawPNG(t, pngSpec{width: 1080, height: 15000, depth: 8, colorType: 6})
	if _, err := validateImage(tall, SpaceIconSize); err != nil {
		t.Errorf("1080×15000 icon: %v, want it accepted", err)
	}

	sized := func(model color.Model, width, height int, contentType string) imageHeader {
		return imageHeader{Config: image.Config{ColorModel: model, Width: width, Height: height}, contentType: contentType}
	}
	progressiveJPEG := func(model color.Model, side int) imageHeader {
		header := sized(model, side, side, "image/jpeg")
		header.progressive = true
		return header
	}
	interlacedPNG := func(model color.Model, side int) imageHeader {
		header := sized(model, side, side, "image/png")
		header.interlaced = true
		return header
	}
	for name, tc := range map[string]struct {
		header imageHeader
		fits   bool
	}{
		"4096² 16-bit PNG":            {sized(color.RGBA64Model, 4096, 4096, "image/png"), true},
		"4096² baseline JPEG":         {sized(color.YCbCrModel, 4096, 4096, "image/jpeg"), true},
		"4096² CMYK JPEG":             {sized(color.CMYKModel, 4096, 4096, "image/jpeg"), true},
		"4096² WebP":                  {sized(color.YCbCrModel, 4096, 4096, "image/webp"), true},
		"3000² progressive JPEG":      {progressiveJPEG(color.YCbCrModel, 3000), true},
		"4096² progressive JPEG":      {progressiveJPEG(color.YCbCrModel, 4096), false},
		"3000² progressive CMYK JPEG": {progressiveJPEG(color.CMYKModel, 3000), true},
		"4096² progressive CMYK JPEG": {progressiveJPEG(color.CMYKModel, 4096), false},
		"4096² interlaced 16-bit PNG": {interlacedPNG(color.RGBA64Model, 4096), false},
	} {
		if fits := fitCost(tc.header, tc.header.Height, SpaceIconSize, SpaceIconSize) <= maxDecodeMemory; fits != tc.fits {
			t.Errorf("%s: fits %v, want %v", name, fits, tc.fits)
		}
	}
}

// fitCost is an upper bound on what normaliseImage and processImageFit
// allocate: the decode, the scaler's buffer and the result, with the PNG
// encoder's own state within the slack.
func TestFitCostCoversTheScaling(t *testing.T) {
	cases := map[string][]byte{
		"PNG":              encodePNG(t, solid(1000, 800, color.NRGBA{R: 200, A: 255})),
		"baseline JPEG":    encodeJPEG(t, quadrants(1000, 800), 0),
		"progressive JPEG": readTestdata(t, "smooth-444.progressive.jpeg"),
		"lossless WebP":    readTestdata(t, "blue-purple-pink.lossless.webp"),
	}
	for name, data := range cases {
		contentType, cfg, err := sniffImage(data)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		header, err := readImageHeader(bytes.NewReader(data), contentType, cfg)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		fitWidth, fitHeight := fitWithin(cfg.Width, cfg.Height, LinkPreviewMaxDim)
		for _, run := range []struct {
			what                      string
			sourceRows, width, height int
			process                   func() error
		}{
			{"normalise", min(cfg.Width, cfg.Height), SpaceIconSize, SpaceIconSize, func() error { _, err := normaliseImage(data, contentType, SpaceIconSize); return err }},
			{"fit", cfg.Height, fitWidth, fitHeight, func() error {
				_, _, _, _, err := processImageFit(data, LinkPreviewMaxDim)
				return err
			}},
		} {
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			if err := run.process(); err != nil {
				t.Fatalf("%s %s: %v", name, run.what, err)
			}
			runtime.ReadMemStats(&after)
			allocated := int64(after.TotalAlloc - before.TotalAlloc)
			if cost := fitCost(header, run.sourceRows, run.width, run.height); allocated > cost+fitSlack {
				t.Errorf("%s %s (%d×%d): allocated %d bytes, fitCost %d", name, run.what, cfg.Width, cfg.Height, allocated, cost)
			}
		}
	}
}

// fitSlack covers what a re-encode allocates beyond the pixels: the
// header walks, and the PNG encoder's compressor and output.
const fitSlack = 2 << 20

// A link preview waits for the decode slot like a job does, and gives up
// when its context ends.
func TestLinkPreviewWaitsForTheDecodeSlot(t *testing.T) {
	svc := &Service{decodeSlot: make(chan struct{}, 1)}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	err := svc.decodeOne(context.Background(), func() {
		data := encodePNG(t, solid(10, 10, color.Black))
		if _, _, _, err := svc.StoreLinkPreviewImage(cancelled, "owner", data); !errors.Is(err, context.Canceled) {
			t.Errorf("with the slot held: %v, want context.Canceled", err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
}

// An avatar and a link preview image come out the right way up for
// every EXIF orientation, as a thumbnail does: the avatar's centre
// square holds all four quadrants, and the preview's size is the turned
// one.
func TestImageOrientation(t *testing.T) {
	stored := quadrants(1200, 600)
	for orientation, want := range displayedCorners {
		data := encodeJPEG(t, stored, orientation)
		avatar, err := processImage(data, AvatarSize)
		if err != nil {
			t.Fatalf("avatar, orientation %d: %v", orientation, err)
		}
		img, err := png.Decode(bytes.NewReader(avatar))
		if err != nil {
			t.Fatal(err)
		}
		if got := corners(img); got != want {
			t.Errorf("avatar, orientation %d: corners %v, want %v", orientation, got, want)
		}

		preview, _, width, height, err := processImageFit(data, LinkPreviewMaxDim)
		if err != nil {
			t.Fatalf("preview, orientation %d: %v", orientation, err)
		}
		wantWidth, wantHeight := LinkPreviewMaxDim, LinkPreviewMaxDim/2
		if swapsAxes(int(orientation)) {
			wantWidth, wantHeight = wantHeight, wantWidth
		}
		if _, gotWidth, gotHeight := decodeSize(t, preview); width != wantWidth || height != wantHeight || gotWidth != wantWidth || gotHeight != wantHeight {
			t.Errorf("preview, orientation %d: said %d×%d, wrote %d×%d, want %d×%d", orientation, width, height, gotWidth, gotHeight, wantWidth, wantHeight)
		}
		img, err = png.Decode(bytes.NewReader(preview))
		if err != nil {
			t.Fatal(err)
		}
		if got := corners(img); got != want {
			t.Errorf("preview, orientation %d: corners %v, want %v", orientation, got, want)
		}
	}
}
