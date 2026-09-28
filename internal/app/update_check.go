package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/upgrade"
)

// The update check (docs/architecture/runtime.md → The update check).

const (
	releaseIndexURL = "https://getstoop.org/releases.json"
	updateTTL       = 6 * time.Hour
	updateRetry     = 15 * time.Minute
	updateTimeout   = 5 * time.Second
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
	latest string
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
		url:     releaseIndexURL,
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
		latest, err := c.fetch(ctx)
		if err != nil {
			c.log.Warn("update check failed", "url", c.url, "error", err)
			c.nextAt = c.now().Add(updateRetry)
		} else {
			c.latest = latest
			c.nextAt = c.now().Add(updateTTL)
		}
	}
	return instance.Update{Latest: c.latest, Available: c.latest != "" && upgrade.Older(c.current, c.latest)}
}

func (c *updateChecker) fetch(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "stoop")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var index struct {
		Latest string `json:"latest"`
	}
	if err := json.Unmarshal(body, &index); err != nil {
		return "", err
	}
	if !releaseVersionRE.MatchString(index.Latest) {
		return "", fmt.Errorf("latest is %q, not a release version", index.Latest)
	}
	return index.Latest, nil
}
