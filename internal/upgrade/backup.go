package upgrade

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// backup is the runbook's two commands (docs/self-hosting.md → Backups)
// into backups/<stamp>-<from>-to-<to>: the dump first, so a file
// uploaded in between is an extra the sweep removes, never a row whose
// file is missing. Returns the directory, relative to the install.
func (u *Upgrader) backup(ctx context.Context, current, target string) (string, error) {
	dir := filepath.Join("backups", u.Now().UTC().Format("20060102-150405")+"-"+current+"-to-"+target)
	if err := os.MkdirAll(u.path(dir), 0o755); err != nil {
		return "", err
	}
	u.say("backing up to %s", dir)

	dump, err := os.Create(u.path(filepath.Join(dir, "stoop.dump")))
	if err != nil {
		return "", err
	}
	var res Result
	if strings.TrimSpace(u.compose(ctx, "ps", "-q", "postgres").Stdout) != "" {
		res = u.Run.Run(ctx, Cmd{Name: "docker", Args: []string{"compose", "exec", "-T", "postgres", "pg_dump", "-U", "stoop", "-Fc", "stoop"}, Stdout: dump})
	} else {
		env, _ := os.ReadFile(u.path(envFile))
		url := envValue(string(env), "STOOP_DATABASE_URL")
		if url == "" {
			_ = dump.Close()
			return "", errors.New("no bundled postgres and no STOOP_DATABASE_URL in .env; cannot take the backup")
		}
		next, _ := os.ReadFile(u.path(nextFile))
		major := PostgresMajor(string(next))
		if major == "" {
			major = "16"
		}
		res = u.Run.Run(ctx, Cmd{Name: "docker", Args: []string{"run", "--rm", "--network", "host", "postgres:" + major + "-alpine", "pg_dump", "-Fc", url}, Stdout: dump})
	}
	_ = dump.Close()
	if res.Code != 0 {
		return "", fmt.Errorf("the database dump failed (exit %d):\n%s", res.Code, res.Stderr)
	}
	if err := nonEmpty(u.path(filepath.Join(dir, "stoop.dump")), "the database dump"); err != nil {
		return "", err
	}

	id := strings.TrimSpace(u.compose(ctx, "ps", "-q", "stoop").Stdout)
	if id == "" {
		return "", errors.New("the stoop container is not running; cannot reach the uploads to back them up")
	}
	abs, err := filepath.Abs(u.path(dir))
	if err != nil {
		return "", err
	}
	res = u.Run.Run(ctx, Cmd{Name: "docker", Args: []string{"run", "--rm", "--volumes-from", id, "-v", abs + ":/backup", "alpine", "tar", "-C", "/data", "-cf", "/backup/stoop-data.tar", "."}})
	if res.Code != 0 {
		return "", fmt.Errorf("the uploads archive failed (exit %d):\n%s", res.Code, res.Stderr)
	}
	if err := nonEmpty(u.path(filepath.Join(dir, "stoop-data.tar")), "the uploads archive"); err != nil {
		return "", err
	}
	return dir, nil
}

func nonEmpty(path, what string) error {
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return fmt.Errorf("%s is empty; not continuing", what)
	}
	return nil
}
