package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// envReader reads STOOP_* variables and collects every refusal, so start-up
// names all the bad variables at once. A refused variable reads as its
// fallback, which keeps one mistake from setting off checks further down.
type envReader struct {
	errs    []error
	refused map[string]bool
}

func (env *envReader) fail(format string, args ...any) {
	env.errs = append(env.errs, fmt.Errorf(format, args...))
}

// refuse records a bad value for key, so a check that depends on it can
// stay quiet instead of blaming another variable.
func (env *envReader) refuse(key, format string, args ...any) {
	if env.refused == nil {
		env.refused = map[string]bool{}
	}
	env.refused[key] = true
	env.fail(format, args...)
}

func (env *envReader) err() error { return errors.Join(env.errs...) }

func (env *envReader) bool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		env.refuse(key, "%s must be true or false (got %q)", key, raw)
		return fallback
	}
	return value
}

// duration accepts 0, which callers read as "off" or "forever".
func (env *envReader) duration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < 0 {
		env.refuse(key, "%s must be a duration like 6h or 30m, or 0 (got %q)", key, raw)
		return fallback
	}
	return value
}

func (env *envReader) nonNegativeInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		env.refuse(key, "%s must be a whole number >= 0 (got %q)", key, raw)
		return fallback
	}
	return value
}

func (env *envReader) port(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > 65535 {
		env.refuse(key, "%s must be a port between 1 and 65535 (got %q)", key, raw)
		return fallback
	}
	return value
}

// maxPortRange bounds how many UDP ports the Tailscale node will carry.
// LiveKit's default range is 101; a typo asking for tens of thousands of
// listeners should be rejected, not obeyed.
const maxPortRange = 4096

// portRange reads an inclusive "start-end" range, or a single port.
func (env *envReader) portRange(key string, fallbackStart, fallbackEnd int) (int, int) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallbackStart, fallbackEnd
	}
	startText, endText, ok := strings.Cut(raw, "-")
	if !ok {
		endText = startText
	}
	start, startErr := strconv.Atoi(strings.TrimSpace(startText))
	end, endErr := strconv.Atoi(strings.TrimSpace(endText))
	if startErr != nil || endErr != nil || start < 1 || end > 65535 || start > end {
		env.refuse(key, "%s must be a port range like 50000-50100 (got %q)", key, raw)
		return fallbackStart, fallbackEnd
	}
	if end-start+1 > maxPortRange {
		env.refuse(key, "%s covers %d ports; %d is the most that will be carried", key, end-start+1, maxPortRange)
		return fallbackStart, fallbackEnd
	}
	return start, end
}

func (env *envReader) oneOf(key, fallback string, allowed ...string) string {
	value := getenv(key, fallback)
	for _, option := range allowed {
		if value == option {
			return value
		}
	}
	env.refuse(key, "%s must be %s (got %q)", key, strings.Join(allowed, ", "), value)
	return fallback
}

// splitList parses a comma-separated value, dropping blanks.
func splitList(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

// IsSet reports whether the environment gives name a value; empty counts
// as unset, as everywhere else here.
func IsSet(name string) bool { return os.Getenv(name) != "" }

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
