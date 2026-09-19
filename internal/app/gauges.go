package app

import (
	"sync"
	"time"

	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/realtime"
)

// The Right now panel's gauges. Each is a read function the sampler calls
// every diag.SampleStep (docs/architecture/diagnostics.md).
func registerGauges(gateway *realtime.Gateway) {
	diag.NewGauge("connections", "Open WebSocket sessions.", func() float64 { return float64(gateway.ConnectionCount()) })
	diag.NewGauge("online_users", "Accounts with at least one connection.", func() float64 { return float64(gateway.OnlineUserCount()) })
	diag.NewGauge("voice_rooms", "Voice channels with someone in them.", func() float64 { return float64(gateway.VoiceRoomCount()) })
	diag.NewGauge("voice_participants", "People in a voice channel.", func() float64 { return float64(gateway.VoiceParticipantCount()) })
	diag.NewGauge("requests_per_minute", "Unary RPCs per minute.", perMinute(diag.RPC.CallsTotal, time.Now))
	diag.NewGauge("request_errors_per_minute", "Failed unary RPCs per minute.", perMinute(diag.RPC.ErrorsTotal, time.Now))
}

// perMinute turns a monotonic counter into a rate over the last minute.
// A read records a sample at most every rateStep and measures against the
// oldest sample still inside rateWindow, so the answer is the same
// whoever reads it: the sampler, a scrape and the tab agree.
const (
	rateStep   = 5 * time.Second
	rateWindow = time.Minute
)

func perMinute(total func() int64, now func() time.Time) func() float64 {
	r := &rate{}
	return func() float64 { return r.next(total(), now()) }
}

type sample struct {
	v  int64
	at time.Time
}

type rate struct {
	mu      sync.Mutex
	samples []sample // oldest first
}

func (r *rate) next(v int64, now time.Time) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n := len(r.samples); n == 0 || now.Sub(r.samples[n-1].at) >= rateStep {
		r.samples = append(r.samples, sample{v, now})
	}
	// Keep the sample at the window's edge so the span stays a full minute.
	for len(r.samples) > 1 && now.Sub(r.samples[1].at) >= rateWindow {
		r.samples = r.samples[1:]
	}
	first := r.samples[0]
	elapsed := now.Sub(first.at)
	if elapsed <= 0 || v < first.v {
		return 0
	}
	return float64(v-first.v) * float64(time.Minute) / float64(elapsed)
}
