package diag

import (
	"context"
	"time"
)

// RunSampler samples every gauge in r every SampleStep and rotates rpc once
// a minute, until ctx ends. A nil rpc means r's own.
func RunSampler(ctx context.Context, r *Registry, rpc *RPCStats) {
	s := newSampler(r, rpc)
	s.tick(time.Now())
	t := time.NewTicker(SampleStep)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			s.tick(now)
		}
	}
}

type sampler struct {
	r      *Registry
	rpc    *RPCStats
	minute time.Time
}

func newSampler(r *Registry, rpc *RPCStats) *sampler {
	if rpc == nil {
		rpc = r.RPC()
	}
	return &sampler{r: r, rpc: rpc}
}

// tick takes one sample of every gauge and rotates once for each minute
// boundary crossed since the last tick, at most a full ring.
func (s *sampler) tick(now time.Time) {
	for _, g := range s.r.gaugeList() {
		g.sample()
	}
	m := now.Truncate(time.Minute)
	if s.minute.IsZero() {
		s.minute = m
		return
	}
	for i := 0; i < minuteRing && s.minute.Before(m); i++ {
		s.minute = s.minute.Add(time.Minute)
		s.rpc.Rotate()
	}
	s.minute = m
}
