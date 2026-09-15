package unfurl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseHTML(t *testing.T) {
	page := `<html><head><title>Fallback title</title>
<meta name="description" content="fallback desc">
<meta property="og:title" content="OG &amp; title">
<meta property="og:description" content="  og   desc  ">
<meta property="og:site_name" content="Example">
<meta property="og:image" content="/img.png">
<meta property="og:title" content="second wins? no">
</head><body><meta property="og:title" content="body meta ignored"></body></html>`
	p, img := parseHTML([]byte(page))
	if p.Title != "OG & title" || p.Description != "og desc" || p.SiteName != "Example" || img != "/img.png" {
		t.Errorf("parsed = %+v img=%q", p, img)
	}
	p, _ = parseHTML([]byte(`<html><head><title>Just a title</title><meta name="description" content="d"></head></html>`))
	if p.Title != "Just a title" || p.Description != "d" {
		t.Errorf("fallbacks = %+v", p)
	}
	long := strings.Repeat("x", 300)
	p, _ = parseHTML([]byte(`<title>` + long + `</title>`))
	if len([]rune(p.Title)) != 200 || !strings.HasSuffix(p.Title, "…") {
		t.Errorf("title not clipped: %d", len(p.Title))
	}
}

func TestFetch_LocalServerRefusedUnlessAllowed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nfake"))
		case "/redirect":
			http.Redirect(w, r, "/page", http.StatusFound)
		case "/big":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<title>big</title>" + strings.Repeat("a", maxHTMLBytes+10)))
		case "/big.gif":
			w.Header().Set("Content-Type", "image/gif")
			_, _ = w.Write([]byte("GIF89a" + strings.Repeat("a", maxHTMLBytes+10)))
		case "/huge.gif":
			w.Header().Set("Content-Type", "image/gif")
			_, _ = w.Write([]byte("GIF89a" + strings.Repeat("a", maxImageBytes+10)))
		default:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><title>T</title><meta property="og:description" content="D"><meta property="og:image" content="/img.png"></head><body>hi</body></html>`))
		}
	}))
	defer srv.Close()
	ctx := context.Background()

	// The default fetcher must refuse loopback — that's the SSRF guard.
	if _, err := New(Options{}).Fetch(ctx, srv.URL+"/page"); !errors.Is(err, ErrNotPublic) {
		t.Fatalf("loopback fetch should be refused, got %v", err)
	}
	if _, err := New(Options{}).Fetch(ctx, "ftp://example.com/x"); !errors.Is(err, ErrBadScheme) {
		t.Errorf("ftp should be refused, got %v", err)
	}
	if _, err := New(Options{}).Fetch(ctx, "http://user:pw@example.com/"); !errors.Is(err, ErrBadScheme) {
		t.Errorf("userinfo should be refused, got %v", err)
	}

	f := New(Options{AllowPrivate: true})
	p, err := f.Fetch(ctx, srv.URL+"/page")
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "T" || p.Description != "D" || len(p.Image) == 0 {
		t.Errorf("preview = %+v", p)
	}
	if p, err := f.Fetch(ctx, srv.URL+"/redirect"); err != nil || p.Title != "T" {
		t.Errorf("redirect: %v %+v", err, p)
	}
	if p, err := f.Fetch(ctx, srv.URL+"/img.png"); err != nil || len(p.Image) == 0 || p.Title != "" {
		t.Errorf("direct image: %v %+v", err, p)
	}
	if _, err := f.Fetch(ctx, srv.URL+"/big"); !errors.Is(err, ErrTooLarge) {
		t.Errorf("oversize page should be refused, got %v", err)
	}
	// A direct image gets the image cap, not the page cap.
	if p, err := f.Fetch(ctx, srv.URL+"/big.gif"); err != nil || len(p.Image) <= maxHTMLBytes {
		t.Errorf("image over the page cap: %v, %d bytes", err, len(p.Image))
	}
	if _, err := f.Fetch(ctx, srv.URL+"/huge.gif"); !errors.Is(err, ErrTooLarge) {
		t.Errorf("oversize image should be refused, got %v", err)
	}
}
