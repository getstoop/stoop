// Package blob is the storage abstraction behind file uploads: a Store puts,
// opens, stats, and deletes opaque blobs by key. It is the only package
// that touches storage; everything else (the files module, phase-2
// attachments) goes through the interface. The filesystem implementation
// is the default; an S3-compatible one is planned (see the STOOP-5 design).
package blob

import (
	"context"
	"errors"
	"io"
	"regexp"
	"time"
)

var (
	// ErrNotFound is returned by Open, Stat, and Delete when no blob has
	// the key. Callers compare with errors.Is.
	ErrNotFound = errors.New("blob: not found")
	// ErrInvalidKey is returned for keys that don't match the {kind}/{id}
	// shape. Keys are minted by the server, never derived from client
	// input, so this only ever signals a programming error.
	ErrInvalidKey = errors.New("blob: invalid key")
	// ErrSizeMismatch is returned by Put when the reader yields a different
	// number of bytes than the declared size.
	ErrSizeMismatch = errors.New("blob: size mismatch")
)

// Stat describes a stored blob. ContentType is only populated by stores
// that persist it; the fs store does not (the files table is the record
// of truth for it), so callers must not rely on it for serving.
type Stat struct {
	Size        int64
	ContentType string
	ModTime     time.Time
}

// Store is the storage port. Keys are "{kind}/{id}" where both segments
// are [A-Za-z0-9_-] — never a client filename — so no implementation can
// be talked into path traversal.
type Store interface {
	// Put stores the reader's bytes under key, replacing any existing
	// blob. size is the exact byte count expected from r; a mismatch is
	// an error and nothing is left behind. Writes are atomic: a
	// concurrent Open sees either the old blob or the complete new one.
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	// Open returns the blob's bytes and its Stat. The caller closes it.
	Open(ctx context.Context, key string) (io.ReadCloser, Stat, error)
	// OpenRange is Open for a window of the blob: length bytes starting at
	// offset, or everything from offset when length is negative. Stat
	// still describes the whole blob. A window past the end is the
	// caller's mistake (it has the size from Stat or its own record);
	// stores may return a short read rather than an error. Backs HTTP
	// Range requests, which <video> seeking and iOS playback depend on.
	OpenRange(ctx context.Context, key string, offset, length int64) (io.ReadCloser, Stat, error)
	// Stat describes the blob without opening it.
	Stat(ctx context.Context, key string) (Stat, error)
	// Walk calls fn for every stored blob. Used by the files sweep to find
	// blobs no row points at; a store may also use the pass to drop its
	// own abandoned temporaries. fn returning an error stops the walk.
	Walk(ctx context.Context, fn func(key string, st Stat) error) error
	// Delete removes the blob. Deleting a missing key is ErrNotFound.
	Delete(ctx context.Context, key string) error
}

// keyRE is the whole key grammar: exactly two safe segments. No dots, so
// "." and ".." can't appear; no slashes inside a segment.
var keyRE = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,128}$`)

// ValidKey reports whether key has the {kind}/{id} shape stores accept.
func ValidKey(key string) bool { return keyRE.MatchString(key) }
