package webui

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// DevProxy serves the web app from a running Vite dev server instead of
// the embedded build, so the one origin that carries the API also carries
// the live source with hot reload — for a browser, the desktop shell and
// a phone alike. Development only; `make dev` turns it on.
func DevProxy(target string) (http.Handler, error) {
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("must look like http://localhost:5173 (got %q)", target)
	}
	return &httputil.ReverseProxy{
		// SetURL also sends Vite the target's own Host: it refuses hosts
		// it does not know, and a phone on the LAN asks by IP.
		Rewrite: func(r *httputil.ProxyRequest) { r.SetURL(u) },
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, "The Vite dev server at %s is not answering (%v). Is `pnpm dev` running under web/?\n", target, err)
		},
	}, nil
}
