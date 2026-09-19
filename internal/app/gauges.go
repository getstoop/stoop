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

// perMinute turns a monotonic counter into a rate: each read is the growth
// since the previous read, scaled to a minute. The first read is 0.
func perMinute(total func() int64, now func() time.Time) func() float64 {
	r := &rate{}
	return func() float64 { return r.next(total(), now()) }
}

type rate struct {
	mu      sync.Mutex
	sampled bool
	last    int64
	at      time.Time
}

func (r *rate) next(v int64, now time.Time) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	prev, at, sampled := r.last, r.at, r.sampled
	r.last, r.at, r.sampled = v, now, true
	elapsed := now.Sub(at)
	if !sampled || elapsed <= 0 || v < prev {
		return 0
	}
	return float64(v-prev) * float64(time.Minute) / float64(elapsed)
}
