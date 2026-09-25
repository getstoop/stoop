package upgrade

import (
	"strconv"
	"strings"
)

// Older is whether release a is older than release b. Versions are dotted
// numbers ("0.2.0", "0.10"); anything else, like "dev", counts as newest.
func Older(a, b string) bool {
	if a == b {
		return false
	}
	pa, okA := parseVersion(a)
	pb, okB := parseVersion(b)
	switch {
	case !okA:
		return false
	case !okB:
		return true
	}
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			return x < y
		}
	}
	return false
}

func parseVersion(v string) ([]int, bool) {
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	nums := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		nums[i] = n
	}
	return nums, true
}
