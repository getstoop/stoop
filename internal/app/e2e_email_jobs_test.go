package app_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	netmail "net/mail"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/jobs"
	"github.com/getstoop/stoop/internal/mail"
	"github.com/getstoop/stoop/internal/mail/mailtest"
)

var confirmLink = regexp.MustCompile(`https://chat\.example\.com/confirm-email\?token=([A-Za-z0-9_-]+)`)

// A send_email job builds its confirmation when it runs: the link
// arrives by email, and the token in it is nowhere in the job's row or
// the database, which keeps only its SHA-256.
func TestE2EConfirmEmailJob(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	stoop := newHarnessOn(t, databaseURL, "STOOP_PUBLIC_URL", "https://chat.example.com")
	casey := stoop.person("casey")
	ada := stoop.person("ada")
	adaID := stoop.userID(ada)
	fake := mailtest.Start(t, mailtest.Options{})
	stoop.rpc(casey, email+"UpdateEmailSettings", map[string]any{"smtp": map[string]any{
		"enabled": true, "host": fake.Host, "port": fake.Port, "security": "SMTP_SECURITY_NONE",
		"fromAddress": "stoop@example.net", "hourlyLimit": 100,
	}}).expect(t, "ok")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `UPDATE users SET pending_email = 'ada@example.com', pending_email_at = now() WHERE id = $1`, adaID); err != nil {
		t.Fatal(err)
	}
	// A queue of its own to enqueue with; the server's dispatcher runs it.
	registry := jobs.NewRegistry()
	jobs.Register(registry, mail.SendEmailKind, func(context.Context, *jobs.Job, mail.JobArgs) error { return nil }, jobs.Options{})
	queue := jobs.New(pool, registry, jobs.Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID, err := queue.Enqueue(ctx, mail.SendEmailKind, mail.JobArgs{Template: mail.TemplateConfirmEmail, UserID: adaID})
	if err != nil {
		t.Fatal(err)
	}

	received := fake.Next(t)
	if len(received.To) != 1 || received.To[0] != "ada@example.com" {
		t.Fatalf("sent to %v, want ada@example.com", received.To)
	}
	_, parts := readEmailParts(t, received)
	text := parts["text/plain"]
	match := confirmLink.FindStringSubmatch(text)
	if match == nil || !strings.Contains(text, "@ada asked to use this address on") {
		t.Fatalf("no confirmation link for @ada in %q", text)
	}
	token := match[1]
	if !strings.Contains(parts["text/html"], `href="`+match[0]+`"`) {
		t.Errorf("the HTML part lacks the link: %q", parts["text/html"])
	}

	var state, args, lastError string
	deadline := time.Now().Add(10 * time.Second)
	for {
		if err := pool.QueryRow(ctx, `SELECT state, args::text, error FROM jobs WHERE id = $1`, jobID).Scan(&state, &args, &lastError); err != nil {
			t.Fatal(err)
		}
		if state == string(jobs.StateSucceeded) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job is %s, want succeeded (%s)", state, lastError)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if strings.Contains(args, token) || strings.Contains(lastError, token) {
		t.Errorf("the raw token is in the job row: args %s, error %q", args, lastError)
	}
	var hashes [][]byte
	rows, err := pool.Query(ctx, `SELECT token_hash FROM email_tokens WHERE user_id = $1`, adaID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var hash []byte
		if err := rows.Scan(&hash); err != nil {
			t.Fatal(err)
		}
		hashes = append(hashes, hash)
	}
	rows.Close()
	sum := sha256.Sum256([]byte(token))
	if len(hashes) != 1 || string(hashes[0]) != string(sum[:]) {
		t.Errorf("email_tokens holds %d rows, want the one SHA-256 of the sent token", len(hashes))
	}
	var leaks int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM email_tokens WHERE token_hash = convert_to($1, 'UTF8') OR address = $1) +
		(SELECT count(*) FROM jobs WHERE args::text LIKE '%' || $1 || '%' OR error LIKE '%' || $1 || '%') +
		(SELECT count(*) FROM instance_settings WHERE value::text LIKE '%' || $1 || '%')`,
		token).Scan(&leaks); err != nil {
		t.Fatal(err)
	}
	if leaks != 0 {
		t.Errorf("the raw token is stored in %d rows", leaks)
	}
}

// readEmail is a received message's subject and decoded text part.
func readEmail(t *testing.T, received mailtest.Received) (subject, text string) {
	t.Helper()
	subject, parts := readEmailParts(t, received)
	return subject, parts["text/plain"]
}

// readEmailParts is a received message's subject and its decoded parts
// by media type.
func readEmailParts(t *testing.T, received mailtest.Received) (subject string, parts map[string]string) {
	t.Helper()
	parsed, err := netmail.ReadMessage(strings.NewReader(received.Data))
	if err != nil {
		t.Fatal(err)
	}
	parts = map[string]string{}
	mediaType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(mediaType, "multipart/") {
		parts[mediaType] = decodeEmailBody(t, parsed.Header.Get("Content-Transfer-Encoding"), parsed.Body)
		return parsed.Header.Get("Subject"), parts
	}
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	for {
		part, err := reader.NextRawPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		partType, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if err != nil {
			t.Fatal(err)
		}
		parts[partType] = decodeEmailBody(t, part.Header.Get("Content-Transfer-Encoding"), part)
	}
	return parsed.Header.Get("Subject"), parts
}

func decodeEmailBody(t *testing.T, encoding string, body io.Reader) string {
	t.Helper()
	if strings.EqualFold(encoding, "quoted-printable") {
		body = quotedprintable.NewReader(body)
	}
	decoded, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	return string(decoded)
}
