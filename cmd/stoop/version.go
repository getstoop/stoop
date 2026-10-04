package main

import (
	"fmt"
	"io"
	"os"

	"github.com/getstoop/stoop/internal/buildinfo"
)

// runVersion implements `stoop version`.
func runVersion(args []string, out io.Writer) int {
	if len(args) != 0 {
		fmt.Fprintln(os.Stderr, "usage: stoop version")
		return 2
	}
	_, _ = fmt.Fprintln(out, "stoop", buildinfo.String())
	return 0
}
