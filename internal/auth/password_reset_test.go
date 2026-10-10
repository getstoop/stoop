package auth_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/mail"
)

// resetAccount inserts an account whose confirmed address is address, with
// no password, as a provider sign-up would leave it.
func resetAccount(t *testing.T, pool *pgxpool.Pool, username, role, kind, address string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, role, kind, email, email_confirmed_at) VALUES ($1, $2, $3, $4, $5, now())`,
		id, username, role, kind, address); err != nil {
		t.Fatal(err)
	}
	return id
}

// confirmAddress gives an existing account a confirmed address.
func confirmAddress(t *testing.T, pool *pgxpool.Pool, userID, address string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET email = $2, email_confirmed_at = now() WHERE id = $1`, userID, address); err != nil {
		t.Fatal(err)
	}
}

func requestReset(svc *auth.Service, address string) error {
	_, err := svc.RequestPasswordReset(context.Background(), connect.NewRequest(&authv1.RequestPasswordResetRequest{Email: address}))
	return err
}

func completeReset(svc *auth.Service, token, newPassword string, revokeTokens bool) error {
	_, err := svc.CompletePasswordReset(context.Background(), connect.NewRequest(&authv1.CompletePasswordResetRequest{
		Token: token, NewPassword: newPassword, RevokePersonalTokens: revokeTokens,
	}))
	return err
}

func resetUsername(svc *auth.Service, token string) (string, error) {
	res, err := svc.GetPasswordReset(context.Background(), connect.NewRequest(&authv1.GetPasswordResetRequest{Token: token}))
	if err != nil {
		return "", err
	}
	return res.Msg.Username, nil
}

// resetLinkToken builds userID's reset email, marks it sent, and returns
// the token in its link.
func resetLinkToken(t *testing.T, svc *auth.Service, userID string) string {
	t.Helper()
	msg, err := svc.BuildPasswordReset(context.Background(), mail.JobArgs{Template: mail.TemplatePasswordReset, UserID: userID}, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if err := msg.OnSent(context.Background()); err != nil {
		t.Fatal(err)
	}
	const prefix = "https://chat.example.com/reset-password?token="
	start := strings.Index(msg.Text, prefix)
	if start < 0 {
		t.Fatalf("no reset link in %q", msg.Text)
	}
	token, _, _ := strings.Cut(msg.Text[start+len(prefix):], "\n")
	return token
}

// buildRequested builds the reset email for a job queued by
// RequestPasswordReset: its recipient, or "" when nothing is sent.
func buildRequested(t *testing.T, svc *auth.Service, args mail.JobArgs) string {
	t.Helper()
	msg, err := svc.BuildPasswordReset(context.Background(), args, emailSite)
	if errors.Is(err, mail.ErrNothingToSend) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return msg.To
}

// Every well-formed address gets the same reply and exactly one job,
// carrying the address alone; the job sends only to the confirmed address
// of an active person who may sign in with a password.
func TestRequestPasswordResetEligibility(t *testing.T) {
	svc, pool, jobs := emailService(t)
	policy := &fakePasswordPolicy{policy: auth.PasswordEveryone}
	svc.UsePasswordPolicy(policy)
	resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	resetAccount(t, pool, "ada", "admin", "person", "ada@example.com")
	beaID := resetAccount(t, pool, "bea", "member", "person", "bea@example.com")
	if _, err := pool.Exec(context.Background(), `UPDATE users SET deactivated_at = now() WHERE id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	resetAccount(t, pool, "backup_bot", "member", "bot", "bot@example.net")
	emailUser(t, pool, "pending_casey", "pending@example.com")

	for _, test := range []struct {
		name, policy, address string
		wantJob, wantTo       string
	}{
		{"no account", auth.PasswordEveryone, "nobody@example.com", "nobody@example.com", ""},
		{"confirmed, any case, trimmed", auth.PasswordEveryone, "  CASEY@Example.com ", "casey@example.com", "casey@example.com"},
		{"pending address only", auth.PasswordEveryone, "pending@example.com", "pending@example.com", ""},
		{"deactivated", auth.PasswordEveryone, "bea@example.com", "bea@example.com", ""},
		{"bot", auth.PasswordEveryone, "bot@example.net", "bot@example.net", ""},
		{"admins only, member", auth.PasswordAdmins, "casey@example.com", "casey@example.com", ""},
		{"admins only, admin", auth.PasswordAdmins, "ada@example.com", "ada@example.com", "ada@example.com"},
		{"passwords off, admin", auth.PasswordOff, "ada@example.com", "ada@example.com", ""},
	} {
		policy.policy = test.policy
		before := len(jobs.queued())
		if err := requestReset(svc, test.address); err != nil {
			t.Errorf("%s: %v", test.name, err)
			continue
		}
		queued := jobs.queued()[before:]
		want := mail.JobArgs{Template: mail.TemplatePasswordReset, Email: test.wantJob}
		if len(queued) != 1 || queued[0] != want {
			t.Errorf("%s: queued %+v, want %+v", test.name, queued, want)
			continue
		}
		if to := buildRequested(t, svc, queued[0]); to != test.wantTo {
			t.Errorf("%s: sent to %q, want %q", test.name, to, test.wantTo)
		}
	}

	for _, malformed := range []string{"   ", "casey", "Casey <casey@example.com>"} {
		if err := requestReset(svc, malformed); connect.CodeOf(err) != connect.CodeInvalidArgument || fieldOf(err) != "email" {
			t.Errorf("%q: err = %v, want invalid_argument on email", malformed, err)
		}
	}
	svc.UseLinkBase(func(context.Context) (string, error) { return "", nil })
	if err := requestReset(svc, "casey@example.com"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("no public URL: err = %v, want failed_precondition", err)
	}
	svc.UseLinkBase(func(context.Context) (string, error) { return "https://chat.example.com", nil })
	svc.UseEmailPorts(jobs, func(context.Context) (bool, error) { return false, nil })
	if err := requestReset(svc, "casey@example.com"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("email off: err = %v, want failed_precondition", err)
	}
}

// The reply is the same bytes for an unknown, an ineligible, an
// over-the-limit and an eligible address; only the eligible one is sent.
func TestRequestPasswordResetRepliesAlike(t *testing.T) {
	svc, pool, jobs := emailService(t)
	svc.UsePasswordResetThrottle(&perKeyLimit{limit: 1, used: map[string]int{}})
	resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	resetAccount(t, pool, "backup_bot", "member", "bot", "bot@example.net")
	adaID := resetAccount(t, pool, "ada", "member", "person", "ada@example.com")
	if _, err := svc.BuildPasswordReset(context.Background(),
		mail.JobArgs{Template: mail.TemplatePasswordReset, Email: "ada@example.com"}, emailSite); err != nil {
		t.Fatalf("ada's first reset: %v", err)
	}

	var replies [][]byte
	for _, test := range []struct{ name, address, wantTo string }{
		{"unknown", "nobody@example.com", ""},
		{"ineligible", "bot@example.net", ""},
		{"over the limit", "ada@example.com", ""},
		{"eligible", "casey@example.com", "casey@example.com"},
	} {
		before := len(jobs.queued())
		res, err := svc.RequestPasswordReset(context.Background(),
			connect.NewRequest(&authv1.RequestPasswordResetRequest{Email: test.address}))
		if err != nil {
			t.Fatalf("%s: %v", test.name, err)
		}
		reply, err := proto.Marshal(res.Msg)
		if err != nil {
			t.Fatal(err)
		}
		replies = append(replies, append(reply, []byte(fmt.Sprint(res.Header()))...))
		queued := jobs.queued()[before:]
		if len(queued) != 1 {
			t.Fatalf("%s: %d jobs queued, want 1", test.name, len(queued))
		}
		if to := buildRequested(t, svc, queued[0]); to != test.wantTo {
			t.Errorf("%s: sent to %q, want %q", test.name, to, test.wantTo)
		}
	}
	for i, reply := range replies[1:] {
		if !bytes.Equal(reply, replies[0]) {
			t.Errorf("reply %d = %q, want %q", i+1, reply, replies[0])
		}
	}
	if got := countTokens(t, pool, adaID); got != 1 {
		t.Errorf("ada has %d links, want only the first", got)
	}
}

// Past three an hour the job sends nothing; a retry of a job that took
// its share does not take another.
func TestBuildPasswordResetLimit(t *testing.T) {
	svc, pool, _ := emailService(t)
	svc.UsePasswordResetThrottle(&allowN{left: 3})
	resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	args := mail.JobArgs{Template: mail.TemplatePasswordReset, Email: "casey@example.com"}
	var sent int
	for range 4 {
		if buildRequested(t, svc, args) != "" {
			sent++
		}
	}
	if sent != 3 {
		t.Errorf("%d sent, want 3", sent)
	}
	retry := emailSite
	retry.Attempt = 2
	if _, err := svc.BuildPasswordReset(context.Background(), args, retry); err != nil {
		t.Errorf("a retry over the limit: err = %v, want it sent", err)
	}
}

// The link goes to the confirmed address, lasts an hour, is stored only
// as its hash, and retires older reset links (not confirmation links)
// only once it is sent.
func TestBuildPasswordReset(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	confirmToken := mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))
	args := mail.JobArgs{Template: mail.TemplatePasswordReset, UserID: caseyID}

	before := time.Now()
	first, err := svc.BuildPasswordReset(ctx, args, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if first.To != "casey@example.com" || first.Subject != "Reset your password on Example Stoop" {
		t.Errorf("message = %+v", first)
	}
	if !strings.Contains(first.HTML, ">Reset password</a>") || !strings.Contains(first.Text, "expires in 1 hour") {
		t.Errorf("message lacks the button or the lifetime: %q", first.Text)
	}
	stored := emailTokens(t, pool, caseyID)
	var reset []storedEmailToken
	for _, token := range stored {
		if token.purpose == "reset_password" {
			reset = append(reset, token)
		}
	}
	if len(reset) != 1 || reset[0].address != "casey@example.com" {
		t.Fatalf("reset tokens = %+v", reset)
	}
	if lifetime := reset[0].expires.Sub(before); lifetime < time.Hour-time.Minute || lifetime > time.Hour+time.Minute {
		t.Errorf("expires in %s, want 1 h", lifetime)
	}

	second, err := svc.BuildPasswordReset(ctx, args, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(emailTokens(t, pool, caseyID)); got != 3 {
		t.Errorf("%d tokens before the second is sent, want 3", got)
	}
	if err := second.OnSent(ctx); err != nil {
		t.Fatal(err)
	}
	stored = emailTokens(t, pool, caseyID)
	if len(stored) != 2 {
		t.Fatalf("%d tokens after sending, want the confirmation and the newest reset", len(stored))
	}
	confirmSum := sha256.Sum256([]byte(confirmToken))
	var keptConfirm bool
	for _, token := range stored {
		keptConfirm = keptConfirm || string(token.hash) == string(confirmSum[:])
	}
	if !keptConfirm {
		t.Error("sending a reset link retired a confirmation link")
	}
}

func TestBuildPasswordResetRefusals(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	adaID := emailUser(t, pool, "ada", "ada@example.com")
	beaID := resetAccount(t, pool, "bea", "member", "person", "bea@example.com")
	if _, err := pool.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE id = $1`, beaID); err != nil {
		t.Fatal(err)
	}
	botID := resetAccount(t, pool, "backup_bot", "member", "bot", "bot@example.net")
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	for _, test := range []struct {
		name   string
		userID string
		site   mail.Site
		want   error
	}{
		{"pending address only", adaID, emailSite, mail.ErrNothingToSend},
		{"deactivated", beaID, emailSite, mail.ErrNothingToSend},
		{"bot", botID, emailSite, mail.ErrNothingToSend},
		{"no such user", uuid.NewString(), emailSite, mail.ErrNothingToSend},
		{"no public address", caseyID, mail.Site{InstanceName: "Example Stoop"}, mail.ErrNoPublicURL},
	} {
		_, err := svc.BuildPasswordReset(ctx, mail.JobArgs{Template: mail.TemplatePasswordReset, UserID: test.userID}, test.site)
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

// GetPasswordReset names the account without using the link up, and
// refuses every dead link with one message.
func TestGetPasswordReset(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	token := resetLinkToken(t, svc, caseyID)
	for range 2 {
		if name, err := resetUsername(svc, token); err != nil || name != "casey" {
			t.Fatalf("GetPasswordReset = %q, %v; want casey", name, err)
		}
	}

	spent := func(name, token string) {
		t.Helper()
		_, err := resetUsername(svc, token)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "This link has expired or was already used.") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	spent("empty", "")
	spent("unknown", "not-a-token")
	spent("a confirmation link", mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(time.Hour)))

	expired := resetLinkToken(t, svc, caseyID)
	if _, err := pool.Exec(ctx, `UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE purpose = 'reset_password'`); err != nil {
		t.Fatal(err)
	}
	spent("expired", expired)

	moved := resetLinkToken(t, svc, caseyID)
	confirmAddress(t, pool, caseyID, "casey@example.net")
	spent("address changed", moved)

	deactivated := resetLinkToken(t, svc, caseyID)
	if _, err := pool.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE id = $1`, caseyID); err != nil {
		t.Fatal(err)
	}
	spent("deactivated", deactivated)
}

func countCredentials(t *testing.T, pool *pgxpool.Pool, userID, kind string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM credentials WHERE holder_id = $1 AND kind = $2`, userID, kind).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func addPersonalToken(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	sum := sha256.Sum256([]byte(uuid.NewString()))
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO credentials (id, holder_id, kind, token_hash, grants) VALUES ($1, $2, 'personal_token', $3, '{}')`,
		uuid.NewString(), userID, sum[:]); err != nil {
		t.Fatal(err)
	}
}

// A reset sets the password, signs every session out, keeps personal
// tokens unless asked, lifts a lockout, uses the link up and tells the
// address.
func TestCompletePasswordReset(t *testing.T) {
	svc, pool, jobs := emailService(t)
	ctx := context.Background()
	_, sessionToken := signIn(t, svc, "casey", casePassword)
	caseyID, err := svc.VerifyToken(ctx, sessionToken)
	if err != nil {
		t.Fatal(err)
	}
	userID := caseyID.UserID
	confirmAddress(t, pool, userID, "casey@example.com")
	addPersonalToken(t, pool, userID)
	for range 5 {
		_, _ = svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "casey", Password: "wrong"}))
	}

	token := resetLinkToken(t, svc, userID)
	// A newer link, built but not yet sent, dies with the reset too.
	if _, err := svc.BuildPasswordReset(ctx, mail.JobArgs{Template: mail.TemplatePasswordReset, UserID: userID}, emailSite); err != nil {
		t.Fatal(err)
	}

	err = completeReset(svc, token, "short", false)
	if connect.CodeOf(err) != connect.CodeInvalidArgument || fieldOf(err) != "new_password" || !strings.HasSuffix(err.Error(), ".") {
		t.Errorf("short password: err = %v", err)
	}
	before := time.Now()
	if err := completeReset(svc, token, "a brand new password", false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyToken(ctx, sessionToken); err == nil {
		t.Error("the old session still verifies")
	}
	if countCredentials(t, pool, userID, "session") != 0 || countCredentials(t, pool, userID, "personal_token") != 1 {
		t.Error("want no sessions and the personal token kept")
	}
	if _, err := svc.Login(ctx, connect.NewRequest(&authv1.LoginRequest{Username: "casey", Password: "a brand new password"})); err != nil {
		t.Errorf("login with the new password after a lockout: %v", err)
	}
	if err := completeReset(svc, token, "another new password", false); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("reused link: err = %v, want failed_precondition", err)
	}
	var unused int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_tokens WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&unused); err != nil {
		t.Fatal(err)
	}
	if unused != 0 {
		t.Errorf("%d other reset links left after the reset, want 0", unused)
	}

	var notice *mail.JobArgs
	for _, args := range jobs.queued() {
		if args.Template == mail.TemplatePasswordChanged {
			notice = &args
		}
	}
	if notice == nil || notice.UserID != userID || notice.At.Before(before.Add(-time.Second)) || notice.At.After(time.Now()) {
		t.Errorf("password_changed job = %+v", notice)
	}

	// Asked to, it revokes personal tokens too.
	if err := completeReset(svc, resetLinkToken(t, svc, userID), "a third new password", true); err != nil {
		t.Fatal(err)
	}
	if countCredentials(t, pool, userID, "personal_token") != 0 {
		t.Error("personal tokens kept though revoking them was asked")
	}
}

// An account made through a login provider gets its first password.
func TestCompletePasswordResetGivesAFirstPassword(t *testing.T) {
	svc, pool, _ := emailService(t)
	adaID := resetAccount(t, pool, "ada", "member", "person", "ada@example.com")
	if err := completeReset(svc, resetLinkToken(t, svc, adaID), casePassword, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(context.Background(), connect.NewRequest(&authv1.LoginRequest{Username: "ada", Password: casePassword})); err != nil {
		t.Errorf("login with the first password: %v", err)
	}
}

func TestBuildPasswordChanged(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	changedAt := time.Date(2026, time.October, 10, 1, 20, 0, 0, time.UTC)
	msg, err := svc.BuildPasswordChanged(ctx, mail.JobArgs{Template: mail.TemplatePasswordChanged, UserID: caseyID, At: changedAt}, emailSite)
	if err != nil {
		t.Fatal(err)
	}
	if msg.To != "casey@example.com" || msg.Subject != "Your password on Example Stoop was changed" || msg.OnSent != nil {
		t.Errorf("message = %+v", msg)
	}
	for _, part := range []string{msg.Text, msg.HTML} {
		if !strings.Contains(part, "@casey on Example Stoop was reset on 10 October 2026 at 01:20 UTC") ||
			!strings.Contains(part, "https://chat.example.com/forgot-password") {
			t.Errorf("part = %q", part)
		}
	}
	adaID := emailUser(t, pool, "ada", "ada@example.com")
	if _, err := svc.BuildPasswordChanged(ctx, mail.JobArgs{Template: mail.TemplatePasswordChanged, UserID: adaID}, emailSite); !errors.Is(err, mail.ErrNothingToSend) {
		t.Errorf("no confirmed address: err = %v, want ErrNothingToSend", err)
	}
}
