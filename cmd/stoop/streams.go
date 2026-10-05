package main

import (
	"context"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db"
)

// streams is where a verb writes: what it was asked for to out, why it
// refused or failed to errOut.
type streams struct {
	out, errOut io.Writer
}

// fail prints values to errOut as a line and returns code.
func (s streams) fail(code int, values ...any) int {
	_, _ = fmt.Fprintln(s.errOut, values...)
	return code
}

// failf prints a formatted message to errOut and returns code.
func (s streams) failf(code int, format string, values ...any) int {
	_, _ = fmt.Fprintf(s.errOut, format, values...)
	return code
}

// oneArgument reports whether args is a command and one argument; when it
// is not, it prints "usage: <verb> <command> <placeholder>".
func (s streams) oneArgument(args []string, verb, placeholder string) bool {
	if len(args) == 2 {
		return true
	}
	_, _ = fmt.Fprintf(s.errOut, "usage: %s %s %s\n", verb, args[0], placeholder)
	return false
}

// openDatabase loads the configuration, connects to its database and reads
// what the schema holds. The caller closes the pool.
func openDatabase(ctx context.Context) (config.Config, *pgxpool.Pool, db.Plan, error) {
	cfg, err := config.Load()
	if err != nil {
		return config.Config{}, nil, db.Plan{}, fmt.Errorf("invalid configuration: %w", err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabasePoolMax)
	if err != nil {
		return config.Config{}, nil, db.Plan{}, err
	}
	plan, err := db.Inspect(ctx, pool)
	if err != nil {
		pool.Close()
		return config.Config{}, nil, db.Plan{}, err
	}
	return cfg, pool, plan, nil
}
