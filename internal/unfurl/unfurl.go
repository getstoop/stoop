// Package unfurl fetches link previews (Open Graph / HTML metadata) for
// URLs posted in messages. The server fetches so that readers' browsers
// never contact the linked site — but that makes Stoop a proxy that will
// request arbitrary URLs on behalf of any member, so the fetcher refuses
// anything that isn't a public http(s) address: private, loopback,
// link-local and multicast ranges are rejected at connect time (after DNS,
// so a rebinding name can't slip through), redirects are re-checked hop by
// hop, and bodies are capped.
package unfurl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/getstoop/stoop/internal/netguard"
)

// Preview is what a URL unfurled to. Image is the raw bytes of the page's
// preview image, if it had one we could fetch; callers store it.
type Preview struct {
	Title       string
	Description string
	SiteName    string
	Image       []byte
}

const (
	maxHTMLBytes  = 1 << 20 // 1 MB of HTML is plenty to find <head>
	maxImageBytes = 5 << 20
	maxRedirects  = 5
	userAgent     = "Mozilla/5.0 (compatible; Stoop link preview; +https://github.com/getstoop/stoop)"
)

var (
	ErrNotPublic  = netguard.ErrNotPublic
	ErrBadScheme  = netguard.ErrBadScheme
	ErrNotHTML    = errors.New("not an HTML page or image")
	ErrTooLarge   = errors.New("response too large")
	ErrBadStatus  = errors.New("unexpected HTTP status")
	errNoMetadata = errors.New("page has no title")
)

type Options struct {
	// AllowPrivate disables the public-address check. Dev and tests only.
	AllowPrivate bool
	Timeout      time.Duration
}

type Fetcher struct {
	client *http.Client
	opts   Options
}

func New(opts Options) *Fetcher {
	if opts.Timeout == 0 {
		opts.Timeout = 10 * time.Second
	}
	// The guard resolves once and dials what it checked (internal/netguard).
	transport := netguard.Policy{AllowPrivate: opts.AllowPrivate}.Transport()
	client := &http.Client{
		Transport: transport,
		Timeout:   opts.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			return checkURL(req.URL)
		},
	}
	return &Fetcher{client: client, opts: opts}
}

func checkURL(u *url.URL) error { return netguard.CheckURL(u) }

// Fetch unfurls one URL. A direct image URL becomes a preview with only an
// image; an HTML page yields its metadata and, when it names one, its
// preview image.
func (f *Fetcher) Fetch(ctx context.Context, raw string) (Preview, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return Preview{}, err
	}
	if err := checkURL(u); err != nil {
		return Preview{}, err
	}
	body, ctype, finalURL, err := f.get(ctx, u.String(), "text/html, application/xhtml+xml, image/*;q=0.8")
	if err != nil {
		return Preview{}, err
	}
	if strings.HasPrefix(ctype, "image/") {
		if len(body) == 0 {
			return Preview{}, ErrNotHTML
		}
		return Preview{Image: body}, nil
	}
	if !strings.HasPrefix(ctype, "text/html") && !strings.HasPrefix(ctype, "application/xhtml") {
		return Preview{}, ErrNotHTML
	}
	p, imageURL := parseHTML(body)
	if p.Title == "" {
		return Preview{}, errNoMetadata
	}
	if imageURL != "" {
		if abs, err := finalURL.Parse(imageURL); err == nil && checkURL(abs) == nil {
			if img, ictype, _, err := f.get(ctx, abs.String(), "image/*"); err == nil && strings.HasPrefix(ictype, "image/") {
				p.Image = img
			}
		}
	}
	return p, nil
}

// get performs a guarded GET. The body cap depends on what the server
// says it is sending: an image may run to maxImageBytes, anything else
// to maxHTMLBytes.
func (f *Fetcher) get(ctx context.Context, raw string, accept string) ([]byte, string, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, "", nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, "", nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, "", nil, fmt.Errorf("%w: %s", ErrBadStatus, resp.Status)
	}
	ctype := strings.ToLower(strings.TrimSpace(strings.SplitN(resp.Header.Get("Content-Type"), ";", 2)[0]))
	limit := int64(maxHTMLBytes)
	if strings.HasPrefix(ctype, "image/") {
		limit = maxImageBytes
	}
	if resp.ContentLength > limit {
		return nil, "", nil, ErrTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", nil, err
	}
	if int64(len(body)) > limit {
		return nil, "", nil, ErrTooLarge
	}
	if ctype == "" || ctype == "application/octet-stream" {
		ctype = http.DetectContentType(body)
	}
	return body, ctype, resp.Request.URL, nil
}

// parseHTML pulls Open Graph / Twitter / plain HTML metadata out of a page.
// Open Graph wins, then Twitter cards, then <title> and <meta description>.
func parseHTML(body []byte) (Preview, string) {
	var p Preview
	var imageURL string
	og := map[string]string{}
	tw := map[string]string{}
	var title, description string
	tok := html.NewTokenizer(bytes.NewReader(body))
	inTitle := false
	for {
		tt := tok.Next()
		switch tt {
		case html.ErrorToken:
			goto done
		case html.StartTagToken, html.SelfClosingTagToken:
			t := tok.Token()
			switch t.DataAtom.String() {
			case "meta":
				var prop, name, content string
				for _, a := range t.Attr {
					switch strings.ToLower(a.Key) {
					case "property":
						prop = strings.ToLower(a.Val)
					case "name":
						name = strings.ToLower(a.Val)
					case "content":
						content = strings.TrimSpace(a.Val)
					}
				}
				if content == "" {
					continue
				}
				switch {
				case strings.HasPrefix(prop, "og:"):
					if _, seen := og[prop]; !seen {
						og[prop] = content
					}
				case strings.HasPrefix(name, "twitter:"):
					if _, seen := tw[name]; !seen {
						tw[name] = content
					}
				case name == "description" && description == "":
					description = content
				}
			case "title":
				inTitle = true
			case "body":
				// Metadata lives in <head>; stop before wading through the page.
				goto done
			}
		case html.TextToken:
			if inTitle && title == "" {
				title = strings.TrimSpace(string(tok.Text()))
			}
		case html.EndTagToken:
			if tok.Token().DataAtom.String() == "title" {
				inTitle = false
			}
		}
	}
done:
	pick := func(keys ...string) string {
		for _, k := range keys {
			if v := og[k]; v != "" {
				return v
			}
			if v := tw[k]; v != "" {
				return v
			}
		}
		return ""
	}
	p.Title = firstNonEmpty(pick("og:title", "twitter:title"), title)
	p.Description = firstNonEmpty(pick("og:description", "twitter:description"), description)
	p.SiteName = pick("og:site_name")
	imageURL = pick("og:image", "og:image:url", "og:image:secure_url", "twitter:image")
	p.Title = clip(html.UnescapeString(p.Title), 200)
	p.Description = clip(html.UnescapeString(p.Description), 500)
	p.SiteName = clip(html.UnescapeString(p.SiteName), 100)
	return p, imageURL
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
