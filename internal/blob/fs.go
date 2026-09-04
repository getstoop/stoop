package blob

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FS stores blobs as files under a root directory: key "{kind}/{id}"
// becomes "{root}/{kind}/{id}". Writes go to a temp file in the same
// directory and are renamed into place, so a reader never sees a partial
// blob and a crash mid-write leaves only a stray ".put-*" temp file.
type FS struct {
	root string
}

// NewFS creates the root directory if needed and returns a store rooted
// there. The root should be a dedicated directory (STOOP_STORAGE_DIR): it
// is the second thing to back up next to Postgres.
func NewFS(root string) (*FS, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("blob: resolve %q: %w", root, err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("blob: create %q: %w", abs, err)
	}
	return &FS{root: abs}, nil
}

// Root is the absolute directory blobs live under.
func (s *FS) Root() string { return s.root }

// path maps a key to its file, refusing anything outside the grammar. The
// regexp already forbids separators and dots inside segments; the prefix
// check is belt and braces.
func (s *FS) path(key string) (string, error) {
	if !ValidKey(key) {
		return "", ErrInvalidKey
	}
	p := filepath.Join(s.root, filepath.FromSlash(key))
	if !strings.HasPrefix(p, s.root+string(filepath.Separator)) {
		return "", ErrInvalidKey
	}
	return p, nil
}

func (s *FS) Put(_ context.Context, key string, r io.Reader, size int64, _ string) (err error) {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("blob: create %q: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".put-*")
	if err != nil {
		return fmt.Errorf("blob: create temp file: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	// Read one byte past the declared size so an over-long reader is
	// detected rather than silently truncated.
	n, err := io.Copy(tmp, io.LimitReader(r, size+1))
	if err != nil {
		return fmt.Errorf("blob: write: %w", err)
	}
	if n != size {
		return ErrSizeMismatch
	}
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("blob: sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("blob: close: %w", err)
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return fmt.Errorf("blob: chmod: %w", err)
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		return fmt.Errorf("blob: rename into place: %w", err)
	}
	return nil
}

func (s *FS) Open(_ context.Context, key string) (io.ReadCloser, Stat, error) {
	p, err := s.path(key)
	if err != nil {
		return nil, Stat{}, err
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, Stat{}, mapErr(err)
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, Stat{}, mapErr(err)
	}
	return f, statOf(info), nil
}

// OpenRange seeks the file to offset and, when length is non-negative,
// caps the reader at length bytes.
func (s *FS) OpenRange(ctx context.Context, key string, offset, length int64) (io.ReadCloser, Stat, error) {
	if offset < 0 {
		return nil, Stat{}, fmt.Errorf("blob: negative offset %d", offset)
	}
	f, st, err := s.Open(ctx, key)
	if err != nil {
		return nil, Stat{}, err
	}
	file := f.(*os.File)
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		_ = file.Close()
		return nil, Stat{}, fmt.Errorf("blob: seek: %w", err)
	}
	if length < 0 {
		return file, st, nil
	}
	return &window{Reader: io.LimitReader(file, length), Closer: file}, st, nil
}

// window is a length-capped view of an open file that still closes it.
type window struct {
	io.Reader
	io.Closer
}

func (s *FS) Stat(_ context.Context, key string) (Stat, error) {
	p, err := s.path(key)
	if err != nil {
		return Stat{}, err
	}
	info, err := os.Stat(p)
	if err != nil {
		return Stat{}, mapErr(err)
	}
	return statOf(info), nil
}

func (s *FS) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil {
		return mapErr(err)
	}
	return nil
}

// Walk visits every blob under the root as "{kind}/{id}". Temp files left
// by a crashed Put (".put-*") are not blobs: ones older than an hour are
// removed on the way past, younger ones skipped (a Put may be mid-write).
func (s *FS) Walk(ctx context.Context, fn func(key string, st Stat) error) error {
	return filepath.WalkDir(s.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if strings.HasPrefix(d.Name(), ".put-") {
			if time.Since(info.ModTime()) > time.Hour {
				_ = os.Remove(p)
			}
			return nil
		}
		rel, err := filepath.Rel(s.root, p)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(rel)
		if !ValidKey(key) {
			return nil // not ours; leave it alone
		}
		return fn(key, statOf(info))
	})
}

func statOf(info fs.FileInfo) Stat {
	return Stat{Size: info.Size(), ModTime: info.ModTime()}
}

func mapErr(err error) error {
	if errors.Is(err, fs.ErrNotExist) {
		return ErrNotFound
	}
	return err
}
