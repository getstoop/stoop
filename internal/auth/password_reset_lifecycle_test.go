package auth_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/mail"
)

// perKeyLimit lets each key through limit times.
type perKeyLimit struct {
	mu    sync.Mutex
	limit int
	used  map[string]int
}

func (p *perKeyLimit) Allow(_ context.Context, key string) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.used[key] >= p.limit {
		return false, nil
	}
	p.used[key]++
	return true, nil
}

func countTokens(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM email_tokens WHERE user_id = $1`, userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// linkRefused checks that a reset link is now dead to both Get and
// Complete.
func linkRefused(t *testing.T, svc *auth.Service, name, token string) {
	t.Helper()
	const spent = "This link has expired or was already used."
	if _, err := resetUsername(svc, token); connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), spent) {
		t.Errorf("%s: GetPasswordReset err = %v, want the spent link", name, err)
	}
	err := completeReset(svc, token, "a brand new password", false)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), spent) {
		t.Errorf("%s: CompletePasswordReset err = %v, want the spent link", name, err)
	}
}

// A link is only as good as the policy when it is used: switching
// password sign-in to admins or off, or demoting the admin, kills it, and
// a queued job sends nothing.
func TestPasswordResetFollowsThePolicyNow(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	policy := &fakePasswordPolicy{policy: auth.PasswordEveryone}
	svc.UsePasswordPolicy(policy)
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	adaID := resetAccount(t, pool, "ada", "admin", "person", "ada@example.com")
	queued := mail.JobArgs{Template: mail.TemplatePasswordReset, Email: "casey@example.com"}

	for _, switched := range []string{auth.PasswordAdmins, auth.PasswordOff} {
		policy.policy = auth.PasswordEveryone
		token := resetLinkToken(t, svc, caseyID)
		policy.policy = switched
		linkRefused(t, svc, "member under "+switched, token)
		if to := buildRequested(t, svc, queued); to != "" {
			t.Errorf("under %s a queued job sent to %q", switched, to)
		}
		if _, err := svc.BuildPasswordReset(ctx, mail.JobArgs{Template: mail.TemplatePasswordReset, UserID: caseyID}, emailSite); !errors.Is(err, mail.ErrNothingToSend) {
			t.Errorf("under %s an old-form job: err = %v, want ErrNothingToSend", switched, err)
		}
	}

	policy.policy = auth.PasswordAdmins
	token := resetLinkToken(t, svc, adaID)
	if _, err := pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE id = $1`, adaID); err != nil {
		t.Fatal(err)
	}
	linkRefused(t, svc, "demoted admin", token)
}

// Changing the password, an admin's reset, confirming a new address and
// removing the address each retire the reset links already sent.
func TestPasswordResetLinksRetire(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx, _ := signIn(t, svc, "casey", casePassword)
	caseyID := authctx.UserID(ctx)
	confirmAddress(t, pool, caseyID, "casey@example.com")

	token := resetLinkToken(t, svc, caseyID)
	if _, err := svc.ChangePassword(ctx, connect.NewRequest(&authv1.ChangePasswordRequest{
		CurrentPassword: casePassword, NewPassword: "a changed password",
	})); err != nil {
		t.Fatal(err)
	}
	linkRefused(t, svc, "after a password change", token)

	token = resetLinkToken(t, svc, caseyID)
	if _, _, err := svc.ResetPasswordByUsername(context.Background(), "casey"); err != nil {
		t.Fatal(err)
	}
	linkRefused(t, svc, "after an admin reset", token)

	token = resetLinkToken(t, svc, caseyID)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET pending_email = 'casey@example.net' WHERE id = $1`, caseyID); err != nil {
		t.Fatal(err)
	}
	if err := confirm(context.Background(), svc, mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	if got := countTokens(t, pool, caseyID); got != 1 {
		t.Errorf("%d links after confirming, want only the used confirmation", got)
	}
	linkRefused(t, svc, "after a new address", token)

	ada, _ := signIn(t, svc, "ada", casePassword)
	adaID := authctx.UserID(ada)
	confirmAddress(t, pool, adaID, "ada@example.com")
	token = resetLinkToken(t, svc, adaID)
	if _, err := svc.RemoveEmail(ada, connect.NewRequest(&authv1.RemoveEmailRequest{Password: casePassword})); err != nil {
		t.Fatal(err)
	}
	if got := countTokens(t, pool, adaID); got != 0 {
		t.Errorf("%d links after removing the address, want 0", got)
	}
	linkRefused(t, svc, "after removing the address", token)
}

// Two resets racing on one link: exactly one sets the password.
func TestCompletePasswordResetRace(t *testing.T) {
	svc, pool, _ := emailService(t)
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	token := resetLinkToken(t, svc, caseyID)
	results := make(chan error, 2)
	var start sync.WaitGroup
	start.Add(1)
	for _, password := range []string{"the first new password", "the second new password"} {
		go func() {
			start.Wait()
			results <- completeReset(svc, token, password, false)
		}()
	}
	start.Done()
	var succeeded, spent int
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			succeeded++
		case connect.CodeOf(err) == connect.CodeFailedPrecondition:
			spent++
		default:
			t.Errorf("unexpected err = %v", err)
		}
	}
	if succeeded != 1 || spent != 1 {
		t.Errorf("%d succeeded and %d refused, want one each", succeeded, spent)
	}
}

// A link is good only for its own purpose.
func TestEmailLinksKeepToTheirPurpose(t *testing.T) {
	svc, pool, _ := emailService(t)
	ctx := context.Background()
	caseyID := resetAccount(t, pool, "casey", "member", "person", "casey@example.com")
	if _, err := pool.Exec(ctx, `UPDATE users SET pending_email = 'casey@example.net' WHERE id = $1`, caseyID); err != nil {
		t.Fatal(err)
	}
	resetToken := resetLinkToken(t, svc, caseyID)
	if err := confirm(ctx, svc, resetToken); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("a reset link to ConfirmEmail: err = %v, want the spent link", err)
	}
	confirmToken := mintLink(t, pool, caseyID, "casey@example.net", time.Now().Add(time.Hour))
	linkRefused(t, svc, "a confirmation link", confirmToken)
	if err := confirm(ctx, svc, confirmToken); err != nil {
		t.Errorf("the confirmation link was spent by the refusals: %v", err)
	}
}
