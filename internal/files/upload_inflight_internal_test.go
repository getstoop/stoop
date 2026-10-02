package files

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

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
