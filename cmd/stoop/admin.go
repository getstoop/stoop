package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/Jhut89/stoop/internal/auth"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/config"
	"github.com/Jhut89/stoop/internal/db"
	"github.com/Jhut89/stoop/internal/instance"
)

const adminUsage = `usage: stoop admin <command>

  list                 show every account and its instance role
  promote <username>   make an account an instance admin
  demote <username>    make an instance admin a regular member
  reset-password <username>
                       set a temporary password (printed once) and sign
                       the account out everywhere
  password-login <everyone|admins|off>
                       who may use the username/password form; "everyone"
                       is the break-glass when the login provider is down

The recovery path when you've locked yourself out of the admin page. Talks
to the database in STOOP_DATABASE_URL directly; the server may keep running.
`

// runAdmin implements `stoop admin ...`. It returns the process exit code.
func runAdmin(ctx context.Context, args []string, out io.Writer) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		_, _ = fmt.Fprint(out, adminUsage)
		return 2
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid configuration:", err)
		return 1
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	svc := auth.New(pool, auth.Options{})

	switch args[0] {
	case "password-login":
		if len(args) != 2 {
			fmt.Fprintln(os.Stderr, "usage: stoop admin password-login <everyone|admins|off>")
			return 2
		}
		inst := instance.New(pool, nil)
		if err := inst.SetPasswordSignIn(ctx, instance.PasswordSignIn(args[1])); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		_, _ = fmt.Fprintf(out, "password sign-in: %s\n", args[1])
		return 0
	case "list":
		accounts, err := svc.ListAccounts(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "USERNAME\tROLE\tSTATUS\tCREATED")
		for _, a := range accounts {
			status := "active"
			if a.DeactivatedAt != nil {
				status = "deactivated"
			}
			_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", a.Username, a.Role, status, a.CreatedAt.Format("2006-01-02"))
		}
		return flush(w)
	case "promote", "demote":
		if len(args) != 2 {
			fmt.Fprintf(os.Stderr, "usage: stoop admin %s <username>\n", args[0])
			return 2
		}
		role := authctx.RoleAdmin
		if args[0] == "demote" {
			role = authctx.RoleMember
		}
		a, err := svc.SetRoleByUsername(ctx, strings.ToLower(args[1]), role)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		_, _ = fmt.Fprintf(out, "%s is now %s\n", a.Username, a.Role)
		return 0
	case "reset-password":
		if len(args) != 2 {
			fmt.Fprintln(os.Stderr, "usage: stoop admin reset-password <username>")
			return 2
		}
		temp, a, err := svc.ResetPasswordByUsername(ctx, strings.ToLower(args[1]))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		_, _ = fmt.Fprintf(out, "%s's temporary password: %s\n(every session was signed out; they should change it on their profile page)\n", a.Username, temp)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown admin command %q\n\n%s", args[0], adminUsage)
		return 2
	}
}

func flush(w *tabwriter.Writer) int {
	if err := w.Flush(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}
