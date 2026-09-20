// Package diag holds the in-memory instruments behind the Diagnostics tab
// and GET /metrics: counters, sampled gauges, per-procedure timings and
// job records. Modules record into it the way they log into slog. The
// reasoning is in docs/proposals/diagnostics.md.
package diag

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// SeriesLen is how many gauge samples a ring keeps; with SampleStep that
// is fifteen minutes.
const SeriesLen = 90

// SampleStep is how often the sampler reads every gauge.
const SampleStep = 10 * time.Second

// Registry owns every instrument. It is safe for concurrent use.
type Registry struct {
	mu       sync.Mutex
	counters map[string]*Counter
	gauges   map[string]*Gauge
	jobs     map[string]*Job
	rpc      *RPCStats
}

// Default is the registry the package-level helpers use.
var Default = NewRegistry()

func NewRegistry() *Registry {
	return &Registry{
		counters: map[string]*Counter{},
		gauges:   map[string]*Gauge{},
		jobs:     map[string]*Job{},
		rpc:      NewRPCStats(),
	}
}

// RPC is the procedure stats this registry snapshots.
func (r *Registry) RPC() *RPCStats { return r.rpc }

// Counter is a monotonic count since start.
type Counter struct {
	name, help string
	n          atomic.Int64
}

// Counter returns the counter registered under name, creating it on
// first use.
func (r *Registry) Counter(name, help string) *Counter {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.counters[name]; ok {
		return c
	}
	c := &Counter{name: name, help: help}
	r.counters[name] = c
	return c
}

func (c *Counter) Inc()         { c.n.Add(1) }
func (c *Counter) Add(n int64)  { c.n.Add(n) }
func (c *Counter) Value() int64 { return c.n.Load() }

// Gauge is a read function plus the ring of samples the sampler took.
type Gauge struct {
	name, help string
	read       func() float64

	mu   sync.Mutex
	ring [SeriesLen]float64
	head int
	n    int
}

// Gauge returns the gauge registered under name, creating it on first use.
// Registering again replaces the read function (last wins) and keeps the ring.
func (r *Registry) Gauge(name, help string, read func() float64) *Gauge {
	r.mu.Lock()
	defer r.mu.Unlock()
	if g, ok := r.gauges[name]; ok {
		g.mu.Lock()
		g.read = read
		g.mu.Unlock()
		return g
	}
	g := &Gauge{name: name, help: help, read: read}
	r.gauges[name] = g
	return g
}

// Value reads the gauge now.
func (g *Gauge) Value() float64 { return g.reader()() }

func (g *Gauge) reader() func() float64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.read
}

// Series returns the sampled values, oldest first.
func (g *Gauge) Series() []float64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]float64, g.n)
	start := (g.head - g.n + SeriesLen) % SeriesLen
	for i := range g.n {
		out[i] = g.ring[(start+i)%SeriesLen]
	}
	return out
}

func (g *Gauge) sample() {
	v := g.Value()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.ring[g.head] = v
	g.head = (g.head + 1) % SeriesLen
	if g.n < SeriesLen {
		g.n++
	}
}

// NewCounter, NewGauge and NewJob register on Default, the way slog.Info
// logs to the default logger.
func NewCounter(name, help string) *Counter { return Default.Counter(name, help) }

func NewGauge(name, help string, read func() float64) *Gauge {
	return Default.Gauge(name, help, read)
}

func NewJob(name string) *Job { return Default.Job(name) }

type CounterSample struct {
	Name, Help string
	Value      int64
}

type GaugeSample struct {
	Name, Help string
	Value      float64
	Series     []float64
}

// Snapshot is everything the registry knows at one instant, sorted by
// name; Procedures are since start.
type Snapshot struct {
	At         time.Time
	Counters   []CounterSample
	Gauges     []GaugeSample
	Procedures []ProcedureStats
	Jobs       []JobRecord
}

func (r *Registry) Snapshot() Snapshot {
	r.mu.Lock()
	counters := make([]*Counter, 0, len(r.counters))
	for _, c := range r.counters {
		counters = append(counters, c)
	}
	gauges := make([]*Gauge, 0, len(r.gauges))
	for _, g := range r.gauges {
		gauges = append(gauges, g)
	}
	r.mu.Unlock()

	s := Snapshot{At: time.Now(), Procedures: r.rpc.Procedures(SinceStart), Jobs: r.Jobs()}
	for _, c := range counters {
		s.Counters = append(s.Counters, CounterSample{Name: c.name, Help: c.help, Value: c.Value()})
	}
	for _, g := range gauges {
		s.Gauges = append(s.Gauges, GaugeSample{Name: g.name, Help: g.help, Value: g.Value(), Series: g.Series()})
	}
	sort.Slice(s.Counters, func(i, j int) bool { return s.Counters[i].Name < s.Counters[j].Name })
	sort.Slice(s.Gauges, func(i, j int) bool { return s.Gauges[i].Name < s.Gauges[j].Name })
	return s
}

func (r *Registry) gaugeList() []*Gauge {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*Gauge, 0, len(r.gauges))
	for _, g := range r.gauges {
		out = append(out, g)
	}
	return out
}
