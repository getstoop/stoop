package config

import (
	"net/url"
	"regexp"
)

const (
	// MaxInstanceNameRunes bounds the server name in characters, not bytes.
	MaxInstanceNameRunes = 100
	// MaxSessionLifetimeDays is the longest sign-in lifetime allowed.
	MaxSessionLifetimeDays = 365
	// DefaultSessionLifetimeDays applies when nothing else sets a lifetime.
	DefaultSessionLifetimeDays = 30
)

var providerIDPattern = regexp.MustCompile(`^[a-z0-9_-]{2,32}$`)

// HTTPURL parses raw and reports whether it is an http or https address with a host.
func HTTPURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, false
	}
	return parsed, true
}

// Origin reports whether raw is an HTTPURL with no path beyond "/", no query and no fragment.
func Origin(raw string) bool {
	parsed, ok := HTTPURL(raw)
	return ok && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && parsed.Fragment == ""
}

// IssuerURL reports whether raw is an HTTPURL with no query and no fragment.
func IssuerURL(raw string) bool {
	parsed, ok := HTTPURL(raw)
	return ok && parsed.RawQuery == "" && parsed.Fragment == ""
}

// ValidProviderID reports whether id fits the login-provider id pattern.
func ValidProviderID(id string) bool { return providerIDPattern.MatchString(id) }
