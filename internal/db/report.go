package db

import (
	"fmt"
	"io"
	"strings"
)

// Report is a Plan in the words an operator and the upgrade tool read:
// `stoop migrate status|plan` print it, `--json` emits it, and `stoop
// upgrade` on the host decodes it from the new image's output.
type Report struct {
	Binary         string      `json:"binary"`
	Newest         int64       `json:"newest"`
	BinaryFloor    int64       `json:"binary_floor"`
	Applied        int64       `json:"applied"`
	AppliedRelease string      `json:"applied_release,omitempty"`
	Floor          int64       `json:"floor"`
	FloorAfter     int64       `json:"floor_after"`
	Pending        []Migration `json:"pending"`
	Ahead          []int64     `json:"ahead,omitempty"`
	Contract       bool        `json:"contract"`
	Refused        string      `json:"refused,omitempty"`
	Startable      string      `json:"startable,omitempty"`
	StartableAfter string      `json:"startable_after,omitempty"`
}

// Report words a Plan for a binary of the given version.
func (p Plan) Report(version string) Report {
	r := Report{
		Binary:         strings.TrimPrefix(version, "v"),
		Newest:         p.Newest,
		BinaryFloor:    Floor,
		Applied:        p.Applied,
		AppliedRelease: ReleaseAt(p.Applied),
		Floor:          p.Floor,
		FloorAfter:     p.FloorAfter,
		Pending:        p.Pending,
		Ahead:          p.Ahead,
		Contract:       p.Contract(),
	}
	if r.Pending == nil {
		r.Pending = []Migration{}
	}
	if err := p.Refused(); err != nil {
		r.Refused = err.Error()
		return r
	}
	if s, ok := OldestStartable(p.Floor); ok {
		r.Startable = s.Version
	}
	if s, ok := OldestStartable(p.FloorAfter); ok {
		r.StartableAfter = s.Version
	}
	return r
}

// WriteReport prints what the database has and what this binary would do
// to it. With after, it also says what that means for rolling back.
func WriteReport(w io.Writer, r Report, after bool) {
	release := ""
	if r.AppliedRelease != "" {
		release = " (" + r.AppliedRelease + ")"
	}
	_, _ = fmt.Fprintf(w, "database   migration %d%s, floor %d\n", r.Applied, release, r.Floor)
	_, _ = fmt.Fprintf(w, "binary     %s, migration %d, floor %d\n", r.Binary, r.Newest, r.BinaryFloor)
	if len(r.Ahead) > 0 {
		parts := make([]string, len(r.Ahead))
		for i, v := range r.Ahead {
			parts[i] = fmt.Sprint(v)
		}
		_, _ = fmt.Fprintf(w, "ahead      %s applied by a newer release; unknown to this binary\n", strings.Join(parts, ", "))
	}
	_, _ = fmt.Fprintf(w, "pending    %d\n", len(r.Pending))
	for _, m := range r.Pending {
		_, _ = fmt.Fprintf(w, "           %05d_%s\n", m.Version, m.Name)
	}
	if r.Refused != "" {
		_, _ = fmt.Fprintf(w, "refused    %s\n", r.Refused)
		return
	}
	_, _ = fmt.Fprintf(w, "startable  %s\n", startable(r.Startable))
	if !after || len(r.Pending) == 0 {
		return
	}
	line := fmt.Sprintf("floor stays at %d", r.Floor)
	if r.Contract {
		line = fmt.Sprintf("contract migration: floor rises from %d to %d", r.Floor, r.FloorAfter)
	}
	_, _ = fmt.Fprintf(w, "after up   %s; %s\n", line, startable(r.StartableAfter))
}

func startable(version string) string {
	if version == "" {
		return "no tagged release can start against the database"
	}
	return version + " and later can start against the database"
}

// ReleaseAt names the release a migration number belongs to: "0.2.0"
// exactly, "past 0.2.0" between releases, "" before the first.
func ReleaseAt(applied int64) string {
	var newest Release
	for _, r := range Releases {
		if r.Migration == applied {
			return r.Version
		}
		if r.Migration < applied {
			newest = r
		}
	}
	if newest.Version == "" {
		return ""
	}
	return "past " + newest.Version
}
