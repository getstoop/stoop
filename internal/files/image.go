package files

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/gif"
	_ "image/jpeg" // registers the JPEG decoder
	"image/png"
	"net/http"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the WebP decoder (decode only; output is PNG)
)

const (
	// MaxImageBytes caps what an avatar or icon upload may send.
	MaxImageBytes = 2 << 20
	// maxImagePixels bounds the decoded bitmap (a 2 MB PNG can claim
	// almost any dimensions). 4096² RGBA is 64 MiB.
	maxImagePixels = 4096 * 4096

	AvatarSize    = 256
	SpaceIconSize = 512
)

var (
	errTooLarge    = fmt.Errorf("image must be %d MB or smaller", MaxImageBytes>>20)
	errNotAnImage  = errors.New("not a supported image (PNG, JPEG, GIF, or WebP)")
	errHugeImage   = errors.New("image dimensions are too large")
	errEmptyUpload = errors.New("no image data")
)

// rasterTypes are the image types accepted as uploads (by sniffing) and
// the only content types the download handler will render inline.
var rasterTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
}

// processImage validates an upload and re-encodes it as a size×size PNG.
// The content type is decided by sniffing the bytes — the client's type
// and filename are never consulted — and the decode/re-encode drops any
// metadata (EXIF, ICC, comments) the original carried. Animated GIFs keep
// their first frame.
func processImage(data []byte, size int) ([]byte, error) {
	if len(data) == 0 {
		return nil, errEmptyUpload
	}
	if len(data) > MaxImageBytes {
		return nil, errTooLarge
	}
	if !rasterTypes[http.DetectContentType(data)] {
		return nil, errNotAnImage
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, errNotAnImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxImagePixels {
		return nil, errHugeImage
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errNotAnImage
	}

	// Centre-crop to a square, then scale to the target size.
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	crop := image.Rect(0, 0, side, side).Add(image.Pt(
		b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2,
	))
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)

	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return out.Bytes(), nil
}

// isRaster reports whether a content type may be rendered inline by the
// browser. Anything else is served as a download; in particular SVG never
// renders on the app origin.
func isRaster(contentType string) bool { return rasterTypes[contentType] }

// LinkPreviewMaxDim bounds a link preview image's longer side.
const LinkPreviewMaxDim = 480

// An animated GIF is decoded and written again frame by frame, so the
// animation survives and only frames, delays and the loop count come
// through. Frames are not resized: one that paints part of the canvas
// means nothing without the frames before it. The caps bound what a
// decode may hold, one byte a pixel a frame.
const (
	maxGIFFrames = 500
	maxGIFPixels = 100 << 20
)

// processImageFit re-encodes an image to fit within maxDim on its longer
// side, keeping the aspect ratio (never upscaling), and returns the type
// it wrote: PNG, or GIF for an animation. Same validation and metadata
// stripping as processImage.
func processImageFit(data []byte, maxDim int) ([]byte, string, int, int, error) {
	if len(data) == 0 {
		return nil, "", 0, 0, errEmptyUpload
	}
	sniffed := http.DetectContentType(data)
	if !rasterTypes[sniffed] {
		return nil, "", 0, 0, errNotAnImage
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, errNotAnImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxImagePixels {
		return nil, "", 0, 0, errHugeImage
	}
	if sniffed == "image/gif" {
		frames, err := gifFrames(data)
		if err != nil {
			return nil, "", 0, 0, errNotAnImage
		}
		if frames > 1 {
			if frames > maxGIFFrames || frames*cfg.Width*cfg.Height > maxGIFPixels {
				return nil, "", 0, 0, errHugeImage
			}
			g, err := gif.DecodeAll(bytes.NewReader(data))
			if err != nil {
				return nil, "", 0, 0, errNotAnImage
			}
			var out bytes.Buffer
			if err := gif.EncodeAll(&out, g); err != nil {
				return nil, "", 0, 0, fmt.Errorf("encode gif: %w", err)
			}
			return out.Bytes(), "image/gif", cfg.Width, cfg.Height, nil
		}
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, errNotAnImage
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if longer := max(w, h); longer > maxDim {
		w, h = w*maxDim/longer, h*maxDim/longer
		if w == 0 {
			w = 1
		}
		if h == 0 {
			h = 1
		}
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); err != nil {
		return nil, "", 0, 0, fmt.Errorf("encode png: %w", err)
	}
	return out.Bytes(), "image/png", w, h, nil
}

// gifFrames counts the image descriptors in a GIF by walking its blocks,
// which is cheap where decoding every frame is not; the count bounds the
// decode. Malformed input is an error.
func gifFrames(data []byte) (int, error) {
	bad := errors.New("malformed gif")
	if len(data) < 13 || (string(data[:6]) != "GIF87a" && string(data[:6]) != "GIF89a") {
		return 0, bad
	}
	colorTable := func(packed byte) int {
		if packed&0x80 == 0 {
			return 0
		}
		return 3 << ((packed & 7) + 1)
	}
	i := 13 + colorTable(data[10])
	subBlocks := func() error {
		for {
			if i >= len(data) {
				return bad
			}
			n := int(data[i])
			i++
			if n == 0 {
				return nil
			}
			i += n
		}
	}
	frames := 0
	for {
		if i >= len(data) {
			return 0, bad
		}
		switch data[i] {
		case 0x3B:
			return frames, nil
		case 0x21:
			i += 2
			if err := subBlocks(); err != nil {
				return 0, err
			}
		case 0x2C:
			if i+10 > len(data) {
				return 0, bad
			}
			frames++
			i += 10 + colorTable(data[i+9]) + 1
			if err := subBlocks(); err != nil {
				return 0, err
			}
		default:
			return 0, bad
		}
	}
}
