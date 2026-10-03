//go:build linux

package app

import "syscall"

// childProcessAttributes has the kernel send the child SIGTERM when the
// server dies, however it dies.
func childProcessAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
}
