package voice

import (
	"net/http"
	"net/http/httputil"
	"strings"
)

// SignalingProxy serves LiveKit's signaling endpoint under SignalingPath on
// the app origin. It is unauthenticated on purpose: see
// docs/architecture/voice.md → The signaling proxy.
func (s *Service) SignalingProxy() (http.Handler, error) {
	if !s.opts.Enabled() {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "voice is not configured on this server", http.StatusServiceUnavailable)
		}), nil
	}
	// LiveKit's own URL may be ws(s)://; the proxy speaks HTTP and upgrades.
	target, err := httpBase(s.opts.LiveKitURL)
	if err != nil {
		return nil, err
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, SignalingPath)
			r.SetXForwarded()
		},
	}
	return proxy, nil
}
