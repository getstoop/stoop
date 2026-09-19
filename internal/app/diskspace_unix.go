//go:build unix

package app

import "syscall"

// diskSpace is the volume behind path: total and free bytes for an
// unprivileged writer.
func diskSpace(path string) (total, free int64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bsize := int64(st.Bsize) //nolint:unconvert // Bsize is int64 on some platforms and uint32 on others
	return int64(st.Blocks) * bsize, int64(st.Bavail) * bsize, nil
}
