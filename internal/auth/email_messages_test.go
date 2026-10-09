package auth_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/mail"
)

var emailSite = mail.Site{PublicURL: "https://chat.example.com/", InstanceName: "Example Stoop"}

// emailUser inserts a person with a pending address ("" for none).
func emailUser(t *testing.T, pool *pgxpool.Pool, username, pending string) string {
	t.Helper()
	id := uuid.NewString()
	var pendingEmail *string
	if pending != "" {
		pendingEmail = &pending
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, role, kind, pending_email) VALUES ($1, $2, 'member', 'person', $3)`,
		id, username, pendingEmail); err != nil {
		t.Fatal(err)
	}
	return id
}

type storedEmailToken struct {
	hash    []byte
	purpose string
	address string
	expires time.Time
}

func emailTokens(t *testing.T, pool *pgxpool.Pool, userID string) []storedEmailToken {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT token_hash, purpose, address, expires_at FROM email_tokens WHERE user_id = $1`, userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var tokens []storedEmailToken
	for rows.Next() {
		var token storedEmailToken
		if err := rows.Scan(&token.hash, &token.purpose, &token.address, &token.expires); err != nil {
			t.Fatal(err)
		}
		tokens = append(tokens, token)
	}
	return tokens
}

// linkToken is the token in a confirmation message's link.
func linkToken(t *testing.T, msg mail.Message) string {
	t.Helper()
	const prefix = "https://chat.example.com/confirm-email?token="
	start := strings.Index(msg.Text, prefix)
	if start < 0 {
		t.Fatalf("no link in %q", msg.Text)
	}
	token, _, _ := strings.Cut(msg.Text[start+len(prefix):], "\n")
	return token
}

// A confirmation goes to the pending address with a link whose token is
// stored only as its hash; a second one revokes the first.
func TestBuildConfirmEmail(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	adaID := emailUser(t, pool, "ada", "ada@example.com")
	args := mail.JobArgs{Template: mail.TemplateConfirmEmail, UserID: adaID}

	before := time.Now()
	first, err := svc.BuildConfirmEmail(ctx, args, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if first.To != "ada@example.com" || first.Subject != "Confirm your email for Example Stoop" || first.HTML != "" {
		t.Errorf("message = %+v", first)
	}
	if !strings.Contains(first.Text, "@ada on Example Stoop") {
		t.Errorf("text = %q", first.Text)
	}
	firstToken := linkToken(t, first)
	if len(firstToken) != 43 {
		t.Errorf("token %q is %d characters, want 43", firstToken, len(firstToken))
	}
	stored := emailTokens(t, pool, adaID)
	if len(stored) != 1 {
		t.Fatalf("%d tokens stored, want 1", len(stored))
	}
	sum := sha256.Sum256([]byte(firstToken))
	if string(stored[0].hash) != string(sum[:]) || stored[0].purpose != "confirm_email" || stored[0].address != "ada@example.com" {
		t.Errorf("stored = %+v", stored[0])
	}
	if lifetime := stored[0].expires.Sub(before); lifetime < 24*time.Hour-time.Minute || lifetime > 24*time.Hour+time.Minute {
		t.Errorf("expires in %s, want 24 h", lifetime)
	}

	second, err := svc.BuildConfirmEmail(ctx, args, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	secondToken := linkToken(t, second)
	stored = emailTokens(t, pool, adaID)
	sum = sha256.Sum256([]byte(secondToken))
	if secondToken == firstToken || len(stored) != 1 || string(stored[0].hash) != string(sum[:]) {
		t.Errorf("after a second build: %d tokens stored, want only the newest", len(stored))
	}

	// A used token is kept: only unused ones are revoked.
	if _, err := pool.Exec(ctx, `UPDATE email_tokens SET used_at = now() WHERE user_id = $1`, adaID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BuildConfirmEmail(ctx, args, emailSite); err != nil {
		t.Fatal(err)
	}
	if stored = emailTokens(t, pool, adaID); len(stored) != 2 {
		t.Errorf("%d tokens after a used one, want 2", len(stored))
	}
}

// Nothing to confirm finishes the job; no public address refuses it,
// and neither mints a token.
func TestBuildConfirmEmailRefusals(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	beaID := emailUser(t, pool, "bea", "")
	caseyID := emailUser(t, pool, "casey", "casey@example.com")
	if _, err := pool.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE id = $1`, caseyID); err != nil {
		t.Fatal(err)
	}
	adaID := emailUser(t, pool, "ada", "ada@example.com")

	for _, test := range []struct {
		name   string
		userID string
		site   mail.Site
		want   error
	}{
		{"no pending address", beaID, emailSite, mail.ErrNothingToSend},
		{"deactivated", caseyID, emailSite, mail.ErrNothingToSend},
		{"no such user", uuid.NewString(), emailSite, mail.ErrNothingToSend},
		{"not an id", "not-a-uuid", emailSite, mail.ErrNothingToSend},
		{"no public address", adaID, mail.Site{InstanceName: "Example Stoop"}, mail.ErrNoPublicURL},
	} {
		_, err := svc.BuildConfirmEmail(ctx, mail.JobArgs{Template: mail.TemplateConfirmEmail, UserID: test.userID}, test.site)
		if !errors.Is(err, test.want) {
			t.Errorf("%s: err = %v, want %v", test.name, err, test.want)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_tokens`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("%d tokens minted by refused builds, want 0", count)
	}
}

// The notice goes to the old address and carries no link.
func TestBuildEmailChanged(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	ctx := context.Background()
	adaID := emailUser(t, pool, "ada", "")

	msg, err := svc.BuildEmailChanged(ctx, mail.JobArgs{Template: mail.TemplateEmailChanged, UserID: adaID, OldAddress: "ada@example.net"}, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if msg.To != "ada@example.net" || msg.Subject != "Your email on Example Stoop was changed" {
		t.Errorf("message = %+v", msg)
	}
	if !strings.Contains(msg.Text, "@ada on Example Stoop") || strings.Contains(msg.Text, "http") {
		t.Errorf("text = %q", msg.Text)
	}
	if _, err := svc.BuildEmailChanged(ctx, mail.JobArgs{Template: mail.TemplateEmailChanged, UserID: adaID}, emailSite); !errors.Is(err, mail.ErrNothingToSend) {
		t.Errorf("no old address: err = %v, want ErrNothingToSend", err)
	}
}
