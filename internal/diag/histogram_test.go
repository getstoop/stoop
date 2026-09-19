package diag

import (
	"testing"
	"time"
)

func TestHistogramBuckets(t *testing.T) {
	cases := []struct {
		d    time.Duration
		want int
	}{
		{0, 0},
		{time.Millisecond, 0},
		{time.Millisecond + 1, 1},
		{5 * time.Millisecond, 4},
		{10 * time.Second, numBounds - 1},
		{10*time.Second + 1, numBounds},
		{time.Hour, numBounds},
	}
	for _, c := range cases {
		if got := bucketOf(c.d); got != c.want {
			t.Errorf("bucketOf(%v) = %d, want %d", c.d, got, c.want)
		}
	}
	var h Histogram
	for _, c := range cases {
		h.Observe(c.d)
	}
	bks := h.Buckets()
	if len(bks) != numBuckets || bks[numBuckets-1].Le != InfBucket {
		t.Fatalf("Buckets: len %d, last Le %v", len(bks), bks[numBuckets-1].Le)
	}
	if bks[0].Count != 2 || bks[1].Count != 3 || bks[numBounds-1].Count != 5 || bks[numBounds].Count != 7 {
		t.Errorf("cumulative counts wrong: %+v", bks)
	}
	if h.Count() != 7 || h.Max() != time.Hour {
		t.Errorf("Count %d Max %v", h.Count(), h.Max())
	}
}

func TestHistogramPercentile(t *testing.T) {
	var h Histogram
	for ms := 1; ms <= 1000; ms++ {
		h.Observe(time.Duration(ms) * time.Millisecond)
	}
	cases := []struct {
		p    float64
		want time.Duration
	}{
		{0.5, 500 * time.Millisecond},
		{0.95, 950 * time.Millisecond},
		{1, 1000 * time.Millisecond},
	}
	for _, c := range cases {
		got := h.Percentile(c.p)
		i := bucketOf(c.want)
		width := bounds[i]
		if i > 0 {
			width -= bounds[i-1]
		}
		diff := max(got-c.want, c.want-got)
		if diff > width {
			t.Errorf("P%v = %v, want within %v of %v", c.p*100, got, width, c.want)
		}
	}
	if got := h.Percentile(1); got > h.Max() {
		t.Errorf("P100 %v exceeds Max %v", got, h.Max())
	}
	var empty Histogram
	if empty.Percentile(0.5) != 0 || h.Percentile(0) != 0 {
		t.Error("empty histogram or p=0 should give 0")
	}
}

func TestHistogramMaxIsExact(t *testing.T) {
	var h Histogram
	for _, d := range []time.Duration{3 * time.Millisecond, 1234567 * time.Nanosecond, 2 * time.Millisecond} {
		h.Observe(d)
	}
	if h.Max() != 3*time.Millisecond {
		t.Errorf("Max = %v", h.Max())
	}
	if h.Sum() != 6234567*time.Nanosecond {
		t.Errorf("Sum = %v", h.Sum())
	}
}

func TestHistogramMerge(t *testing.T) {
	var a, b Histogram
	a.Observe(time.Millisecond)
	a.Observe(time.Second)
	b.Observe(time.Millisecond)
	b.Observe(5 * time.Second)
	m := a.Merge(&b)
	if m.Count() != 4 || m.Max() != 5*time.Second || m.Sum() != 6*time.Second+2*time.Millisecond {
		t.Errorf("merged: count %d max %v sum %v", m.Count(), m.Max(), m.Sum())
	}
	if m.Buckets()[0].Count != 2 {
		t.Errorf("first bucket = %d, want 2", m.Buckets()[0].Count)
	}
	if a.Count() != 2 {
		t.Error("Merge must not change its receiver")
	}
}

func TestTimingsRotate(t *testing.T) {
	var tm Timings
	tm.Observe(time.Second)
	for range 5 {
		tm.Rotate()
	}
	if tm.Last5().Count() != 1 {
		t.Fatal("five rotations should keep the observation in Last5")
	}
	tm.Observe(2 * time.Second)
	for range 2 {
		tm.Rotate()
	}
	last5 := tm.Last5()
	if last5.Count() != 1 || last5.Max() != 2*time.Second {
		t.Errorf("Last5 after seven rotations: count %d max %v", last5.Count(), last5.Max())
	}
	all := tm.SinceStart()
	if all.Count() != 2 || all.Max() != 2*time.Second {
		t.Errorf("SinceStart: count %d max %v", all.Count(), all.Max())
	}
}
