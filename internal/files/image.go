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
	errTooLarge     = fmt.Errorf("image must be %d MB or smaller", MaxImageBytes>>20)
	errNotAnImage   = errors.New("not a supported image (PNG, JPEG, GIF, or WebP)")
	errHugeImage    = errors.New("image dimensions are too large")
	errEmptyUpload  = errors.New("no image data")
	errAnimatedWebP = errors.New("animated WebP is not supported; a still image or a GIF works")
)

// rasterTypes are the image types accepted as uploads (by sniffing) and
// the only content types the download handler will render inline.
var rasterTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
}

// sniffImage decides the content type from the bytes — the client's type
// and filename are never consulted — and bounds the decode.
func sniffImage(data []byte) (contentType string, cfg image.Config, err error) {
	if len(data) == 0 {
		return "", image.Config{}, errEmptyUpload
	}
	contentType = http.DetectContentType(data)
	if !rasterTypes[contentType] {
		return "", image.Config{}, errNotAnImage
	}
	cfg, _, err = image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", image.Config{}, errNotAnImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxImagePixels {
		return "", image.Config{}, errHugeImage
	}
	return contentType, cfg, nil
}

// validateImage is what an avatar or icon upload refuses in the request:
// the byte cap, what sniffImage refuses, an animated WebP, which passes
// the sniff but the decoder will not read, and an image whose decode and
// scaling to size×size would hold more than maxDecodeMemory. It returns
// the sniffed type.
func validateImage(data []byte, size int) (string, error) {
	if len(data) > MaxImageBytes {
		return "", errTooLarge
	}
	contentType, cfg, err := sniffImage(data)
	if err != nil {
		return "", err
	}
	if contentType == "image/webp" && webpAnimated(data) {
		return "", errAnimatedWebP
	}
	if !fitsDecodeMemory(data, contentType, cfg, size, size) {
		return "", errHugeImage
	}
	return contentType, nil
}

// fitsDecodeMemory reports whether decoding data and scaling it to
// width×height stays within maxDecodeMemory, as fitCost reckons it.
func fitsDecodeMemory(data []byte, contentType string, cfg image.Config, width, height int) bool {
	header, err := readImageHeader(bytes.NewReader(data), contentType, cfg)
	return err == nil && fitCost(header, width, height) <= maxDecodeMemory
}

// fitCost is decodeCost plus what scaling the decode to width×height
// allocates: the scaler's buffer (eight float64s per destination column
// per source row, the whole height counted though a crop may use less)
// and the result.
func fitCost(header imageHeader, width, height int) int64 {
	scaler := int64(width) * int64(header.Height) * 32
	result := int64(width) * int64(height) * 4
	return decodeCost(header) + scaler + result
}

// webpAnimated reports whether a WebP's VP8X header has its animation
// flag set. The flags byte follows the RIFF header and the chunk's id
// and size.
func webpAnimated(data []byte) bool {
	const flagsOffset = 20
	const animationBit = 0x02
	return len(data) > flagsOffset && string(data[12:16]) == "VP8X" && data[flagsOffset]&animationBit != 0
}

// normaliseImage decodes a validated image, centre-crops it to a square
// and scales it to size×size, re-encoded as PNG. The decode drops any
// metadata (EXIF, ICC, comments) the original carried; an animated GIF
// keeps its first frame.
func normaliseImage(data []byte, size int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errNotAnImage
	}
	bounds := src.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	crop := image.Rect(0, 0, side, side).Add(image.Pt(
		bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2,
	))
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)

	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return out.Bytes(), nil
}

// processImage validates and normalises in one step: what the
// normalise_image job runs on the stored upload.
func processImage(data []byte, size int) ([]byte, error) {
	if _, err := validateImage(data, size); err != nil {
		return nil, err
	}
	return normaliseImage(data, size)
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
// stripping as processImage, and the same memory bound.
func processImageFit(data []byte, maxDim int) ([]byte, string, int, int, error) {
	sniffed, cfg, err := sniffImage(data)
	if err != nil {
		return nil, "", 0, 0, err
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
	width, height := cfg.Width, cfg.Height
	if longer := max(width, height); longer > maxDim {
		width, height = max(1, width*maxDim/longer), max(1, height*maxDim/longer)
	}
	if !fitsDecodeMemory(data, sniffed, cfg, width, height) {
		return nil, "", 0, 0, errHugeImage
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, errNotAnImage
	}
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); err != nil {
		return nil, "", 0, 0, fmt.Errorf("encode png: %w", err)
	}
	return out.Bytes(), "image/png", width, height, nil
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
