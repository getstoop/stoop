package upgrade

import (
	"regexp"
	"strings"
)

var envKey = regexp.MustCompile(`^#?\s*([A-Z_][A-Z0-9_]*)=`)

// MissingSettings is every setting the release's env example sets to a
// value that the operator's .env does not mention at all, commented or
// not: the COMPOSE_PROFILES lesson from 0.2 → 0.3, where a missing line
// stops the bundled Postgres. Returned as "KEY=value" lines.
func MissingSettings(example, env string) []string {
	known := map[string]bool{}
	for _, line := range strings.Split(env, "\n") {
		if m := envKey.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			known[m[1]] = true
		}
	}
	var missing []string
	for _, line := range strings.Split(example, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") || value == "" || !envKey.MatchString(line) {
			continue
		}
		if !known[key] {
			missing = append(missing, line)
		}
	}
	return missing
}
