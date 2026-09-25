package upgrade

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Fetcher gets a URL; the tests use a map.
type Fetcher interface {
	Fetch(ctx context.Context, url string) ([]byte, error)
}

// HTTPFetcher is the real one.
type HTTPFetcher struct {
	Client *http.Client
}

func (f HTTPFetcher) Fetch(ctx context.Context, url string) ([]byte, error) {
	client := f.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
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

// latestVersion asks the releases API for the newest tag, without the v.
func (u *Upgrader) latestVersion(ctx context.Context) (string, error) {
	body, err := u.Fetch.Fetch(ctx, u.API)
	if err != nil {
		return "", fmt.Errorf("could not read the latest release: %w", err)
	}
	var release struct {
		Tag string `json:"tag_name"`
	}
	if err := json.Unmarshal(body, &release); err != nil || release.Tag == "" {
		return "", fmt.Errorf("could not read the latest release from %s", u.API)
	}
	return strings.TrimPrefix(release.Tag, "v"), nil
}
