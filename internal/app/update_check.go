package app

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/release"
)

// The update check (docs/architecture/runtime.md → The update check).

const (
	updateTTL     = 6 * time.Hour
	updateRetry   = 15 * time.Minute
	updateTimeout = 5 * time.Second
)

var releaseVersionRE = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

type updateChecker struct {
	current string
	url     string
	client  *http.Client
	log     *slog.Logger
	now     func() time.Time

	mu     sync.Mutex
	nextAt time.Time
	index  release.Index
}

// newUpdateChecker returns nil for a build that is not a release: there
// is nothing to compare, so nothing is fetched.
func newUpdateChecker(version string, log *slog.Logger) *updateChecker {
	current := strings.TrimPrefix(version, "v")
	if !releaseVersionRE.MatchString(current) {
		return nil
	}
	return &updateChecker{
		current: current,
		url:     release.IndexURL,
		client:  &http.Client{Timeout: updateTimeout},
		log:     log,
		now:     time.Now,
	}
}

// LatestRelease reads the index when the last answer is stale. A failed
// read keeps the last answer.
func (c *updateChecker) LatestRelease(ctx context.Context) instance.Update {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.now().Before(c.nextAt) {
		index, err := c.fetch(ctx)
		if err != nil {
			c.log.Warn("update check failed", "url", c.url, "error", err)
			c.nextAt = c.now().Add(updateRetry)
		} else {
			c.index = index
			c.nextAt = c.now().Add(updateTTL)
		}
	}
	return instance.Update{
		Latest:    c.index.Latest,
		Available: c.index.Latest != "" && release.Older(c.current, c.index.Latest),
		Outdated:  c.index.Supported != "" && release.Older(c.current, c.index.Supported),
	}
}

func (c *updateChecker) fetch(ctx context.Context) (release.Index, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return release.Index{}, err
	}
	req.Header.Set("User-Agent", "stoop")
	resp, err := c.client.Do(req)
	if err != nil {
		return release.Index{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return release.Index{}, fmt.Errorf("status %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return release.Index{}, err
	}
	index, err := release.ParseIndex(body)
	if err != nil {
		return release.Index{}, err
	}
	if !releaseVersionRE.MatchString(index.Latest) {
		return release.Index{}, fmt.Errorf("latest is %q, not a release version", index.Latest)
	}
	if index.Supported != "" && !releaseVersionRE.MatchString(index.Supported) {
		return release.Index{}, fmt.Errorf("supported is %q, not a release version", index.Supported)
	}
	return index, nil
}
