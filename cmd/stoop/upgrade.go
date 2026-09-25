package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/getstoop/stoop/internal/upgrade"
)

const upgradeUsage = `usage: stoop upgrade [--plan] [--yes] [--to VERSION | --file FILE]
       stoop upgrade rollback [--yes]

  (no arguments)   upgrade the compose install in this directory to the
                   latest release
  --to 0.4.0       upgrade to that release
  --plan           show what would happen and stop
  --yes            no confirmation prompt
  --file FILE      FILE is the new compose file (nothing is downloaded)
  rollback         put the previous compose file back and restart

Run it from the directory that holds docker-compose.yml and .env. Needs
docker compose; talks to nothing else on this machine. What it does and
why: docs/self-hosting.md → Upgrading.
`

// runUpgrade implements `stoop upgrade ...`. It returns the process exit code.
func runUpgrade(ctx context.Context, args []string, out io.Writer) int {
	var o upgrade.Options
	o.Dir = "."
	rollback := false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--plan":
			o.PlanOnly = true
		case "--yes", "-y":
			o.Yes = true
		case "--to", "--file":
			if i+1 >= len(args) {
				_, _ = fmt.Fprint(out, upgradeUsage)
				return 2
			}
			if args[i] == "--to" {
				o.To = args[i+1]
			} else {
				o.File = args[i+1]
			}
			i++
		case "rollback":
			rollback = true
		default:
			_, _ = fmt.Fprint(out, upgradeUsage)
			return 2
		}
	}
	if o.To != "" && o.File != "" {
		fmt.Fprintln(os.Stderr, "stoop upgrade: --to and --file are alternatives; give one")
		return 2
	}
	u := upgrade.New(o)
	u.Out = out
	var err error
	if rollback {
		err = u.Rollback(ctx)
	} else {
		err = u.Upgrade(ctx)
	}
	switch {
	case err == nil:
		return 0
	case errors.Is(err, upgrade.ErrFailed):
		return 1
	default:
		fmt.Fprintln(os.Stderr, "stoop upgrade:", err)
		return 1
	}
}
