package files

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // registers the GIF decoder
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

// processImageFit re-encodes an image to fit within maxDim on its longer
// side, keeping the aspect ratio (never upscaling). Same validation and
// metadata stripping as processImage.
func processImageFit(data []byte, maxDim int) ([]byte, int, int, error) {
	if len(data) == 0 {
		return nil, 0, 0, errEmptyUpload
	}
	if !rasterTypes[http.DetectContentType(data)] {
		return nil, 0, 0, errNotAnImage
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, errNotAnImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxImagePixels {
		return nil, 0, 0, errHugeImage
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, errNotAnImage
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
		return nil, 0, 0, fmt.Errorf("encode png: %w", err)
	}
	return out.Bytes(), w, h, nil
}
