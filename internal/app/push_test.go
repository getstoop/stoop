package app

import (
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/push"
)

func TestPushState(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name   string
		stats  push.DeliveryStats
		want   instance.CheckState
		detail string
	}{
		{"nobody registered", push.DeliveryStats{}, instance.CheckOff, "no devices registered"},
		{"all well", push.DeliveryStats{Devices: 3}, instance.CheckOK, "3 devices · none failing"},
		{"failing today", push.DeliveryStats{Devices: 3, Failing: 2, Reasons: []push.FailureReason{
			{Reason: "push service refused it (403)", Devices: 1, Latest: now.Add(-4 * time.Minute)},
			{Reason: "push service busy (503)", Devices: 1, Latest: now.Add(-2 * time.Hour)},
		}}, instance.CheckWarn,
			"3 devices · 2 failing: push service refused it (403) ×1, 4 min ago; push service busy (503) ×1, 2 h ago"},
		{"failing long ago", push.DeliveryStats{Devices: 1, Failing: 1, Reasons: []push.FailureReason{
			{Reason: "push service refused it (401)", Devices: 1, Latest: now.Add(-50 * time.Hour)},
		}}, instance.CheckOK, "1 device · 1 failing: push service refused it (401) ×1, 2 d ago"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := pushState(tc.stats, now)
			if state != tc.want || detail != tc.detail {
				t.Errorf("got %v %q, want %v %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}
