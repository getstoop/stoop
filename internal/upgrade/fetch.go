package upgrade

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/getstoop/stoop/internal/release"
)

// Fetcher gets a URL; the tests use a map.
type Fetcher interface {
	Fetch(ctx context.Context, url string) ([]byte, error)
}

// HTTPFetcher is the real one.
type HTTPFetcher struct{}

func (f HTTPFetcher) Fetch(ctx context.Context, url string) ([]byte, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "stoop-upgrade")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 8<<20))
}

// release reads the index and returns the version asked for ("" is the
// latest) with where each of its files is.
func (u *Upgrader) release(ctx context.Context, version string) (string, map[string]string, error) {
	body, err := u.Fetch.Fetch(ctx, u.Index)
	if err != nil {
		return "", nil, fmt.Errorf("could not read the release index: %w", err)
	}
	idx, err := release.ParseIndex(body)
	if err != nil {
		return "", nil, fmt.Errorf("could not read the release index at %s: %w", u.Index, err)
	}
	if version == "" {
		version = idx.Latest
	}
	version = strings.TrimPrefix(version, "v")
	if version == "" {
		return "", nil, fmt.Errorf("the release index at %s names no latest release", u.Index)
	}
	for _, r := range idx.Releases {
		if r.Version == version {
			return version, r.Files, nil
		}
	}
	return "", nil, fmt.Errorf("no release %s in %s", version, u.Index)
}

// fetchFile gets one file of a release. The index is read over HTTPS and
// so is everything it points at.
func (u *Upgrader) fetchFile(ctx context.Context, files map[string]string, name string) ([]byte, error) {
	url, ok := files[name]
	if !ok {
		return nil, fmt.Errorf("the release has no %s", name)
	}
	if !strings.HasPrefix(url, "https://") {
		return nil, fmt.Errorf("%s is not an https address", url)
	}
	return u.Fetch.Fetch(ctx, url)
}
