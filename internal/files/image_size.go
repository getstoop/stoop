package files

import (
	"bytes"
	"encoding/binary"
	"image"
	"io"
)

// maxExifBytes bounds what the orientation reader holds in memory. A
// JPEG's APP1 segment cannot be larger; a WebP's EXIF chunk could, and
// a larger one is skipped.
const maxExifBytes = 64 << 10

// measureImage reads a PNG, JPEG, GIF or WebP's size from its header
// (no pixels are decoded) and applies the EXIF orientation, so a
// portrait phone photo stored sideways reports portrait. ok is false for
// any other type or a header that won't read; the caller stores no size.
// It reads from the start of file and leaves the offset wherever it
// stopped.
func measureImage(file io.ReadSeeker, contentType string) (width, height int32, ok bool) {
	if !rasterTypes[contentType] {
		return 0, 0, false
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}
	cfg, _, err := image.DecodeConfig(file)
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 1<<30 || cfg.Height > 1<<30 {
		return 0, 0, false
	}
	width, height = int32(cfg.Width), int32(cfg.Height)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return width, height, true
	}
	if swapsAxes(exifOrientation(file, contentType)) {
		width, height = height, width
	}
	return width, height, true
}

// swapsAxes reports whether an EXIF orientation turns the image a
// quarter: 5 to 8 are transposed or rotated 90° either way.
func swapsAxes(orientation int) bool { return orientation >= 5 && orientation <= 8 }

// exifOrientation is the EXIF Orientation tag (1–8) of a JPEG or WebP
// read from the start of file, or 0 when there is none or it won't
// read. Only the structure needed to find the tag is walked, every
// length is checked against what is there, and nothing is read past
// maxExifBytes at a time.
func exifOrientation(file io.ReadSeeker, contentType string) int {
	var tiff []byte
	switch contentType {
	case "image/jpeg":
		tiff = jpegExif(file)
	case "image/webp":
		tiff = webpExif(file)
	}
	if tiff == nil {
		return 0
	}
	return tiffOrientation(tiff)
}

// exifHeader opens an APP1 segment that holds EXIF (XMP uses APP1 too).
var exifHeader = []byte("Exif\x00\x00")

// jpegExif walks a JPEG's marker segments up to the image data and
// returns the TIFF block of its EXIF APP1 segment, or nil.
func jpegExif(file io.ReadSeeker) []byte {
	var marker [4]byte
	if _, err := io.ReadFull(file, marker[:2]); err != nil || marker[0] != 0xFF || marker[1] != 0xD8 {
		return nil
	}
	for {
		if _, err := io.ReadFull(file, marker[:]); err != nil || marker[0] != 0xFF {
			return nil
		}
		code := marker[1]
		// Start of scan or end of image: the metadata is behind us.
		if code == 0xDA || code == 0xD9 {
			return nil
		}
		// The length counts its own two bytes.
		length := int64(binary.BigEndian.Uint16(marker[2:])) - 2
		if length < 0 {
			return nil
		}
		if code != 0xE1 || length < int64(len(exifHeader)) {
			if _, err := file.Seek(length, io.SeekCurrent); err != nil {
				return nil
			}
			continue
		}
		segment := make([]byte, length)
		if _, err := io.ReadFull(file, segment); err != nil {
			return nil
		}
		if bytes.HasPrefix(segment, exifHeader) {
			return segment[len(exifHeader):]
		}
	}
}

// webpExif walks a WebP's RIFF chunks and returns its EXIF chunk, or
// nil. Only the extended format (VP8X) carries one, and says so in a
// flag, so a simple WebP is never walked.
func webpExif(file io.ReadSeeker) []byte {
	const exifFlag = 0x08
	var header [21]byte
	if _, err := io.ReadFull(file, header[:]); err != nil ||
		string(header[:4]) != "RIFF" || string(header[8:12]) != "WEBP" ||
		string(header[12:16]) != "VP8X" || header[20]&exifFlag == 0 {
		return nil
	}
	// Back to the first chunk, VP8X itself, and walk from there.
	if _, err := file.Seek(12, io.SeekStart); err != nil {
		return nil
	}
	var chunk [8]byte
	for {
		if _, err := io.ReadFull(file, chunk[:]); err != nil {
			return nil
		}
		size := int64(binary.LittleEndian.Uint32(chunk[4:]))
		if string(chunk[:4]) == "EXIF" {
			if size > maxExifBytes {
				return nil
			}
			payload := make([]byte, size)
			if _, err := io.ReadFull(file, payload); err != nil {
				return nil
			}
			// The format says TIFF, but some writers keep JPEG's prefix.
			return bytes.TrimPrefix(payload, exifHeader)
		}
		// Chunks are padded to an even length.
		if _, err := file.Seek(size+size%2, io.SeekCurrent); err != nil {
			return nil
		}
	}
}

// tiffOrientation finds tag 0x0112 in a TIFF block's first IFD (where
// EXIF keeps it) and returns its value if that is 1–8, else 0.
func tiffOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(tiff[:4]) {
	case "II*\x00":
		order = binary.LittleEndian
	case "MM\x00*":
		order = binary.BigEndian
	default:
		return 0
	}
	ifd := uint64(order.Uint32(tiff[4:8]))
	if ifd+2 > uint64(len(tiff)) {
		return 0
	}
	count := order.Uint16(tiff[ifd:])
	const entrySize = 12
	const orientationTag = 0x0112
	const typeShort = 3
	for i := range uint64(count) {
		entry := ifd + 2 + i*entrySize
		if entry+entrySize > uint64(len(tiff)) {
			return 0
		}
		if order.Uint16(tiff[entry:]) != orientationTag {
			continue
		}
		// One SHORT, held in the first two bytes of the value field.
		if order.Uint16(tiff[entry+2:]) != typeShort || order.Uint32(tiff[entry+4:]) != 1 {
			return 0
		}
		value := int(order.Uint16(tiff[entry+8:]))
		if value < 1 || value > 8 {
			return 0
		}
		return value
	}
	return 0
}
