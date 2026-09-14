package integrations

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/authctx"
)

// maxHookBody bounds an appliance's request body.
const maxHookBody = 256 << 10

// HookHandler serves POST /hooks/{token}: verify the token, coerce the
// body, post as the hook's bot through chat. Unknown, revoked and
// disabled hooks answer alike.
func (s *Service) HookHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if on, err := s.incomingEnabled(ctx); err != nil {
			s.log.Error("read webhook policy", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		} else if !on || s.bots == nil || s.poster == nil {
			http.NotFound(w, r)
			return
		}
		id, err := s.bots.VerifyHookToken(ctx, r.PathValue("token"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if s.hookLimit != nil && !s.hookLimit.Allow(id.Credential.ID) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "too many posts; slow down", http.StatusTooManyRequests)
			return
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
		text := truncate(adapt(r.Header.Get("Content-Type"), raw))
		if text == "" {
			http.Error(w, "nothing to post", http.StatusBadRequest)
			return
		}
		if _, err := s.poster.Post(authctx.WithIdentity(ctx, id), PostRequest{ChannelID: hook.ChannelID, Content: text}); err != nil {
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
