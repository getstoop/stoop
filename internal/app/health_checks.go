package app

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/voice"
)

// The Health panel's checks that need more than one module to answer.
// Thresholds are the table in docs/proposals/diagnostics.md.

const (
	pingDanger    = 2 * time.Second
	waitsWindow   = time.Minute
	volumeWarn    = 0.85
	volumeDanger  = 0.95
	quotaWarn     = 0.90
	storageFixTab = "storage"
)

// ---- postgres ----

type postgresCheck struct {
	pool    *pgxpool.Pool
	started time.Time

	mu         sync.Mutex
	lastWaits  int64
	sampled    bool
	lastGrowth time.Time
}

func newPostgresCheck(pool *pgxpool.Pool, started time.Time) instance.HealthCheck {
	c := &postgresCheck{pool: pool, started: started}
	return instance.HealthCheck{Name: "postgres", Run: c.run}
}

func (c *postgresCheck) run(ctx context.Context) (instance.CheckState, string) {
	ctx, cancel := context.WithTimeout(ctx, pingDanger)
	defer cancel()
	start := time.Now()
	err := c.pool.Ping(ctx)
	took := time.Since(start)
	st := c.pool.Stat()
	waited := c.waitsGrew(st.EmptyAcquireCount(), time.Now())
	return postgresState(err, took, st.AcquiredConns(), st.MaxConns(), waited)
}

// waitsGrew reports whether the pool ran empty within the last minute.
// The counter is cumulative since start, so the first sample only sets
// the baseline, and the first minute is ignored: every loop opens a
// connection at boot, and that burst is not a saturated pool.
func (c *postgresCheck) waitsGrew(waits int64, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sampled && waits > c.lastWaits && now.Sub(c.started) >= waitsWindow {
		c.lastGrowth = now
	}
	c.lastWaits, c.sampled = waits, true
	return !c.lastGrowth.IsZero() && now.Sub(c.lastGrowth) < waitsWindow
}

func postgresState(pingErr error, ping time.Duration, acquired, maxConns int32, waited bool) (instance.CheckState, string) {
	if pingErr != nil {
		return instance.CheckDanger, "ping failed: " + pingErr.Error()
	}
	detail := fmt.Sprintf("ping %s · pool %d of %d in use", shortDuration(ping), acquired, maxConns)
	switch {
	case ping >= pingDanger:
		return instance.CheckDanger, detail
	case waited:
		return instance.CheckWarn, detail + " · acquire waits in the last minute"
	case maxConns > 0 && acquired >= maxConns:
		return instance.CheckWarn, detail + " · pool at max"
	}
	return instance.CheckOK, detail
}

func shortDuration(d time.Duration) string {
	switch {
	case d < time.Millisecond:
		return fmt.Sprintf("%d µs", d.Microseconds())
	case d < time.Second:
		return fmt.Sprintf("%.1f ms", float64(d.Microseconds())/1000)
	}
	return fmt.Sprintf("%.1f s", d.Seconds())
}

// ---- livekit ----

func newLiveKitCheck(opts voice.Options, r *liveKitReporter) instance.HealthCheck {
	return instance.HealthCheck{Name: "livekit", FixTab: "hosting", Run: func(ctx context.Context) (instance.CheckState, string) {
		if !opts.Enabled() {
			return instance.CheckOff, "not configured"
		}
		if r.reachable(ctx) {
			return instance.CheckOK, r.url
		}
		return instance.CheckDanger, r.url + " is not answering"
	}}
}

// ---- storage ----

type storageCheck struct {
	root  string
	usage func(ctx context.Context) (files.Usage, error)
}

func newStorageCheck(root string, fs *files.Service) instance.HealthCheck {
	c := &storageCheck{root: root, usage: fs.StorageUsage}
	return instance.HealthCheck{Name: "storage", FixTab: storageFixTab, Run: c.run}
}

func (c *storageCheck) run(ctx context.Context) (instance.CheckState, string) {
	u, err := c.usage(ctx)
	if err != nil {
		return instance.CheckDanger, err.Error()
	}
	total, free, spaceErr := diskSpace(c.root)
	return storageState(c.root, writeProbe(c.root), total, free, spaceErr, u.Bytes, u.Quota)
}

// writeProbe creates and removes a file in the upload directory, which is
// the question uploads ask.
func writeProbe(root string) error {
	f, err := os.CreateTemp(root, ".probe-*")
	if err != nil {
		return err
	}
	name := f.Name()
	_, werr := f.WriteString("ok")
	cerr := f.Close()
	rerr := os.Remove(name)
	for _, e := range []error{werr, cerr, rerr} {
		if e != nil {
			return e
		}
	}
	return nil
}

func storageState(root string, probeErr error, total, free int64, spaceErr error, used, quota int64) (instance.CheckState, string) {
	if probeErr != nil {
		return instance.CheckDanger, root + " not writable: " + probeErr.Error()
	}
	state := instance.CheckOK
	detail := root + " writable"
	if spaceErr != nil || total <= 0 {
		detail += " · free space not available"
	} else {
		detail += fmt.Sprintf(" · %s free of %s", files.FormatBytes(free), files.FormatBytes(total))
		full := 1 - float64(free)/float64(total)
		switch {
		case full >= volumeDanger:
			state = instance.CheckDanger
		case full >= volumeWarn:
			state = instance.CheckWarn
		}
	}
	if quota > 0 {
		detail += fmt.Sprintf(" · %s used of %s quota", files.FormatBytes(used), files.FormatBytes(quota))
		if state == instance.CheckOK && float64(used)/float64(quota) >= quotaWarn {
			state = instance.CheckWarn
		}
	}
	return state, detail
}
