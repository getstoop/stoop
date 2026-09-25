package upgrade

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// switchTo puts the new compose file in place, keeps the old one as
// prevFile, starts the stack and checks the running binary is the
// target. On failure it prints the log and the way back.
func (u *Upgrader) switchTo(ctx context.Context, current, target, backup string, contract, fetched bool) error {
	u.say("starting %s", target)
	old, err := os.ReadFile(u.path(composeFile))
	if err != nil {
		return err
	}
	if err := os.WriteFile(u.path(prevFile), old, 0o644); err != nil {
		return err
	}
	if err := os.Rename(u.path(nextFile), u.path(composeFile)); err != nil {
		return err
	}
	running := ""
	if res := u.composeStreaming(ctx, "up", "-d", "--remove-orphans", "--wait", "--wait-timeout", u.Wait); res.Code == 0 {
		running = runningVersion(u.compose(ctx, "exec", "-T", "stoop", "stoop", "version").Stdout)
	}
	if running != target {
		_, _ = fmt.Fprintln(u.Out)
		u.composeStreaming(ctx, "logs", "--tail", "40", "stoop")
		_, _ = fmt.Fprintln(u.Out)
		if running == "" {
			running = "nothing"
		}
		_, _ = fmt.Fprintf(u.Out, "%s did not come up healthy (running: %s).\n", target, running)
		if contract {
			_, _ = fmt.Fprintf(u.Out, "It ran a contract migration, so %s cannot start against the database now.\n", current)
			_, _ = fmt.Fprint(u.Out, "Restore the backup, then put the old file back:\n"+restoreCommands(backup)+
				"docs/self-hosting.md → Restoring in place explains each line.\n")
		} else {
			_, _ = fmt.Fprintf(u.Out, "Nothing it did stops %s from starting. To go back:\n  stoop upgrade rollback\n", current)
		}
		return ErrFailed
	}
	if fetched {
		_ = os.Remove(u.path(envNextFile))
	}
	u.say("upgraded %s -> %s; backup in %s", current, target, backup)
	if contract {
		_, _ = fmt.Fprintf(u.Out, "Rolling back to %s now means restoring that backup (docs/self-hosting.md → Restoring in place).\n", current)
	} else {
		_, _ = fmt.Fprintln(u.Out, "If something is wrong: stoop upgrade rollback")
	}
	return nil
}

// restoreCommands is the in-place restore runbook with this backup's
// paths filled in, one command per line.
func restoreCommands(backup string) string {
	backup = strings.ReplaceAll(backup, "\\", "/")
	return strings.Join([]string{
		"  docker compose stop stoop",
		"  docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop WITH (FORCE)' -c 'CREATE DATABASE stoop'",
		"  docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < " + backup + "/stoop.dump",
		`  docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD/` + backup + `":/backup alpine tar -C /data -xf /backup/stoop-data.tar`,
		"  mv " + prevFile + " " + composeFile + " && docker compose up -d",
	}, "\n") + "\n"
}
