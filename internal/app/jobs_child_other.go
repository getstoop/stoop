//go:build !linux

package app

import "syscall"

// childProcessAttributes sets nothing: only Linux can end a child with
// its parent.
func childProcessAttributes() *syscall.SysProcAttr {
	return nil
}
