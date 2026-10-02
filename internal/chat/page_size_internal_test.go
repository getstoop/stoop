package chat

import "testing"

func TestClampPageSize(t *testing.T) {
	cases := []struct {
		name      string
		requested int32
		want      int32
	}{
		{"zero gives the fallback", 0, 50},
		{"negative gives the fallback", -3, 50},
		{"in range is kept", 20, 20},
		{"exactly the maximum is kept", 100, 100},
		{"above the maximum is cut", 101, 100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clampPageSize(tc.requested, 50, 100); got != tc.want {
				t.Fatalf("clampPageSize(%d, 50, 100) = %d, want %d", tc.requested, got, tc.want)
			}
		})
	}
}
