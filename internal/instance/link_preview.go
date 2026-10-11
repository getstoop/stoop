package instance

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/config"
)

// The link preview settings: link_previews, whether links in messages
// get previews, and link_preview_html_mb, how much of a linked page is
// read to find one. Both are read as a message is sent, so a change
// applies to links posted from then on.

const (
	keyLinkPreviews    = "link_previews"
	keyLinkPreviewHTML = "link_preview_html_mb"
)

// UseLinkPreviewsEnv supplies STOOP_LINK_PREVIEWS, the fallback when
// nothing is saved.
func (s *Service) UseLinkPreviewsEnv(enabled bool) { s.linkPreviewsEnv = enabled }

// LinkPreviews is the effective setting: saved, else environment.
func (s *Service) LinkPreviews(ctx context.Context) (bool, error) {
	return s.readBool(ctx, keyLinkPreviews, s.linkPreviewsEnv)
}

// UseLinkPreviewHTMLEnv supplies STOOP_LINK_PREVIEW_HTML_MB, the fallback
// when nothing is saved.
func (s *Service) UseLinkPreviewHTMLEnv(megabytes int) { s.linkPreviewHTMLEnv = megabytes }

// LinkPreviewHTMLMB is the effective setting: saved, else environment,
// else 2.
func (s *Service) LinkPreviewHTMLMB(ctx context.Context) (int, error) {
	var megabytes int
	ok, err := s.readJSON(ctx, keyLinkPreviewHTML, &megabytes)
	if err != nil {
		return 0, err
	}
	switch {
	case ok && megabytes > 0:
		return megabytes, nil
	case s.linkPreviewHTMLEnv > 0:
		return s.linkPreviewHTMLEnv, nil
	}
	return config.DefaultLinkPreviewHTMLMB, nil
}

// LinkPreviewHTMLBytes is the setting in bytes, for the fetcher.
func (s *Service) LinkPreviewHTMLBytes(ctx context.Context) (int64, error) {
	megabytes, err := s.LinkPreviewHTMLMB(ctx)
	return int64(megabytes) << 20, err
}

// stageLinkPreviews validates a save of the link preview settings.
func stageLinkPreviews(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	stageBool(save, keyLinkPreviews, msg.LinkPreviews)
	megabytes := msg.LinkPreviewHtmlMb
	if megabytes == nil {
		return nil
	}
	if *megabytes < 0 || *megabytes > config.MaxLinkPreviewHTMLMB {
		return apierr.Field(connect.CodeInvalidArgument, "link_preview_html_mb",
			fmt.Errorf("a link preview reads 1-%d MB of a page, or 0 to use the server's default", config.MaxLinkPreviewHTMLMB))
	}
	save.write(keyLinkPreviewHTML, *megabytes)
	return nil
}
