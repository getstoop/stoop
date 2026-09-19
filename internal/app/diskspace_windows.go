//go:build windows

package app

import "errors"

// diskSpace has no stdlib answer on Windows; the row says so.
func diskSpace(string) (total, free int64, err error) {
	return 0, 0, errors.New("not available")
}
