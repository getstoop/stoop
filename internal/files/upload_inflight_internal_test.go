package files

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
)

type fixedSession struct{ userID string }

func (session fixedSession) VerifyRequest(context.Context, http.Header) (authctx.Identity, error) {
	return authctx.Identity{UserID: session.userID, Role: authctx.RoleMember}, nil
}

type watchedBody struct{ reads int }

func (body *watchedBody) Read([]byte) (int, error) {
	body.reads++
	return 0, io.EOF
}

// An account with every in-flight slot held is refused before its body is
// read, so nothing of it reaches disk.
func TestUploadRefusedAtLimitWithoutReadingBody(t *testing.T) {
	svc := &Service{
		sessions: fixedSession{userID: "casey"},
		inflight: newInflight(MaxInflightUploads),
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	for range MaxInflightUploads {
		if !svc.inflight.acquire("casey") {
			t.Fatal("could not take a slot")
		}
	}
	body := &watchedBody{}
	req := httptest.NewRequest(http.MethodPost, "/files/upload", body)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	rec := httptest.NewRecorder()
	svc.UploadHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", rec.Code)
	}
	if body.reads != 0 {
		t.Errorf("body was read %d times before the refusal", body.reads)
	}
}

// An admitted upload gives its slot back when the request ends, however
// it ends.
func TestUploadReleasesItsSlot(t *testing.T) {
	svc := &Service{
		sessions: fixedSession{userID: "casey"},
		inflight: newInflight(MaxInflightUploads),
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	for range MaxInflightUploads + 1 {
		req := httptest.NewRequest(http.MethodPost, "/files/upload", &watchedBody{})
		req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
		rec := httptest.NewRecorder()
		svc.UploadHandler().ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 for an empty form", rec.Code)
		}
	}
	for range MaxInflightUploads {
		if !svc.inflight.acquire("casey") {
			t.Fatal("a finished upload kept its slot")
		}
	}
}

// An upload that stops sending is ended, and its slot comes back.
func TestStalledUploadIsEndedAndReleasesItsSlot(t *testing.T) {
	svc := &Service{
		sessions:   fixedSession{userID: "casey"},
		inflight:   newInflight(MaxInflightUploads),
		uploadIdle: 100 * time.Millisecond,
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	srv := httptest.NewServer(svc.UploadHandler())
	defer srv.Close()

	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	// Headers that promise a body, its first bytes, and then nothing.
	request := "POST /files/upload HTTP/1.1\r\nHost: stoop\r\n" +
		"Content-Type: multipart/form-data; boundary=x\r\nContent-Length: 1000\r\n\r\n--x\r\n"
	if _, err := io.WriteString(conn, request); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	res, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("a stalled upload was never answered: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusRequestTimeout {
		t.Errorf("status = %d, want 408", res.StatusCode)
	}
	for range MaxInflightUploads {
		if !svc.inflight.acquire("casey") {
			t.Fatal("the stalled upload kept its slot")
		}
	}
}
