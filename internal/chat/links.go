package chat

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Link previews. URLs in a message are recorded at send time; a worker
// fetches each one's metadata through the Unfurler port (the server
// fetches, never the reader's browser), stores the preview image through
// the PreviewImages port, and then republishes the message with its
// previews as a MessageUpdated event. Previews are cached per URL and
// shared by every message that links it.

// LinkMeta is what the Unfurler port returns for a URL.
type LinkMeta struct {
	Title       string
	Description string
	SiteName    string
	Image       []byte
}

// Unfurler fetches a URL's preview metadata; backed by internal/unfurl,
// wired in internal/app. nil disables link previews.
type Unfurler interface {
	Fetch(ctx context.Context, url string) (LinkMeta, error)
}

// PreviewImages stores a preview image; backed by the files module.
type PreviewImages interface {
	StoreLinkPreviewImage(ctx context.Context, ownerID string, data []byte) (id string, width, height int, err error)
}

// UnfurlOptions tune the worker. Inline runs fetches synchronously in the
// sending request — for tests, so a send returns with previews attached.
type UnfurlOptions struct {
	Inline bool
}

// UseUnfurler enables link previews.
func (s *Service) UseUnfurler(u Unfurler, images PreviewImages, opts UnfurlOptions) {
	s.unfurler, s.previewImages, s.unfurlOpts = u, images, opts
	s.unfurlSem = make(chan struct{}, 4)
}

const (
	maxLinksPerMessage = 3
	// previewMaxAge is how long a cached preview is trusted before the
	// next message linking the URL refetches it.
	previewMaxAge = 7 * 24 * time.Hour
	unfurlTimeout = 20 * time.Second
)

var (
	urlPattern      = regexp.MustCompile(`https?://[^\s<>"'` + "`" + `]+`)
	fencedCodeBlock = regexp.MustCompile("(?s)```.*?```")
	inlineCode      = regexp.MustCompile("`[^`\n]*`")
)

// extractLinks finds up to maxLinksPerMessage distinct http(s) URLs in
// message content, skipping code, in order of appearance.
func extractLinks(content string) []string {
	text := inlineCode.ReplaceAllString(fencedCodeBlock.ReplaceAllString(content, " "), " ")
	seen := map[string]bool{}
	var out []string
	for _, m := range urlPattern.FindAllString(text, -1) {
		m = strings.TrimRight(m, ".,;:!?)]}")
		if seen[m] || len(m) > 2048 {
			continue
		}
		seen[m] = true
		out = append(out, m)
		if len(out) == maxLinksPerMessage {
			break
		}
	}
	return out
}

// recordLinks replaces a message's link rows (within the caller's
// transaction) and returns the URLs that still need fetching.
func (s *Service) recordLinks(ctx context.Context, q *dbgen.Queries, messageID string, urls []string) ([]string, error) {
	if err := q.DeleteMessageLinks(ctx, messageID); err != nil {
		return nil, err
	}
	var stale []string
	for i, u := range urls {
		if err := q.EnsureLinkPreview(ctx, u); err != nil {
			return nil, err
		}
		if err := q.InsertMessageLink(ctx, dbgen.InsertMessageLinkParams{MessageID: messageID, Position: int32(i), Url: u}); err != nil {
			return nil, err
		}
		p, err := q.GetLinkPreview(ctx, u)
		if err != nil {
			return nil, err
		}
		if p.State == "pending" || p.FetchedAt == nil || time.Since(*p.FetchedAt) > previewMaxAge {
			stale = append(stale, u)
		}
	}
	return stale, nil
}

// unfurlLater fetches the given URLs and then republishes the message.
// Nothing here can fail the send: errors are logged and the URL is
// marked failed so it isn't retried on every message.
func (s *Service) unfurlLater(messageID, ownerID, channelID string, urls []string) {
	if s.unfurler == nil || len(urls) == 0 {
		return
	}
	work := func() {
		ctx, cancel := context.WithTimeout(context.Background(), unfurlTimeout*time.Duration(len(urls)))
		defer cancel()
		for _, u := range urls {
			s.fetchPreview(ctx, u, ownerID)
		}
		s.republish(ctx, messageID, channelID)
	}
	if s.unfurlOpts.Inline {
		work()
		return
	}
	go func() {
		s.unfurlSem <- struct{}{}
		defer func() { <-s.unfurlSem }()
		work()
	}()
}

func (s *Service) fetchPreview(ctx context.Context, url, ownerID string) {
	log := slog.Default().With("url", url)
	meta, err := s.unfurler.Fetch(ctx, url)
	params := dbgen.SetLinkPreviewParams{Url: url, State: "failed"}
	if err == nil {
		params.State, params.Title, params.Description, params.SiteName = "ok", meta.Title, meta.Description, meta.SiteName
		if len(meta.Image) > 0 && s.previewImages != nil {
			if id, w, h, ierr := s.previewImages.StoreLinkPreviewImage(ctx, ownerID, meta.Image); ierr == nil {
				params.ImageFileID = &id
				params.ImageWidth, params.ImageHeight = int32(w), int32(h)
			} else {
				log.Debug("link preview image dropped", "err", ierr)
			}
		}
		if params.Title == "" && params.ImageFileID == nil {
			params.State = "failed"
		}
	} else {
		log.Debug("link preview failed", "err", err)
	}
	if err := s.q.SetLinkPreview(ctx, params); err != nil {
		log.Warn("could not save link preview", "err", err)
	}
}

// republish sends the message, now with previews, as MessageUpdated.
func (s *Service) republish(ctx context.Context, messageID, channelID string) {
	row, err := s.q.GetMessage(ctx, messageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return // deleted meanwhile
	}
	var channel dbgen.Channel
	if err == nil {
		channel, err = s.q.GetChannel(ctx, channelID)
	}
	var msg *chatv1.Message
	if err == nil {
		msg, err = s.loadMessage(ctx, row, spaceOf(channel))
	}
	if err != nil {
		slog.Default().Warn("could not reload message for previews", "message_id", messageID, "err", err)
		return
	}
	s.publishChannel(ctx, channel, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MessageUpdated{MessageUpdated: msg},
	}))
}

// linkPreviewsByMessage loads fetched previews for a set of messages.
func (s *Service) linkPreviewsByMessage(ctx context.Context, messageIDs []string) (map[string][]*chatv1.LinkPreview, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	rows, err := s.q.ListLinkPreviewsForMessages(ctx, messageIDs)
	if err != nil {
		return nil, err
	}
	out := map[string][]*chatv1.LinkPreview{}
	for _, r := range rows {
		p := &chatv1.LinkPreview{
			Url: r.Url, Title: r.Title, Description: r.Description, SiteName: r.SiteName,
			ImageWidth: r.ImageWidth, ImageHeight: r.ImageHeight,
		}
		if r.ImageFileID != nil {
			p.ImageFileId = *r.ImageFileID
		}
		out[r.MessageID] = append(out[r.MessageID], p)
	}
	return out, nil
}
