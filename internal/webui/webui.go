// Package webui serves the embedded single-page app. Vite writes the
// bundles with content hashes in their names, so the caching rule is the
// standard one for SPAs: index.html must be revalidated on every load
// (otherwise a tab keeps running the previous build after an upgrade, or
// points at bundles that no longer exist), and the hashed assets may be
// cached forever because a new build references new names.
package webui

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

//go:embed all:dist
var distFS embed.FS

// Handler serves the embedded build.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err) // embed layout is fixed at compile time
	}
	return handler(sub)
}

func handler(sub fs.FS) http.Handler {
	files := http.FileServerFS(sub)
	index, _ := fs.ReadFile(sub, "index.html")
	var indexETag string
	if index != nil {
		sum := sha256.Sum256(index)
		indexETag = `"` + hex.EncodeToString(sum[:8]) + `"`
	}
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-cache")
		h.Set("ETag", indexETag)
		h.Set("Content-Type", "text/html; charset=utf-8")
		// ServeContent answers If-None-Match with 304 for us.
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" && path != "index.html" {
			if f, err := sub.Open(path); err == nil {
				_ = f.Close()
				if strings.HasPrefix(path, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "no-cache")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback: unknown paths get index.html so client-side routes
		// survive a refresh.
		if index != nil {
			serveIndex(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("Stoop server is running. This build has no embedded web UI — run `make build` to embed it, or use the Vite dev server.\n"))
	})
}
