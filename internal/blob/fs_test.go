package blob_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jhut89/stoop/internal/blob"
)

func newStore(t *testing.T) (*blob.FS, string) {
	t.Helper()
	root := t.TempDir()
	s, err := blob.NewFS(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Root()
}

func TestOpenRange(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	body := []byte("0123456789")
	if err := s.Put(ctx, "attachment/r", bytes.NewReader(body), int64(len(body)), ""); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		offset, length int64
		want           string
	}{
		{0, -1, "0123456789"}, // whole blob
		{3, -1, "3456789"},    // from an offset to the end
		{2, 4, "2345"},        // a window
		{8, 10, "89"},         // a window past the end reads short
		{10, -1, ""},          // at the end: empty, not an error
	}
	for _, c := range cases {
		rc, st, err := s.OpenRange(ctx, "attachment/r", c.offset, c.length)
		if err != nil {
			t.Fatalf("OpenRange(%d, %d): %v", c.offset, c.length, err)
		}
		got, _ := io.ReadAll(rc)
		_ = rc.Close()
		if string(got) != c.want || st.Size != int64(len(body)) {
			t.Errorf("OpenRange(%d, %d) = %q (size %d), want %q (size %d)", c.offset, c.length, got, st.Size, c.want, len(body))
		}
	}
	if _, _, err := s.OpenRange(ctx, "attachment/missing", 0, -1); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("missing key: want ErrNotFound, got %v", err)
	}
	if _, _, err := s.OpenRange(ctx, "attachment/r", -1, -1); err == nil {
		t.Error("negative offset: want an error")
	}
}

func TestPutOpenStatDelete(t *testing.T) {
	ctx := context.Background()
	s, root := newStore(t)
	body := []byte("hello, blob")

	if err := s.Put(ctx, "avatar/abc123", bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatalf("put: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "avatar", "abc123")); err != nil {
		t.Fatalf("blob not at the expected path: %v", err)
	}

	rc, st, err := s.Open(ctx, "avatar/abc123")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, _ := io.ReadAll(rc)
	_ = rc.Close()
	if !bytes.Equal(got, body) || st.Size != int64(len(body)) {
		t.Fatalf("open returned %q (size %d)", got, st.Size)
	}
	if st, err := s.Stat(ctx, "avatar/abc123"); err != nil || st.Size != int64(len(body)) {
		t.Fatalf("stat: %v %+v", err, st)
	}

	if err := s.Delete(ctx, "avatar/abc123"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := s.Open(ctx, "avatar/abc123"); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("open after delete: want ErrNotFound, got %v", err)
	}
	if err := s.Delete(ctx, "avatar/abc123"); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("second delete: want ErrNotFound, got %v", err)
	}
}

func TestOpenMissingIsNotFound(t *testing.T) {
	s, _ := newStore(t)
	if _, _, err := s.Open(context.Background(), "avatar/nope"); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := s.Stat(context.Background(), "avatar/nope"); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("stat: want ErrNotFound, got %v", err)
	}
}

func TestPutReplacesAtomically(t *testing.T) {
	ctx := context.Background()
	s, root := newStore(t)
	put := func(b string) {
		t.Helper()
		if err := s.Put(ctx, "avatar/k", strings.NewReader(b), int64(len(b)), ""); err != nil {
			t.Fatal(err)
		}
	}
	put("first")
	put("second, longer")
	rc, st, err := s.Open(ctx, "avatar/k")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(got) != "second, longer" || st.Size != 14 {
		t.Fatalf("got %q", got)
	}
	// No temp files left behind after a successful write.
	entries, _ := os.ReadDir(filepath.Join(root, "avatar"))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".put-") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}

func TestPutSizeMismatchLeavesNothing(t *testing.T) {
	ctx := context.Background()
	s, root := newStore(t)
	err := s.Put(ctx, "avatar/short", strings.NewReader("abc"), 10, "")
	if !errors.Is(err, blob.ErrSizeMismatch) {
		t.Fatalf("short reader: want ErrSizeMismatch, got %v", err)
	}
	err = s.Put(ctx, "avatar/long", strings.NewReader("abcdef"), 3, "")
	if !errors.Is(err, blob.ErrSizeMismatch) {
		t.Fatalf("long reader: want ErrSizeMismatch, got %v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(root, "avatar"))
	if len(entries) != 0 {
		t.Fatalf("expected an empty dir, found %d entries", len(entries))
	}
}

func TestKeysCannotTraverse(t *testing.T) {
	ctx := context.Background()
	s, root := newStore(t)
	bad := []string{
		"", "avatar", "/avatar/x", "avatar/../x", "../avatar/x", "avatar/x/y",
		"avatar/.", "avatar/..", "avatar/x.png", "avatar\\x", "a b/x", "avatar/",
	}
	for _, key := range bad {
		if blob.ValidKey(key) {
			t.Errorf("ValidKey(%q) = true", key)
		}
		if err := s.Put(ctx, key, strings.NewReader("x"), 1, ""); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("Put(%q): want ErrInvalidKey, got %v", key, err)
		}
		if _, _, err := s.Open(ctx, key); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("Open(%q): want ErrInvalidKey, got %v", key, err)
		}
		if err := s.Delete(ctx, key); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("Delete(%q): want ErrInvalidKey, got %v", key, err)
		}
	}
	// Nothing escaped the root.
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "x")); err == nil {
		t.Fatal("a file was written outside the root")
	}
	for _, key := range []string{"avatar/01ARZ3NDEKTSV4RRFFQ69G5FAV", "space_icon/0199b0c4-1d2e-7f3a-8b4c-5d6e7f8a9b0c"} {
		if !blob.ValidKey(key) {
			t.Errorf("ValidKey(%q) = false", key)
		}
	}
}
