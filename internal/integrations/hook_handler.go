package integrations

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/text"
)

// maxHookBody bounds an appliance's request body.
const maxHookBody = 256 << 10

// HookHandler serves POST /hooks/{token}: verify the token, coerce the
// body, post as the hook's bot through chat. Unknown, revoked and
// disabled hooks answer alike.
func (s *Service) HookHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if on, err := s.policy.WebhooksIncoming(ctx); err != nil {
			s.log.Error("read webhook policy", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		} else if !on || s.bots == nil || s.poster == nil {
			http.NotFound(w, r)
			return
		}
		// A delivery from a Stoop worker posting back in would loop forever.
		if strings.HasPrefix(r.Header.Get("User-Agent"), userAgentPrefix) {
			http.Error(w, "a Stoop delivery can't post into a hook", http.StatusForbidden)
			return
		}
		id, err := s.bots.VerifyHookToken(ctx, r.PathValue("token"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if s.hookLimit != nil {
			allowed, err := s.hookLimit.Allow(ctx, id.Credential.ID)
			if err != nil {
				http.Error(w, "the server cannot take this post right now; try again in a moment", http.StatusServiceUnavailable)
				return
			}
			if !allowed {
				w.Header().Set("Retry-After", "60")
				http.Error(w, "too many posts; slow down", http.StatusTooManyRequests)
				return
			}
		}
		hook, err := s.q.GetIncomingWebhookByCredential(ctx, &id.Credential.ID)
		if err != nil || hook.DisabledAt != nil {
			http.NotFound(w, r)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxHookBody))
		if err != nil {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		post := text.Truncate(adapt(r.Header.Get("Content-Type"), raw), maxPostRunes)
		if post == "" {
			http.Error(w, "nothing to post", http.StatusBadRequest)
			return
		}
		key := strings.TrimSpace(r.URL.Query().Get("thread"))
		if !utf8.ValidString(key) || utf8.RuneCountInString(key) > maxThreadKeyRunes {
			http.Error(w, fmt.Sprintf("a thread key is text of at most %d characters", maxThreadKeyRunes), http.StatusBadRequest)
			return
		}
		if err := s.postToHook(authctx.WithIdentity(ctx, id), hook, key, post); err != nil {
			status, msg := hookFailure(err)
			if status == http.StatusInternalServerError {
				s.log.Error("hook post failed", "hook", hook.ID, "err", err)
			}
			http.Error(w, msg, status)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})
}

// hookFailure maps chat's refusal to a status an appliance can act on.
func hookFailure(err error) (int, string) {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return http.StatusInternalServerError, "internal error"
	}
	switch cerr.Code() {
	case connect.CodeNotFound:
		return http.StatusNotFound, "not found"
	case connect.CodePermissionDenied:
		return http.StatusForbidden, cerr.Message()
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest, cerr.Message()
	case connect.CodeResourceExhausted:
		return http.StatusTooManyRequests, cerr.Message()
	default:
		return http.StatusInternalServerError, "internal error " + strconv.Itoa(int(cerr.Code()))
	}
}

// maxThreadKeyRunes bounds ?thread=, a build number or a service name.
const maxThreadKeyRunes = 100

// postToHook posts into the hook's channel, or, with a thread key, into
// the thread the key's first post started. When chat won't take the reply
// (the root went, became a placeholder, or the channel has no threads)
// the post lands in the channel and the key moves to it.
// docs/architecture/integrations.md → Incoming.
func (s *Service) postToHook(ctx context.Context, hook dbgen.IncomingWebhook, key, content string) error {
	req := PostRequest{ChannelID: hook.ChannelID, Content: content}
	if key == "" {
		_, err := s.poster.Post(ctx, req)
		return err
	}
	root, err := s.q.GetIncomingWebhookThread(ctx, dbgen.GetIncomingWebhookThreadParams{WebhookID: hook.ID, ThreadKey: key})
	switch {
	case err == nil:
		req.ThreadRootID = root
		_, err := s.poster.Post(ctx, req)
		switch connect.CodeOf(err) {
		case connect.CodeFailedPrecondition, connect.CodeNotFound:
			// Post without the thread; a channel the bot can't reach
			// refuses that too, with its own answer.
			req.ThreadRootID = ""
		default:
			return err
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("read thread key: %w", err)
	}
	messageID, err := s.poster.Post(ctx, req)
	if err != nil {
		return err
	}
	// The post stands either way; a key that isn't saved starts another
	// thread next time.
	if err := s.q.SetIncomingWebhookThread(ctx, dbgen.SetIncomingWebhookThreadParams{
		WebhookID: hook.ID, ThreadKey: key, RootMessageID: messageID,
	}); err != nil {
		s.log.Error("save hook thread key", "hook", hook.ID, "err", err)
	}
	return nil
}
