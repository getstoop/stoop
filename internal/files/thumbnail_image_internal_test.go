package files

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// The thumbnail's pixels: orientation, transparency, the skips and the
// bound. The job around them is in thumbnail_test.go.

var (
	red   = color.RGBA{R: 255, A: 255}
	green = color.RGBA{G: 255, A: 255}
	blue  = color.RGBA{B: 255, A: 255}
	white = color.RGBA{R: 255, G: 255, B: 255, A: 255}
)

// quadrants is a width×height picture whose corners tell every turn and
// mirror apart: red top left, green top right, blue bottom left, white
// bottom right.
func quadrants(width, height int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for row := range height {
		for column := range width {
			corner := red
			switch {
			case column >= width/2 && row < height/2:
				corner = green
			case column < width/2 && row >= height/2:
				corner = blue
			case column >= width/2 && row >= height/2:
				corner = white
			}
			img.SetRGBA(column, row, corner)
		}
	}
	return img
}

// nearest names the corner colour a lossy pixel is closest to.
func nearest(pixel color.Color) string {
	gotRed, gotGreen, gotBlue, _ := pixel.RGBA()
	names := map[string]color.RGBA{"red": red, "green": green, "blue": blue, "white": white}
	best, bestDistance := "", int64(-1)
	for name, want := range names {
		wantRed, wantGreen, wantBlue, _ := want.RGBA()
		distance := sq(int64(gotRed)-int64(wantRed)) + sq(int64(gotGreen)-int64(wantGreen)) + sq(int64(gotBlue)-int64(wantBlue))
		if bestDistance < 0 || distance < bestDistance {
			best, bestDistance = name, distance
		}
	}
	return best
}

func sq(n int64) int64 { return n * n }

// corners reads the four corners of a decoded thumbnail, a little in.
func corners(img image.Image) [4]string {
	bounds := img.Bounds()
	inX, inY := bounds.Dx()/8, bounds.Dy()/8
	return [4]string{
		nearest(img.At(inX, inY)),
		nearest(img.At(bounds.Dx()-inX, inY)),
		nearest(img.At(inX, bounds.Dy()-inY)),
		nearest(img.At(bounds.Dx()-inX, bounds.Dy()-inY)),
	}
}

func encodeJPEG(t *testing.T, img image.Image, orientation uint16) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	if orientation == 0 {
		return buf.Bytes()
	}
	payload := append([]byte("Exif\x00\x00"), exifTIFF(binary.LittleEndian, orientation)...)
	return jpegWithSegment(buf.Bytes(), 0xE1, payload)
}

func decodeThumbnail(t *testing.T, thumb thumbnail) image.Image {
	t.Helper()
	img, format, err := image.Decode(bytes.NewReader(thumb.data))
	if err != nil {
		t.Fatal(err)
	}
	if "image/"+format != thumb.contentType {
		t.Errorf("encoded %s, said %s", format, thumb.contentType)
	}
	if img.Bounds().Dx() != thumb.width || img.Bounds().Dy() != thumb.height {
		t.Errorf("encoded %v, said %d×%d", img.Bounds(), thumb.width, thumb.height)
	}
	return img
}

// Every EXIF orientation comes out the right way up, the way a viewer
// shows the original, with the long side at ThumbnailSize.
func TestThumbnailOrientation(t *testing.T) {
	stored := quadrants(2400, 1200)
	// Corners as displayed: top left, top right, bottom left, bottom right.
	for orientation, want := range map[uint16][4]string{
		0: {"red", "green", "blue", "white"},
		1: {"red", "green", "blue", "white"},
		2: {"green", "red", "white", "blue"},
		3: {"white", "blue", "green", "red"},
		4: {"blue", "white", "red", "green"},
		5: {"red", "blue", "green", "white"},
		6: {"blue", "red", "white", "green"},
		7: {"white", "green", "blue", "red"},
		8: {"green", "white", "red", "blue"},
	} {
		thumb, err := makeThumbnail(bytes.NewReader(encodeJPEG(t, stored, orientation)), "image/jpeg")
		if err != nil {
			t.Fatalf("orientation %d: %v", orientation, err)
		}
		wantWidth, wantHeight := ThumbnailSize, ThumbnailSize/2
		if swapsAxes(int(orientation)) {
			wantWidth, wantHeight = wantHeight, wantWidth
		}
		if thumb.width != wantWidth || thumb.height != wantHeight || thumb.contentType != "image/jpeg" {
			t.Errorf("orientation %d: %s %d×%d, want image/jpeg %d×%d", orientation, thumb.contentType, thumb.width, thumb.height, wantWidth, wantHeight)
		}
		if got := corners(decodeThumbnail(t, thumb)); got != want {
			t.Errorf("orientation %d: corners %v, want %v", orientation, got, want)
		}
	}
}

// A picture with any transparency stays a PNG with it; an opaque PNG
// becomes a JPEG.
func TestThumbnailTransparency(t *testing.T) {
	encode := func(img image.Image) []byte {
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	clear := quadrants(2048, 1536)
	for row := range 1536 {
		for column := range 512 {
			clear.SetRGBA(column, row, color.RGBA{})
		}
	}
	thumb, err := makeThumbnail(bytes.NewReader(encode(clear)), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if thumb.contentType != "image/png" || thumb.width != 1024 || thumb.height != 768 {
		t.Fatalf("transparent: %s %d×%d, want image/png 1024×768", thumb.contentType, thumb.width, thumb.height)
	}
	img := decodeThumbnail(t, thumb)
	if _, _, _, alpha := img.At(10, 10).RGBA(); alpha != 0 {
		t.Errorf("the clear quarter has alpha %d, want 0", alpha)
	}
	if _, _, _, alpha := img.At(1000, 700).RGBA(); alpha != 0xffff {
		t.Errorf("the opaque part has alpha %d", alpha)
	}

	thumb, err = makeThumbnail(bytes.NewReader(encode(quadrants(2048, 1536))), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if thumb.contentType != "image/jpeg" {
		t.Errorf("opaque PNG: %s, want image/jpeg", thumb.contentType)
	}
}

// No thumbnail for an image already small enough, a GIF, an animated
// WebP, or a file that only claims to be an image.
func TestThumbnailSkips(t *testing.T) {
	small := encodeJPEG(t, quadrants(1024, 700), 6)
	if _, err := makeThumbnail(bytes.NewReader(small), "image/jpeg"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("1024×700: %v, want a skip", err)
	}
	if wantsThumbnail("image/jpeg", nil, 1024, 1024) || !wantsThumbnail("image/jpeg", nil, 1025, 10) {
		t.Error("the size rule is more than 1024 on either side")
	}
	if wantsThumbnail("image/gif", nil, 4000, 3000) {
		t.Error("a GIF keeps its animation")
	}
	animated := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x02")
	if wantsThumbnail("image/webp", animated, 4000, 3000) {
		t.Error("an animated WebP keeps its animation")
	}
	still := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00")
	if !wantsThumbnail("image/webp", still, 4000, 3000) {
		t.Error("a still WebP gets one")
	}
	if _, err := makeThumbnail(bytes.NewReader([]byte("not a picture at all")), "image/jpeg"); !errors.Is(err, errNotAnImage) {
		t.Errorf("garbage: %v, want errNotAnImage", err)
	}
}

// jpegHeader is a JPEG that ends at the start of its scan: enough for
// DecodeConfig and the bound, not for a decode. frame is the SOF code.
func jpegHeader(frame byte, width, height int) []byte {
	out := []byte{0xFF, 0xD8}
	// A comment segment first, so the walk has to step over one.
	out = append(out, 0xFF, 0xFE, 0x00, 0x04, 'h', 'i')
	out = append(out, 0xFF, frame, 0x00, 17, 8)
	out = binary.BigEndian.AppendUint16(out, uint16(height))
	out = binary.BigEndian.AppendUint16(out, uint16(width))
	out = append(out, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0)
	return append(out, 0xFF, 0xDA, 0x00, 0x0C, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0)
}

// The bound is reckoned from the header before anything is decoded. A
// 48 MP baseline JPEG is under it and goes on to the decode (which this
// header-only file fails); a progressive one of 16 MP, whose decoder
// keeps every coefficient, is over it and skipped without one.
func TestThumbnailBound(t *testing.T) {
	baseline := jpegHeader(0xC0, 8064, 6048)
	if _, err := makeThumbnail(bytes.NewReader(baseline), "image/jpeg"); !errors.Is(err, errNotAnImage) {
		t.Errorf("48 MP baseline: %v, want it decoded (and fail)", err)
	}
	progressive := jpegHeader(0xC2, 4608, 3456)
	if _, err := makeThumbnail(bytes.NewReader(progressive), "image/jpeg"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("16 MP progressive: %v, want a skip", err)
	}
	if !jpegProgressive(bytes.NewReader(progressive)) || jpegProgressive(bytes.NewReader(baseline)) {
		t.Error("jpegProgressive misread the frame header")
	}

	megapixels := func(n int) image.Config {
		return image.Config{Width: n * 1000, Height: 1000}
	}
	for name, tc := range map[string]struct {
		cfg         image.Config
		contentType string
		progressive bool
		fits        bool
	}{
		"48 MP baseline JPEG":     {image.Config{ColorModel: color.YCbCrModel, Width: 8064, Height: 6048}, "image/jpeg", false, true},
		"14 MP progressive JPEG":  {image.Config{ColorModel: color.YCbCrModel, Width: 4320, Height: 3236}, "image/jpeg", true, true},
		"24 MP progressive JPEG":  {image.Config{ColorModel: color.YCbCrModel, Width: 5712, Height: 4284}, "image/jpeg", true, false},
		"48 MP 8-bit PNG":         {image.Config{ColorModel: color.NRGBAModel, Width: 8064, Height: 6048}, "image/png", false, true},
		"48 MP 16-bit PNG":        {image.Config{ColorModel: color.RGBA64Model, Width: 8064, Height: 6048}, "image/png", false, false},
		"24 MP WebP":              {image.Config{ColorModel: color.YCbCrModel, Width: 5712, Height: 4284}, "image/webp", false, true},
		"48 MP WebP":              {image.Config{ColorModel: color.YCbCrModel, Width: 8064, Height: 6048}, "image/webp", false, false},
		"200 MP grey baseline":    {func() image.Config { cfg := megapixels(200); cfg.ColorModel = color.GrayModel; return cfg }(), "image/jpeg", false, true},
		"300 MP grey progressive": {func() image.Config { cfg := megapixels(300); cfg.ColorModel = color.GrayModel; return cfg }(), "image/jpeg", true, false},
	} {
		if fits := decodeCost(tc.cfg, tc.contentType, tc.progressive) <= maxThumbnailDecode; fits != tc.fits {
			t.Errorf("%s: fits %v, want %v", name, fits, tc.fits)
		}
	}
}

// Averaging keeps every pixel's weight, partial blocks at the edges
// included, and a transparent pixel tints nothing.
func TestShrinkBy(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 5, 3))
	for row := range 3 {
		for column := range 5 {
			src.SetRGBA(column, row, color.RGBA{R: uint8(column * 40), G: uint8(row * 100), A: 255})
		}
	}
	src.SetRGBA(4, 2, color.RGBA{})
	got := shrinkBy(src, 2)
	if got.Bounds() != image.Rect(0, 0, 3, 2) {
		t.Fatalf("bounds %v, want 3×2", got.Bounds())
	}
	for _, tc := range []struct {
		x, y int
		want color.RGBA
	}{
		{0, 0, color.RGBA{R: 20, G: 50, A: 255}},  // x 0–1, y 0–1
		{2, 0, color.RGBA{R: 160, G: 50, A: 255}}, // x 4 only, y 0–1
		{1, 1, color.RGBA{R: 100, G: 200, A: 255}},
		{2, 1, color.RGBA{}}, // the one transparent pixel
	} {
		if pixel := got.RGBAAt(tc.x, tc.y); pixel != tc.want {
			t.Errorf("(%d,%d) = %v, want %v", tc.x, tc.y, pixel, tc.want)
		}
	}
}
