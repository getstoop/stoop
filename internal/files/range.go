package files

import (
	"net/http"
	"strconv"
	"strings"
)

// resolveRange interprets a request's Range header against a blob of
// total bytes and returns the window to serve with the status to send:
// 200 and the whole blob when there is nothing usable to honour (no
// header, a malformed one, several ranges, or an If-Range that doesn't
// match — the spec says to ignore the range in each case), 206 and the
// requested window, or 416 when the window starts past the end.
//
// One range at a time is all a media element ever asks for, so
// multipart/byteranges isn't implemented.
func resolveRange(h http.Header, etag string, total int64) (offset, length int64, status int) {
	full := func() (int64, int64, int) { return 0, total, http.StatusOK }
	spec := h.Get("Range")
	if spec == "" {
		return full()
	}
	if ir := h.Get("If-Range"); ir != "" && ir != etag {
		return full()
	}
	if !strings.HasPrefix(strings.ToLower(spec), "bytes=") {
		return full()
	}
	spec = strings.TrimSpace(spec[len("bytes="):])
	if strings.Contains(spec, ",") {
		return full()
	}
	first, last, ok := strings.Cut(spec, "-")
	if !ok {
		return full()
	}
	first, last = strings.TrimSpace(first), strings.TrimSpace(last)

	// bytes=-N: the last N bytes.
	if first == "" {
		n, err := strconv.ParseInt(last, 10, 64)
		if err != nil {
			return full()
		}
		if n <= 0 || total == 0 {
			return 0, 0, http.StatusRequestedRangeNotSatisfiable
		}
		n = min(n, total)
		return total - n, n, http.StatusPartialContent
	}

	start, err := strconv.ParseInt(first, 10, 64)
	if err != nil || start < 0 {
		return full()
	}
	if start >= total {
		return 0, 0, http.StatusRequestedRangeNotSatisfiable
	}
	end := total - 1
	if last != "" {
		end, err = strconv.ParseInt(last, 10, 64)
		if err != nil || end < start {
			return full()
		}
		end = min(end, total-1)
	}
	return start, end - start + 1, http.StatusPartialContent
}
