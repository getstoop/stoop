package db

// Release is a tagged release and the last migration it shipped. The
// release PR appends a row (docs/releasing.md), which is what lets the
// binary say "0.2.0 and later can start against this database" instead of
// naming a migration number.
type Release struct {
	Version   string
	Migration int64
}

// Releases, oldest first. TestReleases checks the order and that every
// migration named here is one the binary carries.
var Releases = []Release{
	{"0.1.0", 28},
	{"0.2.0", 37},
}

// OldestStartable is the oldest release that can start against a
// database whose schema floor is floor. false when no tagged release can,
// which happens only while the floor names an unreleased migration.
func OldestStartable(floor int64) (Release, bool) {
	for _, r := range Releases {
		if r.Migration >= floor {
			return r, true
		}
	}
	return Release{}, false
}
