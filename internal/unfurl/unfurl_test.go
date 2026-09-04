package unfurl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestIsPublic(t *testing.T) {
	for _, tc := range []struct {
		ip     string
		public bool
	}{
		{"8.8.8.8", true}, {"2606:4700::1111", true},
		{"127.0.0.1", false}, {"10.1.2.3", false}, {"192.168.2.134", false}, {"172.16.5.5", false},
		{"169.254.169.254", false}, {"100.65.98.12", false}, {"::1", false}, {"fe80::1", false},
		{"fd00::1", false}, {"224.0.0.1", false}, {"0.0.0.0", false}, {"::ffff:10.0.0.1", false},
	} {
		if got := isPublic(netip.MustParseAddr(tc.ip)); got != tc.public {
			t.Errorf("isPublic(%s) = %v, want %v", tc.ip, got, tc.public)
		}
	}
}

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
}
