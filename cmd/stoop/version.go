package main

import (
	"fmt"

	"github.com/getstoop/stoop/internal/buildinfo"
)

// runVersion implements `stoop version`.
func runVersion(args []string, console streams) int {
	if len(args) != 0 {
		return console.fail(2, "usage: stoop version")
	}
	_, _ = fmt.Fprintln(console.out, "stoop", buildinfo.String())
	return 0
}
