package upgrade

import (
	"regexp"
	"strings"
)

// The files an install directory holds, and the ones this tool adds.
const (
	composeFile = "docker-compose.yml"
	envFile     = ".env"
	nextFile    = "docker-compose.yml.next"
	prevFile    = "docker-compose.yml.prev"
	envNextFile = "env.example.next"
)

// companions are the rest of the release bundle, mounted by the compose
// file, so a release that changes one has it in place before starting.
var companions = []string{"livekit.yaml", "livekit-entrypoint.sh"}

// overrideFiles are the override compose itself would load beside the
// main file; a plan run with an explicit -f has to name them too.
var overrideFiles = []string{"docker-compose.override.yml", "docker-compose.override.yaml"}

var (
	imageTag      = regexp.MustCompile(`(?m)^\s*image:\s*(?:\S*/)?stoop:(\S+)`)
	postgresImage = regexp.MustCompile(`(?m)^\s*image:\s*postgres:(\d+)`)
	versionLine   = regexp.MustCompile(`^stoop v?(\S+)`)
)

// TagOf is the stoop image tag a compose file pins: "0.2.0" from
// "image: ghcr.io/getstoop/stoop:0.2.0", "dev" from "image: stoop:dev".
func TagOf(compose string) string {
	if m := imageTag.FindStringSubmatch(compose); m != nil {
		return m[1]
	}
	return ""
}

// PostgresMajor is the bundled Postgres major a compose file pins, or "".
func PostgresMajor(compose string) string {
	if m := postgresImage.FindStringSubmatch(compose); m != nil {
		return m[1]
	}
	return ""
}

// runningVersion is the version in `stoop version` output: "0.3.0" from
// "stoop 0.3.0 (abc1234)".
func runningVersion(out string) string {
	if m := versionLine.FindStringSubmatch(strings.TrimSpace(out)); m != nil {
		return m[1]
	}
	return ""
}

// envValue is the value of key in a .env file's text, or "".
func envValue(env, key string) string {
	for _, line := range strings.Split(env, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), key+"="); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
