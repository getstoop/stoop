package main

import (
	"context"
	"fmt"
	"io"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/getstoop/stoop/internal/instance"
)

const settingUsage = `usage: stoop admin setting <command>

  list                 every setting .env can seed and its value; one not
                       saved yet is read from .env
  set <name>=<value>...
                       change settings, checked as the admin page checks
                       them; lists are comma-separated, login-providers is
                       a JSON list as list prints it, and a secret left
                       out or blank is kept
  clear <group>        save a group empty: no address, no relay, off
  reset <group>        forget the saved value: .env applies again, and the
                       next start saves it
`

// restartNeeded is the groups a running server reads only at start.
var restartNeeded = []string{"tailscale", "cloudflare-tunnel", "trusted-proxies"}

func runAdminSetting(ctx context.Context, inst *instance.Service, args []string, console streams) int {
	if len(args) == 0 {
		return console.failf(2, "%s", settingUsage)
	}
	switch args[0] {
	case "list":
		fields, err := inst.SettingFields(ctx)
		if err != nil {
			return console.fail(1, err)
		}
		writer := tabwriter.NewWriter(console.out, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(writer, "NAME\tVALUE\tSAVED")
		for _, field := range fields {
			saved := "yes"
			if !field.Saved {
				saved = "no"
			}
			_, _ = fmt.Fprintf(writer, "%s\t%s\t%s\n", field.Name, field.Value, saved)
		}
		return flush(writer, console)
	case "set":
		if len(args) < 2 {
			return console.failf(2, "%s", settingUsage)
		}
		changes := map[string]string{}
		for _, arg := range args[1:] {
			name, value, ok := strings.Cut(arg, "=")
			if !ok {
				return console.failf(2, "%q is not name=value\n", arg)
			}
			changes[name] = value
		}
		if err := inst.SetSettingFields(ctx, changes); err != nil {
			return console.fail(1, err)
		}
		names := make([]string, 0, len(changes))
		for name := range changes {
			names = append(names, name)
		}
		return saved(console.out, names...)
	case "clear", "reset":
		if !console.oneArgument(args, "stoop admin setting", "<group>") {
			return 2
		}
		if args[0] == "clear" {
			if err := inst.ClearSetting(ctx, args[1]); err != nil {
				return console.fail(1, err)
			}
			return saved(console.out, args[1])
		}
		existed, err := inst.ResetSetting(ctx, args[1])
		if err != nil {
			return console.fail(1, err)
		}
		if !existed {
			_, _ = fmt.Fprintf(console.out, "%s had nothing saved\n", args[1])
			return 0
		}
		if slices.Contains(restartNeeded, args[1]) {
			return saved(console.out, args[1])
		}
		_, _ = fmt.Fprintln(console.out, "saved\nthe running server uses .env as it was at start; restart it if .env has changed since")
		return 0
	default:
		return console.failf(2, "unknown setting command %q\n\n%s", args[0], settingUsage)
	}
}

// saved confirms a change, and says when the running server won't see it
// until it restarts.
func saved(out io.Writer, names ...string) int {
	_, _ = fmt.Fprintln(out, "saved")
	for _, name := range names {
		group, _, _ := strings.Cut(name, ".")
		for _, needsRestart := range restartNeeded {
			if group == needsRestart {
				_, _ = fmt.Fprintf(out, "restart the server for the %s change to take effect\n", group)
				return 0
			}
		}
	}
	return 0
}
