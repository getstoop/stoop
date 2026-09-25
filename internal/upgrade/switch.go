package upgrade

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// switchTo puts the new bundle files in place, keeps the old ones as
// .prev, starts the stack and checks the running binary is the target.
// On failure it prints the log and the way back.
func (u *Upgrader) switchTo(ctx context.Context, current, target string, backup backupInfo, plannedContract, fetched bool) error {
	u.say("starting %s", target)
	if err := u.swapIn(composeFile, nextFile); err != nil {
		return err
	}
	for _, name := range companions {
		if _, err := os.Stat(u.path(name + ".next")); err == nil {
			if err := u.swapIn(name, name+".next"); err != nil {
				return err
			}
		}
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
		// Whether the old release can still start is a fact about the
		// database now, not about the plan: a start that failed before
		// its contract migration ran leaves the floor where it was.
		canStart := !plannedContract
		if oldest, ok := u.startable(ctx); ok {
			canStart = !Older(current, oldest)
		}
		if canStart {
			_, _ = fmt.Fprintf(u.Out, "Nothing it did stops %s from starting. To go back:\n  stoop upgrade rollback\n", current)
		} else {
			_, _ = fmt.Fprintf(u.Out, "It ran a contract migration, so %s cannot start against the database now.\n", current)
			_, _ = fmt.Fprint(u.Out, "Restore the backup, then put the old files back:\n"+u.restoreCommands(backup)+
				"docs/self-hosting.md → Restoring in place explains each line.\n")
		}
		return ErrFailed
	}
	if fetched {
		_ = os.Remove(u.path(envNextFile))
	}
	u.say("upgraded %s -> %s; backup in %s", current, target, backup.Dir)
	if plannedContract {
		_, _ = fmt.Fprintf(u.Out, "Rolling back to %s now means restoring that backup (docs/self-hosting.md → Restoring in place).\n", current)
	} else {
		_, _ = fmt.Fprintln(u.Out, "If something is wrong: stoop upgrade rollback")
	}
	return nil
}

// swapIn keeps the current file as <name>.prev and moves next into place.
func (u *Upgrader) swapIn(name, next string) error {
	if old, err := os.ReadFile(u.path(name)); err == nil {
		if err := os.WriteFile(u.path(name+".prev"), old, 0o644); err != nil {
			return err
		}
	}
	return os.Rename(u.path(next), u.path(name))
}

// restoreCommands is the in-place restore runbook with this backup's
// paths filled in, one command per line. An operator's own Postgres has
// no container to exec into, so its restore is one pg_restore that
// replaces the objects in place.
func (u *Upgrader) restoreCommands(backup backupInfo) string {
	dir := strings.ReplaceAll(backup.Dir, "\\", "/")
	var lines []string
	if backup.Bundled {
		lines = []string{
			"  docker compose stop stoop",
			"  docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop WITH (FORCE)' -c 'CREATE DATABASE stoop'",
			"  docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < " + dir + "/stoop.dump",
		}
	} else {
		lines = []string{
			"  docker compose stop stoop",
			"  docker run --rm -i --network host -e STOOP_DATABASE_URL postgres:" + u.postgresMajor() + "-alpine sh -c 'pg_restore --clean --if-exists --no-owner -d \"$STOOP_DATABASE_URL\"' < " + dir + "/stoop.dump",
			"    (with STOOP_DATABASE_URL exported from .env first)",
		}
	}
	lines = append(lines,
		`  docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD/`+dir+`":/backup alpine tar -C /data -xf /backup/stoop-data.tar`,
		"  mv "+prevFile+" "+composeFile+" && docker compose up -d",
	)
	return strings.Join(lines, "\n") + "\n"
}
