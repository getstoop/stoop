package diag

import (
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// bounds are the bucket upper limits: twenty roughly log-spaced steps from
// 1 ms to 10 s, rounded so they print cleanly, then +Inf.
var bounds = [numBounds]time.Duration{
	1 * time.Millisecond, 1600 * time.Microsecond, 2600 * time.Microsecond,
	4300 * time.Microsecond, 7 * time.Millisecond, 11 * time.Millisecond,
	18 * time.Millisecond, 30 * time.Millisecond, 48 * time.Millisecond,
	78 * time.Millisecond, 130 * time.Millisecond, 210 * time.Millisecond,
	340 * time.Millisecond, 550 * time.Millisecond, 890 * time.Millisecond,
	1400 * time.Millisecond, 2300 * time.Millisecond, 3800 * time.Millisecond,
	6200 * time.Millisecond, 10 * time.Second,
}

const (
	numBounds  = 20
	numBuckets = numBounds + 1
)

// InfBucket is the Le of the last bucket, which holds everything above 10 s.
const InfBucket = time.Duration(math.MaxInt64)

// Histogram counts durations in fixed buckets. Its memory never grows.
type Histogram struct {
	counts [numBuckets]atomic.Uint64
	sum    atomic.Int64
	max    atomic.Int64
}

// Bucket is one cumulative bucket: how many observations were <= Le.
type Bucket struct {
	Le    time.Duration
	Count uint64
}

func bucketOf(d time.Duration) int {
	for i, b := range bounds {
		if d <= b {
			return i
		}
	}
	return numBounds
}

func (h *Histogram) Observe(d time.Duration) {
	h.counts[bucketOf(d)].Add(1)
	h.sum.Add(int64(d))
	for {
		cur := h.max.Load()
		if int64(d) <= cur || h.max.CompareAndSwap(cur, int64(d)) {
			return
		}
	}
}

func (h *Histogram) Count() uint64 {
	var n uint64
	for i := range h.counts {
		n += h.counts[i].Load()
	}
	return n
}

func (h *Histogram) Sum() time.Duration { return time.Duration(h.sum.Load()) }

// Max is exact; it is tracked beside the buckets.
func (h *Histogram) Max() time.Duration { return time.Duration(h.max.Load()) }

// Percentile estimates the p-th percentile (p in (0,1]) from the buckets,
// linear within a bucket and never above Max.
func (h *Histogram) Percentile(p float64) time.Duration {
	total := h.Count()
	if total == 0 || p <= 0 {
		return 0
	}
	if p > 1 {
		p = 1
	}
	target := uint64(math.Ceil(p * float64(total)))
	var before uint64
	for i := range numBounds {
		c := h.counts[i].Load()
		if before+c >= target {
			lo := time.Duration(0)
			if i > 0 {
				lo = bounds[i-1]
			}
			frac := float64(target-before) / float64(c)
			est := lo + time.Duration(frac*float64(bounds[i]-lo))
			return min(est, h.Max())
		}
		before += c
	}
	return h.Max()
}

// Buckets returns the cumulative counts, the last with Le == InfBucket.
func (h *Histogram) Buckets() []Bucket {
	out := make([]Bucket, numBuckets)
	var cum uint64
	for i := range numBuckets {
		cum += h.counts[i].Load()
		le := InfBucket
		if i < numBounds {
			le = bounds[i]
		}
		out[i] = Bucket{Le: le, Count: cum}
	}
	return out
}

// Merge returns a new histogram holding h plus the others.
func (h *Histogram) Merge(others ...*Histogram) *Histogram {
	m := &Histogram{}
	m.add(h)
	for _, o := range others {
		m.add(o)
	}
	return m
}

func (h *Histogram) add(o *Histogram) {
	for i := range numBuckets {
		h.counts[i].Add(o.counts[i].Load())
	}
	h.sum.Add(o.sum.Load())
	if m := o.max.Load(); m > h.max.Load() {
		h.max.Store(m)
	}
}

func (h *Histogram) reset() {
	for i := range numBuckets {
		h.counts[i].Store(0)
	}
	h.sum.Store(0)
	h.max.Store(0)
}

// minuteRing is how many one-minute histograms Timings keeps: the current
// minute plus five complete ones.
const minuteRing = 6

// Timings is a since-start histogram beside a ring of one-minute ones.
// The zero value is ready to use.
type Timings struct {
	mu      sync.RWMutex
	all     Histogram
	minutes [minuteRing]Histogram
	cur     int
}

func (t *Timings) Observe(d time.Duration) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	t.all.Observe(d)
	t.minutes[t.cur].Observe(d)
}

// Rotate starts a new current minute, reusing the oldest slot.
func (t *Timings) Rotate() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cur = (t.cur + 1) % minuteRing
	t.minutes[t.cur].reset()
}

// Last5 merges the current minute with the five complete ones before it.
func (t *Timings) Last5() *Histogram {
	t.mu.RLock()
	defer t.mu.RUnlock()
	m := &Histogram{}
	for i := range t.minutes {
		m.add(&t.minutes[i])
	}
	return m
}

// SinceStart returns a copy of the histogram that never rotates.
func (t *Timings) SinceStart() *Histogram { return t.all.Merge() }
