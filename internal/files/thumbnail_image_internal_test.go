package files

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
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
	if wantsThumbnail("image/jpeg", nil, 1024, 1024) || !wantsThumbnail("image/jpeg", nil, 1025, 1000) {
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

// jpegHeader is a JPEG whose scan is empty: enough for
// DecodeConfig and the bound, not for a decode. frame is the SOF code.
func jpegHeader(frame byte, width, height int) []byte {
	out := []byte{0xFF, 0xD8}
	// A comment segment first, so the walk has to step over one.
	out = append(out, 0xFF, 0xFE, 0x00, 0x04, 'h', 'i')
	out = append(out, 0xFF, frame, 0x00, 17, 8)
	out = binary.BigEndian.AppendUint16(out, uint16(height))
	out = binary.BigEndian.AppendUint16(out, uint16(width))
	out = append(out, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0)
	out = append(out, 0xFF, 0xDA, 0x00, 0x0C, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0)
	return append(out, 0xFF, 0xD9)
}

// The bound is reckoned from the header before anything is decoded. A
// 48 MP baseline JPEG is under it and goes on to the decode (which this
// header-only file fails); a progressive one of 24 MP, whose decoder
// keeps every coefficient, is over it and skipped without one.
func TestThumbnailBound(t *testing.T) {
	baseline := jpegHeader(0xC0, 8064, 6048)
	if _, err := makeThumbnail(bytes.NewReader(baseline), "image/jpeg"); !errors.Is(err, errNotAnImage) {
		t.Errorf("48 MP baseline: %v, want it decoded (and fail)", err)
	}
	progressive := jpegHeader(0xC2, 5712, 4284)
	if _, err := makeThumbnail(bytes.NewReader(progressive), "image/jpeg"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("24 MP progressive: %v, want a skip", err)
	}
	if !jpegProgressive(bytes.NewReader(progressive)) || jpegProgressive(bytes.NewReader(baseline)) {
		t.Error("jpegProgressive misread the frame header")
	}
	// Grey with a tRNS chunk decodes to NRGBA, which the header can't
	// show: 14400² would hold 829 MB.
	grey := rawPNG(t, pngSpec{width: 14400, height: 14400, depth: 8, colorType: 0, transparent: true})
	if _, err := makeThumbnail(bytes.NewReader(grey), "image/png"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("14400² grey PNG: %v, want a skip", err)
	}

	sized := func(model color.Model, width, height int, contentType string) imageHeader {
		return imageHeader{Config: image.Config{ColorModel: model, Width: width, Height: height}, contentType: contentType}
	}
	progressiveJPEG := func(model color.Model, width, height int) imageHeader {
		header := sized(model, width, height, "image/jpeg")
		header.progressive = true
		return header
	}
	rgbJPEG := func(width, height int) imageHeader {
		header := sized(color.YCbCrModel, width, height, "image/jpeg")
		header.rgb = true
		return header
	}
	interlacedPNG := func(model color.Model, width, height int) imageHeader {
		header := sized(model, width, height, "image/png")
		header.interlaced = true
		return header
	}
	for name, tc := range map[string]struct {
		header imageHeader
		fits   bool
	}{
		"48 MP baseline JPEG":          {sized(color.YCbCrModel, 8064, 6048, "image/jpeg"), true},
		"14 MP progressive JPEG":       {progressiveJPEG(color.YCbCrModel, 4320, 3236), true},
		"24 MP progressive JPEG":       {progressiveJPEG(color.YCbCrModel, 5712, 4284), false},
		"24 MP CMYK JPEG":              {sized(color.CMYKModel, 5712, 4284, "image/jpeg"), true},
		"48 MP CMYK JPEG":              {sized(color.CMYKModel, 8064, 6048, "image/jpeg"), false},
		"12 MP progressive CMYK JPEG":  {progressiveJPEG(color.CMYKModel, 4032, 3024), false},
		"144 MP grey JPEG":             {sized(color.GrayModel, 12000, 12000, "image/jpeg"), true},
		"144 MP progressive grey JPEG": {progressiveJPEG(color.GrayModel, 12000, 12000), false},
		"48 MP 8-bit PNG":              {sized(color.NRGBAModel, 8064, 6048, "image/png"), true},
		"48 MP grey PNG":               {sized(color.GrayModel, 8064, 6048, "image/png"), true},
		"207 MP grey PNG":              {sized(color.GrayModel, 14400, 14400, "image/png"), false},
		"48 MP 16-bit PNG":             {sized(color.RGBA64Model, 8064, 6048, "image/png"), false},
		"24 MP interlaced PNG":         {interlacedPNG(color.NRGBAModel, 5712, 4284), true},
		"48 MP interlaced PNG":         {interlacedPNG(color.NRGBAModel, 8064, 6048), false},
		"16 MP WebP":                   {sized(color.YCbCrModel, 4608, 3456, "image/webp"), true},
		"24 MP WebP":                   {sized(color.YCbCrModel, 5712, 4284, "image/webp"), false},
		"32 MP RGB JPEG":               {rgbJPEG(6528, 4896), true},
		"48 MP RGB JPEG":               {rgbJPEG(8064, 6048), false},
	} {
		if fits := thumbnailCost(tc.header) <= maxDecodeMemory; fits != tc.fits {
			t.Errorf("%s: fits %v, want %v", name, fits, tc.fits)
		}
	}
}

// A shape no photo has is refused from its size alone: no side over
// 20,000 and nothing longer than 20 to 1. A 200,000,000×1 grey PNG is
// under 200 KB.
func TestThumbnailShape(t *testing.T) {
	for _, tc := range []struct {
		width, height int
		want          bool
	}{
		{6000, 4000, true},
		{20000, 1000, true},
		{20001, 2000, false},
		{20000, 999, false},
		{200_000_000, 1, false},
		{1, 200_000_000, false},
	} {
		if got := wantsThumbnail("image/png", nil, tc.width, tc.height); got != tc.want {
			t.Errorf("%d×%d: %v, want %v", tc.width, tc.height, got, tc.want)
		}
	}
	thin := rawPNG(t, pngSpec{width: 200_000_000, height: 1, depth: 8, colorType: 0})
	if _, err := makeThumbnail(bytes.NewReader(thin), "image/png"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("200,000,000×1: %v, want a skip", err)
	}
}

// An APNG keeps its animation, whether the upload's first bytes show
// the acTL chunk or only the job's walk does.
func TestThumbnailSkipsAPNG(t *testing.T) {
	animated := rawPNG(t, pngSpec{width: 1500, height: 1000, depth: 8, colorType: 6, animated: true})
	if wantsThumbnail("image/png", animated[:64], 1500, 1000) {
		t.Error("the upload would queue an APNG")
	}
	late := rawPNG(t, pngSpec{width: 1500, height: 1000, depth: 8, colorType: 6, animated: true, padding: 4096})
	if !wantsThumbnail("image/png", late[:512], 1500, 1000) {
		t.Fatal("the padding should hide the acTL chunk from the first bytes")
	}
	if _, err := makeThumbnail(bytes.NewReader(late), "image/png"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("APNG: %v, want a skip", err)
	}
	// More chunks before the image data than the walk reads: the acTL
	// may be among the rest, so it is a skip.
	long := rawPNG(t, pngSpec{width: 1500, height: 1000, depth: 8, colorType: 6, animated: true, comments: 300})
	if _, err := makeThumbnail(bytes.NewReader(long), "image/png"); !errors.Is(err, errNoThumbnailNeeded) {
		t.Errorf("APNG past 256 chunks: %v, want a skip", err)
	}
	still := rawPNG(t, pngSpec{width: 1500, height: 1000, depth: 8, colorType: 6})
	if _, err := makeThumbnail(bytes.NewReader(still), "image/png"); err != nil {
		t.Errorf("a still PNG: %v", err)
	}
}

// A JPEG is read as RGB, and costs more than twice as much, when it has
// no JFIF APP0 and an Adobe APP14 says transform 0, wherever in the file
// the APP14 is: after the scan too, past where DecodeConfig stops. A
// phone photo has neither (an EXIF APP1 and no JFIF) and is YCbCr.
func TestJPEGDecodesAsRGB(t *testing.T) {
	phone := encodeJPEG(t, quadrants(64, 48), 6)
	adobe := []byte{0xFF, 0xEE, 0x00, 0x0E, 'A', 'd', 'o', 'b', 'e', 0, 100, 0, 0, 0, 0, 0}
	beforeEnd := func(data, segment []byte) []byte {
		out := append([]byte{}, data[:len(data)-2]...)
		return append(append(out, segment...), 0xFF, 0xD9)
	}
	jfif := []byte{0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0}
	afterSOI := func(data, segment []byte) []byte {
		out := append([]byte{}, data[:2]...)
		return append(append(out, segment...), data[2:]...)
	}
	for name, tc := range map[string]struct {
		data []byte
		rgb  bool
	}{
		"a phone photo":                   {phone, false},
		"an APP14 after the scan":         {beforeEnd(phone, adobe), true},
		"the same with JFIF":              {afterSOI(beforeEnd(phone, adobe), jfif), false},
		"cjpeg -rgb":                      {readTestdata(t, "smooth-rgb.jpeg"), true},
		"cjpeg -rgb, progressive":         {readTestdata(t, "smooth-rgb.progressive.jpeg"), true},
		"a progressive YCbCr photo":       {readTestdata(t, "smooth-444.progressive.jpeg"), false},
		"a file that ends before its end": {phone[:len(phone)-40], true},
	} {
		if got := jpegDecodesAsRGB(bytes.NewReader(tc.data)); got != tc.rgb {
			t.Errorf("%s: %v, want %v", name, got, tc.rgb)
		}
		if tc.data[len(tc.data)-1] != 0xD9 {
			continue
		}
		// What the decoder does is the truth this follows.
		img, err := jpeg.Decode(bytes.NewReader(tc.data))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if _, isRGB := img.(*image.RGBA); isRGB != tc.rgb {
			t.Errorf("%s: the decoder gave a %T", name, img)
		}
	}
}

func readTestdata(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// decodeSlack is what a decoder allocates whatever the image's size:
// Huffman and quantisation tables, a zlib window, read buffers.
const decodeSlack = 192 << 10

// decodeCost is an upper bound on what each decoder allocates, for every
// PNG colour type with and without tRNS and Adam7, a still GIF, and JPEG and WebP of
// each kind. TotalAlloc counts everything allocated, so it is above the
// peak.
func TestDecodeCostCoversTheDecoders(t *testing.T) {
	cases := map[string][]byte{}
	for _, colorType := range []byte{0, 2, 3, 4, 6} {
		for _, depth := range []byte{8, 16} {
			if colorType == 3 && depth == 16 {
				continue
			}
			for _, transparent := range []bool{false, true} {
				if transparent && (colorType == 4 || colorType == 6) {
					continue // already has alpha; tRNS is not allowed
				}
				for _, interlaced := range []bool{false, true} {
					spec := pngSpec{width: 1000, height: 800, depth: depth, colorType: colorType, transparent: transparent, interlaced: interlaced}
					cases[fmt.Sprintf("png type %d, %d-bit, tRNS %v, interlaced %v", colorType, depth, transparent, interlaced)] = rawPNG(t, spec)
				}
			}
		}
	}
	var grey bytes.Buffer
	if err := jpeg.Encode(&grey, image.NewGray(image.Rect(0, 0, 1000, 800)), nil); err != nil {
		t.Fatal(err)
	}
	cases["grey baseline JPEG"] = grey.Bytes()
	cases["YCbCr baseline JPEG"] = encodeJPEG(t, quadrants(1000, 800), 0)
	var still bytes.Buffer
	if err := gif.Encode(&still, quadrants(1000, 800), nil); err != nil {
		t.Fatal(err)
	}
	cases["still GIF"] = still.Bytes()
	for _, name := range []string{
		"smooth-444.progressive.jpeg", "video-005.gray.q50.progressive.jpeg", "video-001.cmyk.jpeg",
		"smooth-rgb.jpeg", "smooth-rgb.progressive.jpeg",
		"video-001.lossy.webp", "yellow_rose.lossy-with-alpha.webp", "blue-purple-pink.lossless.webp",
	} {
		cases[name] = readTestdata(t, name)
	}

	for name, data := range cases {
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		header, err := readImageHeader(bytes.NewReader(data), "image/"+format, cfg)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		runtime.ReadMemStats(&after)
		allocated := int64(after.TotalAlloc - before.TotalAlloc)
		if cost := decodeCost(header); allocated > cost+decodeSlack {
			t.Errorf("%s (%d×%d): allocated %d bytes, decodeCost %d", name, cfg.Width, cfg.Height, allocated, cost)
		}
	}
}

// pngSpec is a PNG for rawPNG to write: its header fields, and whether
// it carries a tRNS chunk, an acTL chunk, and padding or a run of
// comment chunks before either.
type pngSpec struct {
	width, height                     int
	depth, colorType                  byte
	transparent, interlaced, animated bool
	padding, comments                 int
}

// rawPNG writes a PNG of zero-valued pixels by hand: Go's encoder writes
// neither tRNS for grey nor Adam7, and the zeros compress to nothing, so
// a large one costs little to make.
func rawPNG(t *testing.T, spec pngSpec) []byte {
	t.Helper()
	chunk := func(out []byte, kind string, data []byte) []byte {
		out = binary.BigEndian.AppendUint32(out, uint32(len(data)))
		start := len(out)
		out = append(out, kind...)
		out = append(out, data...)
		return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(out[start:]))
	}
	out := []byte("\x89PNG\r\n\x1a\n")
	ihdr := binary.BigEndian.AppendUint32(nil, uint32(spec.width))
	ihdr = binary.BigEndian.AppendUint32(ihdr, uint32(spec.height))
	interlace := byte(0)
	if spec.interlaced {
		interlace = 1
	}
	out = chunk(out, "IHDR", append(ihdr, spec.depth, spec.colorType, 0, 0, interlace))
	if spec.padding > 0 {
		out = chunk(out, "tEXt", append([]byte("Comment\x00"), make([]byte, spec.padding)...))
	}
	for range spec.comments {
		out = chunk(out, "tEXt", []byte("Comment\x00hi"))
	}
	if spec.animated {
		out = chunk(out, "acTL", []byte{0, 0, 0, 2, 0, 0, 0, 0})
	}
	if spec.colorType == 3 {
		out = chunk(out, "PLTE", []byte{0, 0, 0})
	}
	if spec.transparent {
		samples := map[byte]int{0: 2, 2: 6, 3: 1}[spec.colorType]
		out = chunk(out, "tRNS", make([]byte, samples))
	}
	if spec.width*spec.height > 100_000_000 {
		// Only the header is read.
		return chunk(out, "IEND", nil)
	}
	channels := map[byte]int{0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[spec.colorType]
	rowBytes := func(width int) int { return (width*channels*int(spec.depth) + 7) / 8 }
	var raw []byte
	if spec.interlaced {
		for _, pass := range [][4]int{{0, 0, 8, 8}, {4, 0, 8, 8}, {0, 4, 4, 8}, {2, 0, 4, 4}, {0, 2, 2, 4}, {1, 0, 2, 2}, {0, 1, 1, 2}} {
			width := (spec.width - pass[0] + pass[2] - 1) / pass[2]
			height := (spec.height - pass[1] + pass[3] - 1) / pass[3]
			if width > 0 && height > 0 {
				raw = append(raw, make([]byte, height*(1+rowBytes(width)))...)
			}
		}
	} else {
		raw = make([]byte, spec.height*(1+rowBytes(spec.width)))
	}
	var compressed bytes.Buffer
	writer := zlib.NewWriter(&compressed)
	if _, err := writer.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	out = chunk(out, "IDAT", compressed.Bytes())
	return chunk(out, "IEND", nil)
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
