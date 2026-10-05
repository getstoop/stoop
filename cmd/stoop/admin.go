package main

import (
	"context"
	"fmt"
	"strings"
	"text/tabwriter"

	"github.com/getstoop/stoop/internal/app"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/instance"
)

const adminUsage = `usage: stoop admin <command>

  list                 show every account and its instance role
  promote <username>   make an account an instance admin
  demote <username>    make an instance admin a regular member
  reset-password <username>
                       set a temporary password (printed once) and sign
                       the account out everywhere; works on the owner too
  transfer-owner <username>
                       make an active admin the server owner
  password-login <everyone|admins|off>
                       who may use the username/password form; "everyone"
                       is the break-glass when the login provider is down
  setting <list|set|clear|reset>
                       the settings .env seeds (public URL, relays,
                       Tailscale, tunnel, login providers, name); run
                       "stoop admin setting" for details

The recovery path when you've locked yourself out of the admin page. Talks
to the database in STOOP_DATABASE_URL directly; the server may keep running.
It never migrates: when the database has migrations pending, or a newer
release has raised the schema floor past this binary, it refuses with exit
status 3.
`

// adminRefusal is why stoop admin will not run against this database, or
// nil. Migrating here would change the schema under a running older server,
// skipping the backup and plan stoop upgrade takes first.
func adminRefusal(plan db.Plan) error {
	if err := plan.Refused(); err != nil {
		return err
	}
	if len(plan.Pending) > 0 {
		return fmt.Errorf("database is at migration %d and this binary needs %d: start this version's server first (stoop upgrade does), or use the stoop that matches the running server", plan.Applied, plan.Newest)
	}
	return nil
}

// runAdmin implements `stoop admin ...`. It returns the process exit code.
func runAdmin(ctx context.Context, args []string, console streams) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		_, _ = fmt.Fprint(console.out, adminUsage)
		return 2
	}
	cfg, pool, plan, err := openDatabase(ctx)
	if err != nil {
		return console.fail(1, err)
	}
	defer pool.Close()
	if err := adminRefusal(plan); err != nil {
		return console.fail(3, err)
	}
	svc := auth.New(pool, auth.Options{})

	switch args[0] {
	case "setting":
		inst := instance.New(pool, nil)
		app.UseSettingsEnv(inst, cfg)
		return runAdminSetting(ctx, inst, args[1:], console)
	case "password-login":
		if !console.oneArgument(args, "stoop admin", "<everyone|admins|off>") {
			return 2
		}
		inst := instance.New(pool, nil)
		if err := inst.SetPasswordSignIn(ctx, instance.PasswordSignIn(args[1])); err != nil {
			return console.fail(1, err)
		}
		_, _ = fmt.Fprintf(console.out, "password sign-in: %s\n", args[1])
		return 0
	case "list":
		accounts, err := svc.ListAccounts(ctx)
		if err != nil {
			return console.fail(1, err)
		}
		writer := tabwriter.NewWriter(console.out, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(writer, "USERNAME\tROLE\tSTATUS\tCREATED")
		for _, account := range accounts {
			role := string(account.Role)
			if account.IsOwner {
				role = "owner"
			}
			status := "active"
			if account.DeactivatedAt != nil {
				status = "deactivated"
			}
			_, _ = fmt.Fprintf(writer, "%s\t%s\t%s\t%s\n", account.Username, role, status, account.CreatedAt.Format("2006-01-02"))
		}
		return flush(writer, console)
	case "promote", "demote":
		if !console.oneArgument(args, "stoop admin", "<username>") {
			return 2
		}
		role := authctx.RoleAdmin
		if args[0] == "demote" {
			role = authctx.RoleMember
		}
		account, err := svc.SetRoleByUsername(ctx, strings.ToLower(args[1]), role)
		if err != nil {
			return console.fail(1, err)
		}
		_, _ = fmt.Fprintf(console.out, "%s is now %s\n", account.Username, account.Role)
		return 0
	case "reset-password":
		if !console.oneArgument(args, "stoop admin", "<username>") {
			return 2
		}
		temp, account, err := svc.ResetPasswordByUsername(ctx, strings.ToLower(args[1]))
		if err != nil {
			return console.fail(1, err)
		}
		_, _ = fmt.Fprintf(console.out, "%s's temporary password: %s\n(every session was signed out; they should change it on their profile page)\n", account.Username, temp)
		return 0
	case "transfer-owner":
		if !console.oneArgument(args, "stoop admin", "<username>") {
			return 2
		}
		account, err := svc.TransferOwnershipByUsername(ctx, strings.ToLower(args[1]))
		if err != nil {
			return console.fail(1, err)
		}
		_, _ = fmt.Fprintf(console.out, "%s now owns this server\n", account.Username)
		return 0
	default:
		return console.failf(2, "unknown admin command %q\n\n%s", args[0], adminUsage)
	}
}

func flush(writer *tabwriter.Writer, console streams) int {
	if err := writer.Flush(); err != nil {
		return console.fail(1, err)
	}
	return 0
}
