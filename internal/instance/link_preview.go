package instance

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The link preview settings: link_previews, whether links in messages
// get previews, and link_preview_html_mb, how much of a linked page is
// read to find one, and link_preview_proxy, the SOCKS5 proxy fetches go
// through. All are read as a message is sent, so a change applies to
// links posted from then on.

const (
	keyLinkPreviews     = "link_previews"
	keyLinkPreviewHTML  = "link_preview_html_mb"
	keyLinkPreviewProxy = "link_preview_proxy"
)

// UseLinkPreviewProxyEnv supplies STOOP_LINK_PREVIEW_PROXY, in force
// until a value is saved.
func (s *Service) UseLinkPreviewProxyEnv(proxy string) { s.linkPreviewProxyEnv = proxy }

// LinkPreviewProxy is the proxy in force (socks5://host:port), or empty
// for none: the saved value, else the environment's. A saved empty value
// means no proxy.
func (s *Service) LinkPreviewProxy(ctx context.Context) (string, error) {
	return s.readSetting(ctx, keyLinkPreviewProxy, s.linkPreviewProxyEnv)
}

// stageLinkPreviewProxy validates a save of the proxy; empty clears it.
// Saved with the other link preview settings so one save applies them
// together, and read with the Hosting settings, which only an admin may.
func stageLinkPreviewProxy(msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	if msg.LinkPreviewProxy == nil {
		return nil
	}
	proxy := strings.TrimSpace(*msg.LinkPreviewProxy)
	if _, ok := config.SOCKS5Proxy(proxy); proxy != "" && !ok {
		return apierr.Field(connect.CodeInvalidArgument, "link_preview_proxy",
			errors.New("the proxy must look like socks5://host:port"))
	}
	save.write(keyLinkPreviewProxy, proxy)
	return nil
}

// UseLinkPreviewsEnv supplies STOOP_LINK_PREVIEWS, the fallback when
// nothing is saved.
func (s *Service) UseLinkPreviewsEnv(enabled bool) { s.linkPreviewsEnv = enabled }

// keyLinkPreviewsSettled marks that KeepLinkPreviewsOn has decided.
const keyLinkPreviewsSettled = "link_previews_default_settled"

// KeepLinkPreviewsOn saves link_previews as on for a server that had
// accounts before previews became off by default, so an upgrade takes no
// cards away. It decides once, on the first start with that default: a
// new server has no accounts then and stays off. A saved value or a set
// STOOP_LINK_PREVIEWS is left alone. Called after UseEnvSet.
func (s *Service) KeepLinkPreviewsOn(ctx context.Context) error {
	var settled bool
	if ok, err := s.readJSON(ctx, keyLinkPreviewsSettled, &settled); err != nil || ok {
		return err
	}
	var saved bool
	hasRow, err := s.readJSON(ctx, keyLinkPreviews, &saved)
	if err != nil {
		return err
	}
	if !hasRow && (s.envSet == nil || !s.envSet("STOOP_LINK_PREVIEWS")) {
		accounts, err := s.users.CountUsers(ctx)
		if err != nil {
			return err
		}
		if accounts > 0 {
			// Only where there is still no row: a choice saved since the
			// read above is the admin's and stands.
			if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: keyLinkPreviews, Value: []byte("true")}); err != nil {
				return fmt.Errorf("seed %s: %w", keyLinkPreviews, err)
			}
		}
	}
	return s.writeJSON(ctx, keyLinkPreviewsSettled, true)
}

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
	if err := stageLinkPreviewProxy(msg, save); err != nil {
		return err
	}
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
