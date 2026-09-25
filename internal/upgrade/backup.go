package upgrade

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// backupInfo is where the backup went and which Postgres it came from,
// which decides how a restore has to be written.
type backupInfo struct {
	Dir     string // relative to the install directory
	Bundled bool   // the compose stack's own postgres service
}

// backup is the runbook's two commands (docs/self-hosting.md → Backups)
// into backups/<stamp>-<from>-to-<to>: the dump first, so a file
// uploaded in between is an extra the sweep removes, never a row whose
// file is missing. The directory and both files are readable by the
// operator only; the dump is the whole database.
func (u *Upgrader) backup(ctx context.Context, current, target string) (backupInfo, error) {
	info := backupInfo{Dir: filepath.Join("backups", u.Now().UTC().Format("20060102-150405")+"-"+current+"-to-"+target)}
	if err := os.MkdirAll(u.path("backups"), 0o700); err != nil {
		return info, err
	}
	if err := os.Mkdir(u.path(info.Dir), 0o700); err != nil {
		return info, err
	}
	u.say("backing up to %s", info.Dir)

	dumpPath := u.path(filepath.Join(info.Dir, "stoop.dump"))
	dump, err := os.OpenFile(dumpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return info, err
	}
	var res Result
	info.Bundled = strings.TrimSpace(u.compose(ctx, "ps", "-q", "postgres").Stdout) != ""
	if info.Bundled {
		res = u.Run.Run(ctx, Cmd{Name: "docker", Args: []string{"compose", "exec", "-T", "postgres", "pg_dump", "-U", "stoop", "-Fc", "stoop"}, Stdout: dump})
	} else {
		env, _ := os.ReadFile(u.path(envFile))
		url := envValue(string(env), "STOOP_DATABASE_URL")
		if url == "" {
			_ = dump.Close()
			return info, errors.New("no bundled postgres and no STOOP_DATABASE_URL in .env; cannot take the backup")
		}
		// The URL carries the password, so it reaches pg_dump through the
		// environment and never through an argument another user could list.
		res = u.Run.Run(ctx, Cmd{
			Name:   "docker",
			Args:   []string{"run", "--rm", "--network", "host", "-e", "STOOP_DATABASE_URL", "postgres:" + u.postgresMajor() + "-alpine", "sh", "-c", `exec pg_dump -Fc "$STOOP_DATABASE_URL"`},
			Env:    []string{"STOOP_DATABASE_URL=" + url},
			Stdout: dump,
		})
	}
	_ = dump.Close()
	if res.Code != 0 {
		return info, fmt.Errorf("the database dump failed (exit %d):\n%s", res.Code, res.Stderr)
	}
	if err := nonEmpty(dumpPath, "the database dump"); err != nil {
		return info, err
	}

	id := strings.TrimSpace(u.compose(ctx, "ps", "-q", "stoop").Stdout)
	if id == "" {
		return info, errors.New("the stoop container is not running; cannot reach the uploads to back them up")
	}
	abs, err := filepath.Abs(u.path(info.Dir))
	if err != nil {
		return info, err
	}
	// umask: the archive is written by root inside the container, and must
	// come out readable by nobody else on the host.
	res = u.Run.Run(ctx, Cmd{Name: "docker", Args: []string{"run", "--rm", "--volumes-from", id, "-v", abs + ":/backup", "alpine", "sh", "-c", "umask 077 && tar -C /data -cf /backup/stoop-data.tar ."}})
	if res.Code != 0 {
		return info, fmt.Errorf("the uploads archive failed (exit %d):\n%s", res.Code, res.Stderr)
	}
	if err := nonEmpty(u.path(filepath.Join(info.Dir, "stoop-data.tar")), "the uploads archive"); err != nil {
		return info, err
	}
	return info, nil
}

// postgresMajor is the Postgres major the new compose file pins, for the
// image that dumps and restores an operator's own server; 16 when it
// pins none.
func (u *Upgrader) postgresMajor() string {
	next, _ := os.ReadFile(u.path(nextFile))
	if major := PostgresMajor(string(next)); major != "" {
		return major
	}
	return "16"
}

func nonEmpty(path, what string) error {
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return fmt.Errorf("%s is empty; not continuing", what)
	}
	return nil
}
