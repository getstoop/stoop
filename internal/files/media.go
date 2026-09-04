package files

import (
	"encoding/binary"
	"net/http"
)

// playableTypes are the audio and video content types the download
// handler serves inline so the browser's <video> / <audio> element can
// play them. Whether a given file actually decodes is the browser's
// business (an HEVC clip plays in Safari and not in Firefox); the web app
// falls back to a download card when playback fails. Nothing here is
// transcoded: the bytes are served as uploaded.
var playableTypes = map[string]bool{
	"video/mp4": true, "video/webm": true, "video/quicktime": true,
	"audio/mpeg": true, "audio/mp4": true, "audio/wave": true, "audio/ogg": true,
	"application/ogg": true,
}

// isPlayable reports whether a content type is served inline for playback.
func isPlayable(contentType string) bool { return playableTypes[contentType] }

// sniffContentType is http.DetectContentType with a better answer for
// ISO base media files. Go's sniffer only claims an ftyp box whose
// brands start with "mp4", so an iPhone's .mov ("qt  ") comes back as
// octet-stream — and an .m4a, whose compatible brands include mp42, as
// video/mp4. So an ftyp box is read here first, from the same brand
// list, and everything else is left to the standard sniffer. Files from
// before ftyp was mandatory (QuickTime 6-era .mov, ~2005) are not
// recognised: they start straight at a moov/mdat atom, which is too
// little to tell apart from other formats. head is the first bytes of
// the file, 512 or fewer.
func sniffContentType(head []byte) string {
	if ct := sniffISOBrands(head); ct != "" {
		return ct
	}
	return http.DetectContentType(head)
}

// sniffISOBrands walks an ftyp box's major and compatible brands. The
// box is: 4-byte size, "ftyp", major brand, minor version, then
// compatible brands, four bytes each.
func sniffISOBrands(head []byte) string {
	if len(head) < 12 || string(head[4:8]) != "ftyp" {
		return ""
	}
	size := int(binary.BigEndian.Uint32(head[:4]))
	if size%4 != 0 || size < 12 {
		return ""
	}
	size = min(size, len(head))
	result := ""
	for off := 8; off+4 <= size; off += 4 {
		if off == 12 {
			continue // minor version
		}
		switch string(head[off : off+4]) {
		case "qt  ":
			return "video/quicktime" // the major brand of every .mov; decisive
		case "M4A ":
			return "audio/mp4"
		case "M4V ", "isom", "iso2", "iso5", "iso6", "avc1", "mp41", "mp42":
			if result == "" {
				result = "video/mp4"
			}
		}
	}
	return result
}
