package diag

import (
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
)

// Window selects which histogram a stats read comes from.
type Window int

const (
	Last5Minutes Window = iota
	SinceStart
)

// ProcedureStats is one row of the Requests panel. Buckets and Sum feed
// the Prometheus histogram.
type ProcedureStats struct {
	Procedure     string
	Calls, Errors int64
	P50, P95, Max time.Duration
	Sum           time.Duration
	Buckets       []Bucket
}

// RPCStats keeps per-procedure timings and error counts.
type RPCStats struct {
	mu     sync.RWMutex
	procs  map[string]*procedure
	calls  atomic.Int64
	errors atomic.Int64
}

type procedure struct {
	name  string
	calls Timings
	errs  Timings
}

func NewRPCStats() *RPCStats {
	return &RPCStats{procs: map[string]*procedure{}}
}

// RPC is what the interceptor records into.
var RPC = Default.RPC()

// procedureName turns "/stoop.chat.v1.ChatService/ListMessages" into
// "ChatService.ListMessages".
func procedureName(full string) string {
	full = strings.TrimPrefix(full, "/")
	service, method, _ := strings.Cut(full, "/")
	if i := strings.LastIndexByte(service, '.'); i >= 0 {
		service = service[i+1:]
	}
	if method == "" {
		return service
	}
	return service + "." + method
}

func (s *RPCStats) lookup(full string) *procedure {
	s.mu.RLock()
	p, ok := s.procs[full]
	s.mu.RUnlock()
	if ok {
		return p
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok = s.procs[full]; ok {
		return p
	}
	p = &procedure{name: procedureName(full)}
	s.procs[full] = p
	return p
}

// countsAsError reports whether err belongs on the Errors column: any
// error except a connect Canceled.
func countsAsError(err error) bool {
	return err != nil && connect.CodeOf(err) != connect.CodeCanceled
}

// Observe records one call to the full procedure path. It does not
// allocate after the first call for a procedure.
func (s *RPCStats) Observe(full string, d time.Duration, err error) {
	p := s.lookup(full)
	p.calls.Observe(d)
	s.calls.Add(1)
	if countsAsError(err) {
		p.errs.Observe(d)
		s.errors.Add(1)
	}
}

func (s *RPCStats) CallsTotal() int64  { return s.calls.Load() }
func (s *RPCStats) ErrorsTotal() int64 { return s.errors.Load() }

// Rotate advances every procedure's minute ring.
func (s *RPCStats) Rotate() {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.procs {
		p.calls.Rotate()
		p.errs.Rotate()
	}
}

func (t *Timings) window(w Window) *Histogram {
	if w == SinceStart {
		return t.SinceStart()
	}
	return t.Last5()
}

// Procedures lists every procedure called in the window, slowest P95 first.
func (s *RPCStats) Procedures(w Window) []ProcedureStats {
	s.mu.RLock()
	procs := make([]*procedure, 0, len(s.procs))
	for _, p := range s.procs {
		procs = append(procs, p)
	}
	s.mu.RUnlock()

	out := make([]ProcedureStats, 0, len(procs))
	for _, p := range procs {
		h := p.calls.window(w)
		if h.Count() == 0 {
			continue
		}
		out = append(out, ProcedureStats{
			Procedure: p.name,
			Calls:     int64(h.Count()),
			Errors:    int64(p.errs.window(w).Count()),
			P50:       h.Percentile(0.5),
			P95:       h.Percentile(0.95),
			Max:       h.Max(),
			Sum:       h.Sum(),
			Buckets:   h.Buckets(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].P95 != out[j].P95 {
			return out[i].P95 > out[j].P95
		}
		return out[i].Procedure < out[j].Procedure
	})
	return out
}
