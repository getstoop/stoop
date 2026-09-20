package instance

import (
	"math"
	"testing"
)

func TestClampInt32(t *testing.T) {
	cases := []struct {
		name string
		in   int64
		want int32
	}{
		{"zero", 0, 0},
		{"small", 4200, 4200},
		{"max", math.MaxInt32, math.MaxInt32},
		{"over max", math.MaxInt32 + 1, math.MaxInt32},
		{"thirty days", 30 * 24 * 60 * 60 * 1000, math.MaxInt32},
		{"min", math.MinInt32, math.MinInt32},
		{"under min", math.MinInt32 - 1, math.MinInt32},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := clampInt32(c.in); got != c.want {
				t.Fatalf("clampInt32(%d) = %d, want %d", c.in, got, c.want)
			}
		})
	}
}
