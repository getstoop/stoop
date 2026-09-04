package files

import (
	"net/http"
	"testing"
)

// ftyp builds an ISO base media file header: size, "ftyp", the major
// brand, a zero minor version, then the compatible brands.
func ftyp(major string, compatible ...string) []byte {
	body := "ftyp" + major + "\x00\x00\x00\x00"
	for _, b := range compatible {
		body += b
	}
	size := 4 + len(body)
	return append([]byte{byte(size >> 24), byte(size >> 16), byte(size >> 8), byte(size)}, body...)
}

func TestSniffContentType(t *testing.T) {
	cases := []struct {
		name string
		head []byte
		want string
	}{
		{"android mp4", ftyp("mp42", "mp42", "isom"), "video/mp4"},
		{"ffmpeg mp4 (isom major, mp41 compatible)", ftyp("isom", "isom", "iso2", "avc1", "mp41"), "video/mp4"},
		{"iso-only brands", ftyp("iso5", "iso6", "avc1"), "video/mp4"},
		{"iphone mov", ftyp("qt  "), "video/quicktime"},
		{"qt in compatible brands", ftyp("isom", "qt  "), "video/quicktime"},
		{"itunes m4v", ftyp("M4V ", "M4V ", "mp42", "isom"), "video/mp4"},
		{"m4a audio", ftyp("M4A ", "M4A ", "mp42", "isom"), "audio/mp4"},
		{"pre-ftyp quicktime is not recognised", []byte("\x00\x00\x10\x00moov\x00\x00\x00\x08mvhd"), "application/octet-stream"},
		{"truetype is not quicktime", []byte("\x00\x01\x00\x00\x00\x0c\x00\x80\x00\x03\x00\x20cmap"), "font/ttf"},
		{"unknown brand", ftyp("3gp4", "3gp4"), "application/octet-stream"},
		{"webm", []byte("\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84webm"), "video/webm"},
		{"mp3 with id3", []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), "audio/mpeg"},
		{"png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), "image/png"},
		{"text", []byte("hello\n"), "text/plain; charset=utf-8"},
		{"short garbage", []byte("\x00\x00\x00"), "application/octet-stream"},
		{"ftyp box size not a multiple of four", []byte("\x00\x00\x00\x0dftypqt  \x00\x00\x00\x00"), "application/octet-stream"},
		{"empty", nil, "text/plain; charset=utf-8"},
	}
	for _, c := range cases {
		if got := sniffContentType(c.head); got != c.want {
			t.Errorf("%s: sniffed %q, want %q", c.name, got, c.want)
		}
	}
	// Whatever the sniffer produces for media is something the handler
	// will serve inline; check the two agree on the names.
	for _, ct := range []string{"video/mp4", "video/quicktime", "video/webm", "audio/mp4", "audio/mpeg"} {
		if !isPlayable(ct) {
			t.Errorf("%s sniffed but not playable", ct)
		}
	}
	if isPlayable(http.DetectContentType([]byte("<svg xmlns='http://www.w3.org/2000/svg'/>"))) {
		t.Error("svg must never be playable")
	}
}

func TestResolveRange(t *testing.T) {
	const etag = `"abc"`
	cases := []struct {
		name          string
		rng, ifRange  string
		total         int64
		offset, count int64
		status        int
	}{
		{"no header", "", "", 100, 0, 100, 200},
		{"closed", "bytes=10-19", "", 100, 10, 10, 206},
		{"open-ended", "bytes=90-", "", 100, 90, 10, 206},
		{"end clamped", "bytes=90-500", "", 100, 90, 10, 206},
		{"suffix", "bytes=-25", "", 100, 75, 25, 206},
		{"suffix bigger than blob", "bytes=-500", "", 100, 0, 100, 206},
		{"ios probe", "bytes=0-1", "", 100, 0, 2, 206},
		{"whole blob as a range", "bytes=0-99", "", 100, 0, 100, 206},
		{"case-insensitive unit", "BYTES=0-0", "", 100, 0, 1, 206},
		{"start past the end", "bytes=100-", "", 100, 0, 0, 416},
		{"suffix of zero", "bytes=-0", "", 100, 0, 0, 416},
		{"empty blob", "bytes=0-", "", 0, 0, 0, 416},
		{"if-range matches", "bytes=5-5", etag, 100, 5, 1, 206},
		{"if-range differs", "bytes=5-5", `"other"`, 100, 0, 100, 200},
		{"multiple ranges", "bytes=0-1,5-6", "", 100, 0, 100, 200},
		{"other unit", "items=0-1", "", 100, 0, 100, 200},
		{"inverted", "bytes=9-3", "", 100, 0, 100, 200},
		{"garbage", "bytes=abc", "", 100, 0, 100, 200},
		{"no dash", "bytes=5", "", 100, 0, 100, 200},
	}
	for _, c := range cases {
		h := http.Header{}
		if c.rng != "" {
			h.Set("Range", c.rng)
		}
		if c.ifRange != "" {
			h.Set("If-Range", c.ifRange)
		}
		offset, count, status := resolveRange(h, etag, c.total)
		if offset != c.offset || count != c.count || status != c.status {
			t.Errorf("%s: got (%d, %d, %d), want (%d, %d, %d)", c.name, offset, count, status, c.offset, c.count, c.status)
		}
	}
}
