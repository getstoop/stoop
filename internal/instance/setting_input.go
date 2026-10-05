package instance

import (
	"strings"
)

// keepSecret is the rule for write-only fields: a blank one keeps the
// secret in force.
func keepSecret(typed, current string) string {
	if typed != "" {
		return typed
	}
	return current
}

func trimAll(in []string) []string {
	var out []string
	for _, v := range in {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}
