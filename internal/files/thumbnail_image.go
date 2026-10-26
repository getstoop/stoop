package files

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"

	"golang.org/x/image/draw"
)

// The pixels of a thumbnail: see docs/architecture/files.md → Thumbnails.

const (
	// ThumbnailSize is the square a thumbnail fits inside.
	ThumbnailSize = 1024
	// maxThumbnailMemory bounds what making a thumbnail may hold, in
	// bytes, as thumbnailCost reckons it. It admits a 48 MP baseline
	// JPEG or 8-bit PNG; the resident peak it allows is measured in
	// files.md.
	maxThumbnailMemory = 288 << 20
	// No side over maxThumbnailSide and no shape longer than
	// maxThumbnailAspect to one: a picture that thin is not a photo, and
	// the scaling's buffers grow with the long side.
	maxThumbnailSide   = 20000
	maxThumbnailAspect = 20
	thumbnailQuality   = 82
)

// thumbnailTypes are the attachments a thumbnail is made for. A GIF
// keeps its original: a still would stop the animation.
var thumbnailTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true}

// errNoThumbnailNeeded is a skip, not a failure: the image is already
// small, animated, out of shape or over the bound, and is served as it
// is.
var errNoThumbnailNeeded = errors.New("no thumbnail needed")

// wantsThumbnail is whether an image of this type, first bytes and size
// is worth a thumbnail: a still PNG, JPEG or WebP larger than
// ThumbnailSize on a side and within the shape limits. The upload asks
// it before queueing the job; the job asks it again, then checks the
// bound. An APNG whose animation chunk lies past head is caught by the
// job, which reads the whole header.
func wantsThumbnail(contentType string, head []byte, width, height int) bool {
	if !thumbnailTypes[contentType] ||
		(contentType == "image/webp" && webpAnimated(head)) ||
		(contentType == "image/png" && pngAnimated(bytes.NewReader(head))) {
		return false
	}
	longer, shorter := max(width, height), min(width, height)
	return longer > ThumbnailSize && longer <= maxThumbnailSide && shorter > 0 && longer <= shorter*maxThumbnailAspect
}

// pngAnimated reports whether a PNG has an acTL chunk before its image
// data: an APNG, whose still would stop the animation. It steps from
// chunk to chunk by their lengths, at most 256 of them; a header that
// ends or won't read first counts as still.
func pngAnimated(file io.ReadSeeker) bool {
	if _, err := file.Seek(8, io.SeekStart); err != nil {
		return false
	}
	var chunk [8]byte
	for range 256 {
		if _, err := io.ReadFull(file, chunk[:]); err != nil {
			return false
		}
		switch string(chunk[4:]) {
		case "acTL":
			return true
		case "IDAT":
			return false
		}
		// The data, then its CRC.
		if _, err := file.Seek(int64(binary.BigEndian.Uint32(chunk[:4]))+4, io.SeekCurrent); err != nil {
			return false
		}
	}
	return false
}

// imageHeader is what the bound is reckoned from, all of it read before
// a pixel is decoded.
type imageHeader struct {
	image.Config
	contentType string
	// progressive: a JPEG whose decoder keeps every coefficient.
	progressive bool
	// interlaced: a PNG in Adam7, decoded a pass at a time into images
	// of their own before they are put together.
	interlaced bool
}

// decodeCost is what decoding an image holds, in bytes:
//   - a JPEG's bitmap, YCbCr counted as unsubsampled (3 bytes a pixel),
//     grey 1, CMYK 8 (the decoder keeps it as YCbCr and converts), and
//     for a progressive one its coefficients too, four bytes a sample
//     per component;
//   - a PNG's bitmap, grey counted as 4 or 8 because a tRNS chunk, which
//     the header doesn't show, makes it NRGBA, and doubled when
//     interlaced;
//   - eight bytes a pixel for any WebP, whose lossless decoder holds two
//     copies and whose header doesn't always say which kind it is.
//
// TestDecodeCostCoversTheDecoders checks these against what the
// decoders allocate.
func decodeCost(header imageHeader) int64 {
	pixels := int64(header.Width) * int64(header.Height)
	switch header.contentType {
	case "image/webp":
		return pixels * 8
	case "image/jpeg":
		perPixel, components := int64(3), int64(3)
		switch header.ColorModel {
		case color.GrayModel:
			perPixel, components = 1, 1
		case color.CMYKModel:
			perPixel, components = 8, 4
		}
		if header.progressive {
			perPixel += 4 * components
		}
		return pixels * perPixel
	}
	var perPixel int64
	switch header.ColorModel {
	case color.GrayModel, color.RGBAModel, color.NRGBAModel:
		perPixel = 4
	default:
		if _, paletted := header.ColorModel.(color.Palette); paletted {
			perPixel = 1
		} else {
			perPixel = 8
		}
	}
	if header.interlaced {
		perPixel *= 2
	}
	return pixels * perPixel
}

// thumbnailCost is decodeCost plus what the steps after the decode
// allocate: shrinkBy's band and result, the scaler's buffer (eight
// float64s per destination column per source row), the scaled and the
// turned thumbnail.
func thumbnailCost(header imageHeader) int64 {
	width, height := int64(header.Width), int64(header.Height)
	factor := reductionFactor(header.Width, header.Height)
	reducedWidth, reducedHeight := (width+factor-1)/factor, (height+factor-1)/factor
	thumbWidth, thumbHeight := thumbnailSize(header.Width, header.Height)
	band := width * min(factor, height) * 4
	reduced := reducedWidth * reducedHeight * 4
	scaler := int64(thumbWidth) * reducedHeight * 32
	thumb := int64(thumbWidth) * int64(thumbHeight) * 4 * 2
	return decodeCost(header) + band + reduced + scaler + thumb
}

// reductionFactor is the block shrinkBy averages, so the longer side
// comes out at most twice ThumbnailSize.
func reductionFactor(width, height int) int64 {
	longer := int64(max(width, height))
	return (longer + 2*ThumbnailSize - 1) / (2 * ThumbnailSize)
}

// thumbnailSize fits width×height inside ThumbnailSize×ThumbnailSize.
func thumbnailSize(width, height int) (int, int) {
	longer := max(width, height)
	return max(1, width*ThumbnailSize/longer), max(1, height*ThumbnailSize/longer)
}

// jpegProgressive reports whether a JPEG's frame header is progressive
// (SOF2, SOF6, SOF10 or SOF14), walking its segments as jpegExif does
// and within the same bounds. A walk that gives up says true, which
// costs more and so errs towards skipping.
func jpegProgressive(file io.Reader) bool {
	reader := bufio.NewReader(io.LimitReader(file, maxJPEGWalk))
	var soi [2]byte
	if _, err := io.ReadFull(reader, soi[:]); err != nil || soi[0] != 0xFF || soi[1] != 0xD8 {
		return true
	}
	for range maxJPEGSegments {
		if first, err := reader.ReadByte(); err != nil || first != 0xFF {
			return true
		}
		code := byte(0xFF)
		for code == 0xFF {
			var err error
			if code, err = reader.ReadByte(); err != nil {
				return true
			}
		}
		switch {
		case isFrameHeader(code):
			return code&0x03 == 0x02
		case code == 0x01 || (code >= 0xD0 && code <= 0xD7):
			continue
		case code == 0x00, code == 0xD9, code == 0xDA:
			return true
		}
		var lengthBytes [2]byte
		if _, err := io.ReadFull(reader, lengthBytes[:]); err != nil {
			return true
		}
		length := int(binary.BigEndian.Uint16(lengthBytes[:])) - 2
		if length < 0 {
			return true
		}
		if _, err := reader.Discard(length); err != nil {
			return true
		}
	}
	return true
}

// thumbnail is an encoded thumbnail and its size, the right way up.
type thumbnail struct {
	data          []byte
	contentType   string
	width, height int
}

// makeThumbnail decodes the image as it reads it, scales it to fit
// ThumbnailSize×ThumbnailSize, turns it as its EXIF orientation says and
// encodes a JPEG, or a PNG when any of it is transparent. The re-encode
// drops the metadata. errNoThumbnailNeeded is a skip; errNotAnImage
// means the bytes would not decode.
func makeThumbnail(file io.ReadSeeker, contentType string) (thumbnail, error) {
	// Through the PNG header's interlace byte.
	var head [29]byte
	headLength, _ := io.ReadFull(file, head[:])
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return thumbnail{}, err
	}
	cfg, _, err := image.DecodeConfig(file)
	if err != nil {
		return thumbnail{}, errNotAnImage
	}
	if !wantsThumbnail(contentType, head[:headLength], cfg.Width, cfg.Height) {
		return thumbnail{}, errNoThumbnailNeeded
	}
	header := imageHeader{Config: cfg, contentType: contentType}
	switch contentType {
	case "image/jpeg":
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return thumbnail{}, err
		}
		header.progressive = jpegProgressive(file)
	case "image/png":
		if pngAnimated(file) {
			return thumbnail{}, errNoThumbnailNeeded
		}
		header.interlaced = headLength == len(head) && head[28] == 1
	}
	if thumbnailCost(header) > maxThumbnailMemory {
		return thumbnail{}, errNoThumbnailNeeded
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return thumbnail{}, err
	}
	orientation := exifOrientation(file, contentType)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return thumbnail{}, err
	}
	reduced, err := decodeReduced(file, cfg)
	if err != nil {
		return thumbnail{}, err
	}
	opaque := reduced.Opaque()
	width, height := thumbnailSize(cfg.Width, cfg.Height)
	scaled := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), reduced, reduced.Bounds(), draw.Src, nil)
	turned := orient(scaled, orientation)

	var out bytes.Buffer
	result := thumbnail{contentType: "image/jpeg", width: turned.Bounds().Dx(), height: turned.Bounds().Dy()}
	if opaque {
		err = jpeg.Encode(&out, turned, &jpeg.Options{Quality: thumbnailQuality})
	} else {
		result.contentType = "image/png"
		err = png.Encode(&out, turned)
	}
	if err != nil {
		return thumbnail{}, fmt.Errorf("encode thumbnail: %w", err)
	}
	result.data = out.Bytes()
	return result, nil
}

// decodeReduced decodes the image and averages it down to at most twice
// ThumbnailSize on its longer side, so the scaler's buffer, which grows
// with the source's height, stays small. The full decode is garbage once
// this returns.
func decodeReduced(file io.Reader, cfg image.Config) (*image.RGBA, error) {
	src, _, err := image.Decode(file)
	if err != nil {
		return nil, errNotAnImage
	}
	return shrinkBy(src, int(reductionFactor(cfg.Width, cfg.Height))), nil
}

// shrinkBy averages each factor×factor block of src into one pixel,
// converting factor rows at a time (fewer if the image has fewer) into a
// band so only the band and the result are allocated. The average is of premultiplied colour, so a
// transparent pixel adds nothing to its neighbours. Blocks at the right
// and bottom edges may be partial.
func shrinkBy(src image.Image, factor int) *image.RGBA {
	bounds := src.Bounds()
	srcWidth := bounds.Dx()
	width := (srcWidth + factor - 1) / factor
	height := (bounds.Dy() + factor - 1) / factor
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	band := image.NewRGBA(image.Rect(0, 0, srcWidth, min(factor, bounds.Dy())))
	sums := make([]uint32, width*4)
	counts := make([]uint32, width)
	for outRow := range height {
		top := bounds.Min.Y + outRow*factor
		rows := min(factor, bounds.Max.Y-top)
		draw.Draw(band, image.Rect(0, 0, srcWidth, rows), src, image.Pt(bounds.Min.X, top), draw.Src)
		clear(sums)
		clear(counts)
		for row := range rows {
			line := band.Pix[row*band.Stride : row*band.Stride+srcWidth*4]
			for column := range srcWidth {
				cell := column / factor
				sums[cell*4] += uint32(line[column*4])
				sums[cell*4+1] += uint32(line[column*4+1])
				sums[cell*4+2] += uint32(line[column*4+2])
				sums[cell*4+3] += uint32(line[column*4+3])
				counts[cell]++
			}
		}
		out := dst.Pix[outRow*dst.Stride : outRow*dst.Stride+width*4]
		for cell, count := range counts {
			for channel := range 4 {
				out[cell*4+channel] = uint8((sums[cell*4+channel] + count/2) / count)
			}
		}
	}
	return dst
}

// orient turns img the way an EXIF orientation (1–8) asks, so the
// thumbnail is the right way up without the tag.
func orient(img *image.RGBA, orientation int) *image.RGBA {
	if orientation < 2 || orientation > 8 {
		return img
	}
	width, height := img.Bounds().Dx(), img.Bounds().Dy()
	outWidth, outHeight := width, height
	if swapsAxes(orientation) {
		outWidth, outHeight = height, width
	}
	out := image.NewRGBA(image.Rect(0, 0, outWidth, outHeight))
	for row := range height {
		for column := range width {
			var toX, toY int
			switch orientation {
			case 2: // mirrored left to right
				toX, toY = width-1-column, row
			case 3: // upside down
				toX, toY = width-1-column, height-1-row
			case 4: // flipped top to bottom
				toX, toY = column, height-1-row
			case 5: // transposed
				toX, toY = row, column
			case 6: // a quarter turn clockwise
				toX, toY = height-1-row, column
			case 7: // transverse
				toX, toY = height-1-row, width-1-column
			case 8: // a quarter turn anticlockwise
				toX, toY = row, width-1-column
			}
			copy(out.Pix[out.PixOffset(toX, toY):][:4], img.Pix[img.PixOffset(column, row):][:4])
		}
	}
	return out
}
