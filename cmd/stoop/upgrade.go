package main

import (
	"context"
	"errors"
	"fmt"

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
why: docs/self-hosting/install.md → Upgrading.
`

// runUpgrade implements `stoop upgrade ...`. It returns the process exit code.
func runUpgrade(ctx context.Context, args []string, console streams) int {
	var options upgrade.Options
	options.Dir = "."
	rollback := false
	// upgradeOnly is whether a flag rollback does not take was given,
	// whatever its value.
	upgradeOnly := false
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--plan":
			options.PlanOnly = true
			upgradeOnly = true
		case "--yes", "-y":
			options.Yes = true
		case "--to", "--file":
			if index+1 >= len(args) {
				_, _ = fmt.Fprint(console.out, upgradeUsage)
				return 2
			}
			if args[index] == "--to" {
				options.To = args[index+1]
			} else {
				options.File = args[index+1]
			}
			upgradeOnly = true
			index++
		case "rollback":
			rollback = true
		default:
			_, _ = fmt.Fprint(console.out, upgradeUsage)
			return 2
		}
	}
	if options.To != "" && options.File != "" {
		return console.fail(2, "stoop upgrade: --to and --file are alternatives; give one")
	}
	if rollback && upgradeOnly {
		_, _ = fmt.Fprint(console.out, upgradeUsage)
		return 2
	}
	upgrader := upgrade.New(options)
	upgrader.Out = console.out
	var err error
	if rollback {
		err = upgrader.Rollback(ctx)
	} else {
		err = upgrader.Upgrade(ctx)
	}
	switch {
	case err == nil:
		return 0
	case errors.Is(err, upgrade.ErrFailed):
		return 1
	default:
		return console.fail(1, "stoop upgrade:", err)
	}
}
