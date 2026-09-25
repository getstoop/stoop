package db

import (
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

// Migration is one embedded migration file: its number and the name after
// the underscore.
type Migration struct {
	Version int64
	Name    string
}

// Migrations lists the embedded migrations in order, read from the files
// themselves so no database and no goose state is needed.
func Migrations() ([]Migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	ms := make([]Migration, 0, len(entries))
	for _, e := range entries {
		num, name, ok := strings.Cut(strings.TrimSuffix(e.Name(), ".sql"), "_")
		v, err := strconv.ParseInt(num, 10, 64)
		if !ok || err != nil {
			return nil, fmt.Errorf("migration %q is not NNNNN_name.sql", e.Name())
		}
		ms = append(ms, Migration{Version: v, Name: name})
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].Version < ms[j].Version })
	return ms, nil
}

// Newest is the highest migration this binary carries.
func Newest() (int64, error) {
	ms, err := Migrations()
	if err != nil {
		return 0, err
	}
	if len(ms) == 0 {
		return 0, fmt.Errorf("no embedded migrations")
	}
	return ms[len(ms)-1].Version, nil
}

// Floor is the schema floor after every embedded migration has run: the
// lowest migration a binary must know to start against that schema. A
// contract migration raises schema_floor in the database and this
// constant together (TestFloorMatchesSchema keeps them equal), so a binary
// can say what an upgrade means for rollback without a database in front
// of it. Expand-only releases leave both alone.
// See docs/architecture/data.md → Upgrades and rollback.
const Floor int64 = 0
