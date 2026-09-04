package webui

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestCachingHeaders(t *testing.T) {
	h := handler(fstest.MapFS{
		"index.html":             {Data: []byte("<html>v1</html>")},
		"assets/index-abc123.js": {Data: []byte("console.log(1)")},
		"favicon.svg":            {Data: []byte("<svg/>")},
	})
	get := func(path string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// index.html and the SPA fallback: always revalidate, with an ETag.
	for _, p := range []string{"/", "/index.html", "/s/some/client/route"} {
		rec := get(p, nil)
		if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" || rec.Header().Get("ETag") == "" {
			t.Errorf("%s: code=%d cache-control=%q etag=%q", p, rec.Code, rec.Header().Get("Cache-Control"), rec.Header().Get("ETag"))
		}
		if rec.Body.String() != "<html>v1</html>" {
			t.Errorf("%s: body = %q", p, rec.Body.String())
		}
	}
	etag := get("/", nil).Header().Get("ETag")
	if rec := get("/", map[string]string{"If-None-Match": etag}); rec.Code != http.StatusNotModified {
		t.Errorf("revalidation with the current ETag should be 304, got %d", rec.Code)
	}
	if rec := get("/", map[string]string{"If-None-Match": `"stale"`}); rec.Code != 200 {
		t.Errorf("revalidation with a stale ETag should serve the page, got %d", rec.Code)
	}

	// A new build changes the ETag.
	h2 := handler(fstest.MapFS{"index.html": {Data: []byte("<html>v2</html>")}})
	rec := httptest.NewRecorder()
	h2.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Header().Get("ETag") == etag {
		t.Error("ETag must change when index.html changes")
	}

	// Hashed assets are immutable; other root files revalidate.
	if rec := get("/assets/index-abc123.js", nil); rec.Code != 200 || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset: code=%d cache-control=%q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if rec := get("/favicon.svg", nil); rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("root file: code=%d cache-control=%q", rec.Code, rec.Header().Get("Cache-Control"))
	}

	// No embedded build at all: the plain-text hint, not a crash.
	h3 := handler(fstest.MapFS{})
	rec = httptest.NewRecorder()
	h3.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Errorf("no build: code=%d type=%q", rec.Code, rec.Header().Get("Content-Type"))
	}
}
