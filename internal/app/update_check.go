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

// A variable so a build can be pointed at another index with -X.
var releaseIndexURL = "https://getstoop.org/releases.json"

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
	index  releaseIndex
}

// releaseIndex is what the check reads of the file. Supported is the
// oldest release still supported; an index without one names none.
type releaseIndex struct {
	Latest    string `json:"latest"`
	Supported string `json:"supported"`
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
		Available: c.index.Latest != "" && upgrade.Older(c.current, c.index.Latest),
		Outdated:  c.index.Supported != "" && upgrade.Older(c.current, c.index.Supported),
	}
}

func (c *updateChecker) fetch(ctx context.Context) (releaseIndex, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return releaseIndex{}, err
	}
	req.Header.Set("User-Agent", "stoop")
	resp, err := c.client.Do(req)
	if err != nil {
		return releaseIndex{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return releaseIndex{}, fmt.Errorf("status %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return releaseIndex{}, err
	}
	var index releaseIndex
	if err := json.Unmarshal(body, &index); err != nil {
		return releaseIndex{}, err
	}
	if !releaseVersionRE.MatchString(index.Latest) {
		return releaseIndex{}, fmt.Errorf("latest is %q, not a release version", index.Latest)
	}
	if index.Supported != "" && !releaseVersionRE.MatchString(index.Supported) {
		return releaseIndex{}, fmt.Errorf("supported is %q, not a release version", index.Supported)
	}
	return index, nil
}
