package diag

import (
	"testing"
)

func TestRegistrySnapshot(t *testing.T) {
	r := NewRegistry()
	c := r.Counter("bus_dropped_total", "Slow consumers dropped.")
	if r.Counter("bus_dropped_total", "") != c {
		t.Fatal("Counter should be idempotent by name")
	}
	c.Inc()
	c.Add(2)
	r.Counter("a_first", "")
	r.Gauge("z_gauge", "", func() float64 { return 4 })
	g := r.Gauge("connections", "Open sockets.", func() float64 { return 7 })
	if r.Gauge("connections", "", func() float64 { return 7 }) != g || g.Value() != 7 {
		t.Fatal("Gauge should be idempotent by name")
	}
	newSampler(r, nil).tick(r.Snapshot().At)

	s := r.Snapshot()
	if len(s.Counters) != 2 || s.Counters[0].Name != "a_first" || s.Counters[1].Value != 3 {
		t.Errorf("counters: %+v", s.Counters)
	}
	if len(s.Gauges) != 2 || s.Gauges[0].Name != "connections" || s.Gauges[0].Value != 7 {
		t.Errorf("gauges: %+v", s.Gauges)
	}
	if got := s.Gauges[0].Series; len(got) != 1 || got[0] != 7 {
		t.Errorf("series: %v", got)
	}
	if s.At.IsZero() || len(s.Procedures) != 0 {
		t.Errorf("At %v procedures %v", s.At, s.Procedures)
	}
}

func TestDefaultHelpers(t *testing.T) {
	if NewCounter("diag_test_counter", "") != Default.Counter("diag_test_counter", "") {
		t.Error("NewCounter should register on Default")
	}
	if NewGauge("diag_test_gauge", "", func() float64 { return 0 }) != Default.Gauge("diag_test_gauge", "", func() float64 { return 0 }) {
		t.Error("NewGauge should register on Default")
	}
	if NewJob("diag_test_job") != Default.Job("diag_test_job") {
		t.Error("NewJob should register on Default")
	}
	if RPC != Default.RPC() {
		t.Error("RPC should be Default's stats")
	}
}

func TestGaugeReregisterReplacesReader(t *testing.T) {
	r := NewRegistry()
	g := r.Gauge("connections", "", func() float64 { return 1 })
	newSampler(r, nil).tick(r.Snapshot().At)
	if r.Gauge("connections", "", func() float64 { return 2 }) != g {
		t.Fatal("re-registering should return the same gauge")
	}
	if g.Value() != 2 {
		t.Errorf("Value() = %v, want the second reader's 2", g.Value())
	}
	if s := g.Series(); len(s) != 1 || s[0] != 1 {
		t.Errorf("series %v, want the ring kept", s)
	}
}
