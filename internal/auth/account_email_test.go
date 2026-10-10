package auth_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/mail"
)

const casePassword = "correct horse battery"

// recordedJobs keeps what was queued, as the jobs table would.
type recordedJobs struct {
	mu   sync.Mutex
	args []mail.JobArgs
}

func (r *recordedJobs) EnqueueTx(_ context.Context, _ pgx.Tx, kind string, args any) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if kind != mail.SendEmailKind {
		return "", errors.New("unexpected kind " + kind)
	}
	r.args = append(r.args, args.(mail.JobArgs))
	return uuid.NewString(), nil
}

func (r *recordedJobs) queued() []mail.JobArgs {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]mail.JobArgs(nil), r.args...)
}

// allowN lets n requests through, then refuses.
type allowN struct{ left int }

func (a *allowN) Allow(context.Context, string) (bool, error) {
	if a.left == 0 {
		return false, nil
	}
	a.left--
	return true, nil
}

func emailService(t *testing.T) (*auth.Service, *pgxpool.Pool, *recordedJobs) {
	t.Helper()
	pool := dbtest.New(t)
	svc := auth.New(pool, auth.Options{Argon2Params: testArgon2})
	jobs := &recordedJobs{}
	svc.UseEmailPorts(jobs, func(context.Context) (bool, error) { return true, nil })
	return svc, pool, jobs
}

func fieldOf(err error) string {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return ""
	}
	for _, detail := range cerr.Details() {
		if value, _ := detail.Value(); value != nil {
			if violation, ok := value.(*commonv1.FieldViolation); ok {
				return violation.Field
			}
		}
	}
	return ""
}

func requestEmail(ctx context.Context, svc *auth.Service, address, password string) (*authv1.MyEmail, error) {
	res, err := svc.RequestEmailChange(ctx, connect.NewRequest(&authv1.RequestEmailChangeRequest{Address: address, Password: password}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Email, nil
}

func myEmail(t *testing.T, ctx context.Context, svc *auth.Service) *authv1.MyEmail {
	t.Helper()
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	return me.Msg.Email
}

// mintLink stores a confirmation link for userID's address, the way the
// send_email job will, and returns the raw token.
func mintLink(t *testing.T, pool *pgxpool.Pool, userID, address string, expires time.Time) string {
	t.Helper()
	token := uuid.NewString()
	sum := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO email_tokens (id, user_id, purpose, token_hash, address, expires_at) VALUES ($1, $2, 'confirm_email', $3, $4, $5)`,
		uuid.NewString(), userID, sum[:], address, expires); err != nil {
		t.Fatal(err)
	}
	return token
}

func confirm(ctx context.Context, svc *auth.Service, token string) error {
	_, err := svc.ConfirmEmail(ctx, connect.NewRequest(&authv1.ConfirmEmailRequest{Token: token}))
	return err
}

// confirmed requests and confirms address for the caller.
func confirmed(t *testing.T, ctx context.Context, svc *auth.Service, pool *pgxpool.Pool, userID, address string) {
	t.Helper()
	if _, err := requestEmail(ctx, svc, address, casePassword); err != nil {
		t.Fatal(err)
	}
	if err := confirm(context.Background(), svc, mintLink(t, pool, userID, address, time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
}

func TestEmailAddressRules(t *testing.T) {
	svc, _, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	for _, bad := range []string{
		"", "   ", "casey", "casey@", "Casey <casey@example.com>", "<casey@example.com>",
		"casey@example.com, ada@example.com", strings.Repeat("c", 250) + "@example.com",
	} {
		_, err := requestEmail(ctx, svc, bad, casePassword)
		if codeOf(err) != connect.CodeInvalidArgument || fieldOf(err) != "address" {
			t.Errorf("%q: want invalid_argument on address, got %v", bad, err)
		}
	}
	email, err := requestEmail(ctx, svc, "  casey@example.com ", casePassword)
	if err != nil {
		t.Fatal(err)
	}
	if email.PendingAddress != "casey@example.com" || email.Address != "" {
		t.Errorf("after request: %v", email)
	}
}

func TestEmailChangeNeedsThePassword(t *testing.T) {
	svc, pool, jobs := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	for _, wrong := range []string{"", "not it"} {
		_, err := requestEmail(ctx, svc, "casey@example.com", wrong)
		if codeOf(err) != connect.CodeInvalidArgument || fieldOf(err) != "password" {
			t.Errorf("password %q: want invalid_argument on password, got %v", wrong, err)
		}
	}
	if len(jobs.queued()) != 0 {
		t.Errorf("refused requests queued %v", jobs.queued())
	}

	// An account without a password has nothing to check.
	socialCtx, socialID := socialUser(t, pool, "ada", "pocket-id")
	if _, err := requestEmail(socialCtx, svc, "ada@example.com", ""); err != nil {
		t.Fatalf("provider account: %v", err)
	}
	got := jobs.queued()
	if len(got) != 1 || got[0] != (mail.JobArgs{Template: mail.TemplateConfirmEmail, UserID: socialID}) {
		t.Errorf("queued %v", got)
	}
}

func TestEmailOff(t *testing.T) {
	svc, _, jobs := emailService(t)
	svc.UseEmailPorts(jobs, func(context.Context) (bool, error) { return false, nil })
	ctx, _ := signIn(t, svc, "casey", casePassword)
	if _, err := requestEmail(ctx, svc, "casey@example.com", casePassword); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("request with email off: %v", err)
	}
	_, err := svc.ResendEmailConfirmation(ctx, connect.NewRequest(&authv1.ResendEmailConfirmationRequest{}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("resend with email off: %v", err)
	}
}

func TestEmailRequestsAreLimited(t *testing.T) {
	svc, _, jobs := emailService(t)
	svc.UseEmailThrottle(&allowN{left: 3})
	ctx, _ := signIn(t, svc, "casey", casePassword)
	if _, err := requestEmail(ctx, svc, "casey@example.com", casePassword); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := svc.ResendEmailConfirmation(ctx, connect.NewRequest(&authv1.ResendEmailConfirmationRequest{})); err != nil {
			t.Fatal(err)
		}
	}
	_, err := svc.ResendEmailConfirmation(ctx, connect.NewRequest(&authv1.ResendEmailConfirmationRequest{}))
	var cerr *connect.Error
	if !errors.As(err, &cerr) || cerr.Code() != connect.CodeResourceExhausted || cerr.Meta().Get("Retry-After") == "" {
		t.Fatalf("4th: want resource_exhausted with Retry-After, got %v", err)
	}
	if _, err := requestEmail(ctx, svc, "casey@example.net", casePassword); codeOf(err) != connect.CodeResourceExhausted {
		t.Errorf("request after the limit: %v", err)
	}
	if len(jobs.queued()) != 3 {
		t.Errorf("queued %d, want 3", len(jobs.queued()))
	}
}

func TestResendNeedsAPendingAddress(t *testing.T) {
	svc, _, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	_, err := svc.ResendEmailConfirmation(ctx, connect.NewRequest(&authv1.ResendEmailConfirmationRequest{}))
	if codeOf(err) != connect.CodeFailedPrecondition || fieldOf(err) != "" || !strings.Contains(err.Error(), "no address waiting") {
		t.Errorf("resend with nothing pending: %v", err)
	}
}

func TestConfirmEmail(t *testing.T) {
	svc, pool, jobs := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	caseyID := userIDOf(t, ctx, svc)
	if _, err := requestEmail(ctx, svc, "casey@example.com", casePassword); err != nil {
		t.Fatal(err)
	}
	stale := mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(time.Hour))
	token := mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(time.Hour))
	if err := confirm(context.Background(), svc, token); err != nil {
		t.Fatal(err)
	}
	if got := myEmail(t, ctx, svc); got.Address != "casey@example.com" || got.PendingAddress != "" {
		t.Errorf("after confirm: %v", got)
	}
	for name, spent := range map[string]string{"used": token, "superseded": stale, "unknown": "nope", "empty": ""} {
		err := confirm(context.Background(), svc, spent)
		if codeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "expired or was already used") {
			t.Errorf("%s link: %v", name, err)
		}
	}
	// No old address, no notice.
	for _, args := range jobs.queued() {
		if args.Template == mail.TemplateEmailChanged {
			t.Errorf("a first address queued %v", args)
		}
	}

	// A change tells the old address.
	if _, err := requestEmail(ctx, svc, "casey@example.net", casePassword); err != nil {
		t.Fatal(err)
	}
	if err := confirm(context.Background(), svc, mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	got := jobs.queued()
	last := got[len(got)-1]
	if last.At.IsZero() || time.Since(last.At) > time.Minute {
		t.Errorf("notice queued with At %v, want the time of the change", last.At)
	}
	last.At = time.Time{}
	if last != (mail.JobArgs{Template: mail.TemplateEmailChanged, UserID: caseyID, OldAddress: "casey@example.com"}) {
		t.Errorf("last queued %v", last)
	}

	// Asking for the address already confirmed changes nothing.
	before := len(jobs.queued())
	email, err := requestEmail(ctx, svc, "CASEY@example.net", casePassword)
	if err != nil || email.PendingAddress != "" || email.Address != "casey@example.net" || len(jobs.queued()) != before {
		t.Errorf("same address again: %v %v", email, err)
	}
}

func TestConfirmEmailRefusesWhatIsNotItsLink(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	caseyID := userIDOf(t, ctx, svc)
	if _, err := requestEmail(ctx, svc, "casey@example.com", casePassword); err != nil {
		t.Fatal(err)
	}
	expired := mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(-time.Minute))
	otherAddress := mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))
	wrongPurpose := mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(time.Hour))
	// The only other purpose the check allows is this one, so drop the
	// check for a moment to store a token of another purpose.
	if _, err := pool.Exec(context.Background(), `ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check`); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(wrongPurpose))
	if _, err := pool.Exec(context.Background(), `UPDATE email_tokens SET purpose = 'reset_password' WHERE token_hash = $1`, sum[:]); err != nil {
		t.Fatal(err)
	}
	for name, token := range map[string]string{"expired": expired, "other address": otherAddress, "wrong purpose": wrongPurpose} {
		if err := confirm(context.Background(), svc, token); codeOf(err) != connect.CodeFailedPrecondition {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A cancelled change takes its links with it.
	live := mintLink(t, pool, caseyID, "casey@example.com", time.Now().Add(time.Hour))
	if _, err := svc.CancelEmailChange(ctx, connect.NewRequest(&authv1.CancelEmailChangeRequest{})); err != nil {
		t.Fatal(err)
	}
	if err := confirm(context.Background(), svc, live); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("after cancel: %v", err)
	}
	if got := myEmail(t, ctx, svc); got.PendingAddress != "" {
		t.Errorf("after cancel: %v", got)
	}
}

func TestConfirmEmailAlreadyInUse(t *testing.T) {
	svc, pool, _ := emailService(t)
	caseyCtx, _ := signIn(t, svc, "casey", casePassword)
	adaCtx, _ := signIn(t, svc, "ada", casePassword)
	caseyID, adaID := userIDOf(t, caseyCtx, svc), userIDOf(t, adaCtx, svc)

	// Both ask; the reply never says the address is taken.
	if _, err := requestEmail(caseyCtx, svc, "shared@example.com", casePassword); err != nil {
		t.Fatal(err)
	}
	if _, err := requestEmail(adaCtx, svc, "Shared@example.com", casePassword); err != nil {
		t.Fatal(err)
	}
	if err := confirm(context.Background(), svc, mintLink(t, pool, caseyID, "shared@example.com", time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	if _, err := requestEmail(adaCtx, svc, "shared@example.com", casePassword); err != nil {
		t.Errorf("request for a taken address: %v", err)
	}
	err := confirm(context.Background(), svc, mintLink(t, pool, adaID, "shared@example.com", time.Now().Add(time.Hour)))
	if codeOf(err) != connect.CodeAlreadyExists || !strings.Contains(err.Error(), "already in use by another account") {
		t.Errorf("confirm a taken address: %v", err)
	}
}

// Two links for one address confirmed at once: the unique index decides,
// and the loser hears the address is in use.
func TestConfirmEmailRace(t *testing.T) {
	svc, pool, _ := emailService(t)
	caseyCtx, _ := signIn(t, svc, "casey", casePassword)
	adaCtx, _ := signIn(t, svc, "ada", casePassword)
	caseyID, adaID := userIDOf(t, caseyCtx, svc), userIDOf(t, adaCtx, svc)
	for _, ctx := range []context.Context{caseyCtx, adaCtx} {
		if _, err := requestEmail(ctx, svc, "shared@example.com", casePassword); err != nil {
			t.Fatal(err)
		}
	}
	tokens := []string{
		mintLink(t, pool, caseyID, "shared@example.com", time.Now().Add(time.Hour)),
		mintLink(t, pool, adaID, "shared@example.com", time.Now().Add(time.Hour)),
	}
	// Hold casey's confirmation open until ada's has checked the address,
	// so the pre-check passes for both.
	if _, err := pool.Exec(context.Background(), `
CREATE FUNCTION test_slow_confirm() RETURNS trigger AS $$
BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER test_slow_confirm BEFORE UPDATE OF email ON users
FOR EACH ROW WHEN (NEW.email IS NOT NULL) EXECUTE FUNCTION test_slow_confirm();`); err != nil {
		t.Fatal(err)
	}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for index, token := range tokens {
		wg.Go(func() { errs[index] = confirm(context.Background(), svc, token) })
	}
	wg.Wait()
	won, inUse := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			won++
		case codeOf(err) == connect.CodeAlreadyExists:
			inUse++
		default:
			t.Errorf("unexpected: %v", err)
		}
	}
	if won != 1 || inUse != 1 {
		t.Errorf("won %d, in use %d: %v", won, inUse, errs)
	}
}

func TestRemoveEmail(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	caseyID := userIDOf(t, ctx, svc)
	confirmed(t, ctx, svc, pool, caseyID, "casey@example.com")
	if _, err := requestEmail(ctx, svc, "casey@example.net", casePassword); err != nil {
		t.Fatal(err)
	}
	pending := mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))

	_, err := svc.RemoveEmail(ctx, connect.NewRequest(&authv1.RemoveEmailRequest{Password: "not it"}))
	if codeOf(err) != connect.CodeInvalidArgument || fieldOf(err) != "password" {
		t.Errorf("wrong password: %v", err)
	}
	if _, err := svc.RemoveEmail(ctx, connect.NewRequest(&authv1.RemoveEmailRequest{Password: casePassword})); err != nil {
		t.Fatal(err)
	}
	if got := myEmail(t, ctx, svc); got.Address != "" || got.PendingAddress != "" {
		t.Errorf("after remove: %v", got)
	}
	if err := confirm(context.Background(), svc, pending); codeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a link after remove: %v", err)
	}
}

// A deleted account gives its address up for someone else to confirm.
func TestDeletedAccountFreesItsAddress(t *testing.T) {
	svc, pool, _ := emailService(t)
	_, _ = signIn(t, svc, "casey", casePassword) // the owner
	adaCtx, _ := signIn(t, svc, "ada", casePassword)
	beaCtx, _ := signIn(t, svc, "bea", casePassword)
	adaID, beaID := userIDOf(t, adaCtx, svc), userIDOf(t, beaCtx, svc)
	confirmed(t, adaCtx, svc, pool, adaID, "ada@example.com")
	if _, err := svc.DeleteAccount(adaCtx, connect.NewRequest(&authv1.DeleteAccountRequest{Password: casePassword})); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE id = $1 AND (email IS NOT NULL OR pending_email IS NOT NULL)`, adaID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Error("the deleted account kept its address")
	}
	confirmed(t, beaCtx, svc, pool, beaID, "ada@example.com")
}

func userIDOf(t *testing.T, ctx context.Context, svc *auth.Service) string {
	t.Helper()
	me, err := svc.GetMe(ctx, connect.NewRequest(&authv1.GetMeRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	return me.Msg.User.Id
}

func TestSweepEmailTokens(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	caseyID := userIDOf(t, ctx, svc)
	now := time.Now()
	mintLink(t, pool, caseyID, "casey@example.com", now.Add(-25*time.Hour))
	mintLink(t, pool, caseyID, "casey@example.com", now.Add(-time.Hour))
	mintLink(t, pool, caseyID, "casey@example.com", now.Add(time.Hour))
	used := mintLink(t, pool, caseyID, "casey@example.com", now.Add(time.Hour))
	sum := sha256.Sum256([]byte(used))
	if _, err := pool.Exec(context.Background(), `UPDATE email_tokens SET used_at = $2 WHERE token_hash = $1`, sum[:], now.Add(-25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	removed, err := svc.SweepEmailTokens(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Errorf("removed %d, want the two a day past expiry or use", removed)
	}
}
