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
	r    *Registry
	rpc  *RPCStats
	last time.Time // last rotation; compared monotonically, so a clock step cannot rewind it
}

func newSampler(r *Registry, rpc *RPCStats) *sampler {
	if rpc == nil {
		rpc = r.RPC()
	}
	return &sampler{r: r, rpc: rpc}
}

// tick takes one sample of every gauge and rotates once for each full
// minute elapsed since the last rotation, at most a full ring.
func (s *sampler) tick(now time.Time) {
	for _, g := range s.r.gaugeList() {
		g.sample()
	}
	if s.last.IsZero() {
		s.last = now
		return
	}
	full := int(now.Sub(s.last) / time.Minute)
	if full <= 0 {
		return
	}
	for range min(full, minuteRing) {
		s.rpc.Rotate()
	}
	s.last = s.last.Add(time.Duration(full) * time.Minute)
}
