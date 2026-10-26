package files

import (
	"bufio"
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
// read. Only the structure needed to find the tag is walked, and only
// so far; every length is checked against what is there, and nothing is
// read past maxExifBytes at a time.
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

// The walks are bounded, so a file built of empty segments or chunks
// costs no more than a few reads. EXIF sits near the start of a JPEG,
// before the frame header; a WebP keeps it as one of a handful of
// chunks, after the image data.
const (
	maxJPEGSegments = 64
	maxJPEGWalk     = 256 << 10
	maxWebPChunks   = 32
)

// jpegExif walks a JPEG's marker segments up to the frame header and
// returns the TIFF block of its EXIF APP1 segment, or nil. It reads at
// most maxJPEGWalk bytes and maxJPEGSegments segments.
func jpegExif(file io.Reader) []byte {
	reader := bufio.NewReader(io.LimitReader(file, maxJPEGWalk))
	var soi [2]byte
	if _, err := io.ReadFull(reader, soi[:]); err != nil || soi[0] != 0xFF || soi[1] != 0xD8 {
		return nil
	}
	for range maxJPEGSegments {
		if first, err := reader.ReadByte(); err != nil || first != 0xFF {
			return nil
		}
		// Any number of 0xFF fill bytes may come before the code.
		code := byte(0xFF)
		for code == 0xFF {
			var err error
			if code, err = reader.ReadByte(); err != nil {
				return nil
			}
		}
		switch {
		case code == 0x01 || (code >= 0xD0 && code <= 0xD7):
			continue // TEM and the restart markers have no length
		case code == 0x00, code == 0xD9, code == 0xDA, isFrameHeader(code):
			// Not a marker, the end of the image, the start of the scan or
			// the frame header: the metadata is behind us.
			return nil
		}
		var lengthBytes [2]byte
		if _, err := io.ReadFull(reader, lengthBytes[:]); err != nil {
			return nil
		}
		// The length counts its own two bytes.
		length := int(binary.BigEndian.Uint16(lengthBytes[:])) - 2
		if length < 0 {
			return nil
		}
		if code != 0xE1 || length < len(exifHeader) {
			if _, err := reader.Discard(length); err != nil {
				return nil
			}
			continue
		}
		segment := make([]byte, length)
		if _, err := io.ReadFull(reader, segment); err != nil {
			return nil
		}
		if bytes.HasPrefix(segment, exifHeader) {
			return segment[len(exifHeader):]
		}
	}
	return nil
}

// isFrameHeader reports whether a JPEG marker is a start of frame: C0 to
// CF, less DHT (C4), JPG (C8) and DAC (CC).
func isFrameHeader(code byte) bool {
	return code >= 0xC0 && code <= 0xCF && code != 0xC4 && code != 0xC8 && code != 0xCC
}

// webpExif walks a WebP's RIFF chunks and returns its EXIF chunk, or
// nil. Only the extended format (VP8X) carries one, and says so in a
// flag, so a simple WebP is never walked. The walk stays inside the
// RIFF size and stops after maxWebPChunks chunks.
func webpExif(file io.ReadSeeker) []byte {
	const exifFlag = 0x08
	var header [21]byte
	if _, err := io.ReadFull(file, header[:]); err != nil ||
		string(header[:4]) != "RIFF" || string(header[8:12]) != "WEBP" ||
		string(header[12:16]) != "VP8X" || header[20]&exifFlag == 0 {
		return nil
	}
	riffEnd := 8 + int64(binary.LittleEndian.Uint32(header[4:8]))
	// The first chunk is VP8X itself.
	position := int64(12)
	var chunk [8]byte
	for range maxWebPChunks {
		if position+8 > riffEnd {
			return nil
		}
		if _, err := file.Seek(position, io.SeekStart); err != nil {
			return nil
		}
		if _, err := io.ReadFull(file, chunk[:]); err != nil {
			return nil
		}
		size := int64(binary.LittleEndian.Uint32(chunk[4:]))
		if position+8+size > riffEnd {
			return nil
		}
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
		position += 8 + size + size%2
	}
	return nil
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
