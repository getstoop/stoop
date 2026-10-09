package instance

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/mail"
	"github.com/getstoop/stoop/internal/mail/mailtest"
)

func TestSendWindowCountsAndRollsOver(t *testing.T) {
	svc := New(dbtest.New(t), oneUser{})
	ctx := context.Background()
	start := time.Now().UTC().Truncate(time.Second)

	for i := range 3 {
		if err := svc.takeSendSlot(ctx, 3, start.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatalf("send %d: %v", i+1, err)
		}
	}
	err := svc.takeSendSlot(ctx, 3, start.Add(59*time.Minute))
	var limit *mail.HourlyLimitError
	if !errors.As(err, &limit) || !errors.Is(err, mail.ErrHourlyLimit) {
		t.Fatalf("fourth send: want an HourlyLimitError, got %v", err)
	}
	if limit.Limit != 3 || !limit.Until.Equal(start.Add(time.Hour)) {
		t.Errorf("limit %d until %s; want 3 until %s", limit.Limit, limit.Until, start.Add(time.Hour))
	}
	window := readWindow(t, svc)
	if !window.Start.Equal(start) || window.Count != 3 {
		t.Errorf("window = %+v; a refused send must not count", window)
	}

	if err := svc.takeSendSlot(ctx, 3, start.Add(time.Hour)); err != nil {
		t.Fatalf("an hour on: %v", err)
	}
	window = readWindow(t, svc)
	if !window.Start.Equal(start.Add(time.Hour)) || window.Count != 1 {
		t.Errorf("after rollover window = %+v; want a new window with 1", window)
	}
}

func TestSendWindowNoCap(t *testing.T) {
	svc := New(dbtest.New(t), oneUser{})
	ctx := context.Background()
	for range 5 {
		if err := svc.takeSendSlot(ctx, 0, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if found, err := svc.readJSON(ctx, keySendWindow, &sendWindow{}); err != nil || found {
		t.Errorf("limit 0 wrote a window (found %v, %v)", found, err)
	}
}

func TestSendWindowHoldsUnderConcurrency(t *testing.T) {
	svc := New(dbtest.New(t), oneUser{})
	ctx := context.Background()
	now := time.Now()
	var allowed, refused atomic.Int32
	var group sync.WaitGroup
	for range 30 {
		group.Go(func() {
			err := svc.takeSendSlot(ctx, 10, now)
			switch {
			case err == nil:
				allowed.Add(1)
			case errors.Is(err, mail.ErrHourlyLimit):
				refused.Add(1)
			default:
				t.Error(err)
			}
		})
	}
	group.Wait()
	if allowed.Load() != 10 || refused.Load() != 20 {
		t.Errorf("allowed %d, refused %d; want 10 and 20", allowed.Load(), refused.Load())
	}
}

func TestSendUsesSavedSettingsAndRecords(t *testing.T) {
	svc := New(dbtest.New(t), oneUser{})
	ctx := context.Background()
	msg := mail.Message{To: "ada@example.com", Subject: "Hi", Text: "Hello."}

	if err := svc.Send(ctx, msg); !errors.Is(err, mail.ErrNotConfigured) {
		t.Fatalf("with nothing saved: want ErrNotConfigured, got %v", err)
	}
	if outcome, err := svc.LastSend(ctx); err != nil || !outcome.At.IsZero() {
		t.Fatalf("nothing sent, but LastSend = %+v, %v", outcome, err)
	}

	fake := mailtest.Start(t, mailtest.Options{})
	if err := svc.writeJSON(ctx, keyInstanceName, "Casey's stoop"); err != nil {
		t.Fatal(err)
	}
	saved := SMTP{
		Enabled: true, Host: fake.Host, Port: fake.Port, Security: mail.SecurityNone,
		FromAddress: "stoop@example.net", HourlyLimit: 1,
	}
	if err := svc.writeJSON(ctx, keySMTP, saved); err != nil {
		t.Fatal(err)
	}
	if err := svc.Send(ctx, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got := fake.Next(t); !strings.Contains(got.Data, `From: "Casey's stoop" <stoop@example.net>`) {
		t.Errorf("a blank From name should send the instance name:\n%s", got.Data)
	}
	if outcome, err := svc.LastSend(ctx); err != nil || !outcome.OK || outcome.At.IsZero() {
		t.Errorf("after a send LastSend = %+v, %v", outcome, err)
	}
	if err := svc.Send(ctx, msg); !errors.Is(err, mail.ErrHourlyLimit) {
		t.Errorf("over the cap: want ErrHourlyLimit, got %v", err)
	}

	saved.HourlyLimit, saved.Port = 0, mailtest.ClosedPort(t)
	if err := svc.writeJSON(ctx, keySMTP, saved); err != nil {
		t.Fatal(err)
	}
	var refusal *mail.Refusal
	if err := svc.Send(ctx, msg); !errors.As(err, &refusal) || refusal.Field != "port" {
		t.Fatalf("closed port: want a refusal on port, got %v", err)
	}
	if outcome, err := svc.LastSend(ctx); err != nil || outcome.OK || !strings.Contains(outcome.Error, "Nothing answered") {
		t.Errorf("after a refusal LastSend = %+v, %v", outcome, err)
	}
}

func readWindow(t *testing.T, svc *Service) sendWindow {
	t.Helper()
	var window sendWindow
	if _, err := svc.readJSON(context.Background(), keySendWindow, &window); err != nil {
		t.Fatal(err)
	}
	return window
}
