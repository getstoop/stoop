// Package buildinfo is what a binary knows about itself. Release builds
// set the three variables with -X (see .goreleaser.yaml); anything else
// is "dev" with the commit Go recorded, when it recorded one.
package buildinfo

import (
	"runtime"
	"runtime/debug"
)

var (
	Version = "dev"
	Commit  = ""
	Date    = ""
)

type Info struct {
	Version   string
	Commit    string
	Date      string
	GoVersion string
}

func Get() Info {
	info := Info{Version: Version, Commit: Commit, Date: Date, GoVersion: runtime.Version()}
	if info.Commit == "" {
		if bi, ok := debug.ReadBuildInfo(); ok {
			for _, s := range bi.Settings {
				if s.Key == "vcs.revision" && len(s.Value) >= 7 {
					info.Commit = s.Value[:7]
				}
			}
		}
	}
	return info
}

// String is the one-line form: "v0.1.0 (abc1234)" or "dev (abc1234)".
func String() string {
	info := Get()
	if info.Commit == "" {
		return info.Version
	}
	return info.Version + " (" + info.Commit + ")"
}
