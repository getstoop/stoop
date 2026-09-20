package diag

import (
	"testing"
	"time"
)

func TestSamplerFillsSeriesAndDropsOldest(t *testing.T) {
	r := NewRegistry()
	v := 0.0
	g := r.Gauge("connections", "", func() float64 { v++; return v })
	s := newSampler(r, nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range SeriesLen + 5 {
		s.tick(now.Add(time.Duration(i) * SampleStep))
	}
	series := g.Series()
	if len(series) != SeriesLen {
		t.Fatalf("series len %d, want %d", len(series), SeriesLen)
	}
	if series[0] != 6 || series[SeriesLen-1] != SeriesLen+5 {
		t.Errorf("series runs %v..%v, want 6..%d", series[0], series[SeriesLen-1], SeriesLen+5)
	}
}

func TestSamplerRotatesOncePerMinute(t *testing.T) {
	r := NewRegistry()
	s := newSampler(r, nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	r.RPC().Observe("/stoop.a.v1.A/Old", time.Millisecond, nil)
	inWindow := func() bool { return len(r.RPC().Procedures(Last5Minutes)) == 1 }

	// Six ticks in the first minute: no boundary, no rotation.
	for i := range 6 {
		s.tick(now.Add(time.Duration(i) * SampleStep))
	}
	// Five boundaries: still inside the ring.
	for m := 1; m <= 5; m++ {
		s.tick(now.Add(time.Duration(m)*time.Minute + 3*time.Second))
		s.tick(now.Add(time.Duration(m)*time.Minute + 30*time.Second))
	}
	if !inWindow() {
		t.Fatal("five minute boundaries should not evict the observation")
	}
	s.tick(now.Add(6*time.Minute + 3*time.Second))
	if inWindow() {
		t.Fatal("the sixth boundary should evict the observation")
	}
}

func TestSamplerRotatesForEachSkippedMinute(t *testing.T) {
	r := NewRegistry()
	s := newSampler(r, nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.tick(now)
	r.RPC().Observe("/stoop.a.v1.A/Old", time.Millisecond, nil)
	s.tick(now.Add(time.Hour))
	if len(r.RPC().Procedures(Last5Minutes)) != 0 {
		t.Error("an hour's gap should clear the window")
	}
}

func TestSamplerIgnoresClockStepBack(t *testing.T) {
	r := NewRegistry()
	s := newSampler(r, nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.tick(now)
	r.RPC().Observe("/stoop.a.v1.A/Old", time.Millisecond, nil)
	inWindow := func() bool { return len(r.RPC().Procedures(Last5Minutes)) == 1 }

	s.tick(now.Add(-time.Hour))
	if !inWindow() {
		t.Fatal("a clock step back should not rotate")
	}
	s.tick(now.Add(59 * time.Second))
	if !inWindow() {
		t.Fatal("59 s elapsed should not rotate")
	}
	// Each 61 s tick is one rotation: five keep the observation, the sixth evicts it.
	for m := 1; m <= 5; m++ {
		s.tick(now.Add(time.Duration(m) * 61 * time.Second))
	}
	if !inWindow() {
		t.Fatal("five single rotations should keep the observation")
	}
	s.tick(now.Add(6 * 61 * time.Second))
	if inWindow() {
		t.Fatal("the sixth rotation should evict the observation")
	}
}
