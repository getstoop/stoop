package app

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/instance"
)

// metricsHandler answers GET /metrics with the registry in Prometheus text
// format, for a bearer token that holds instance.read: the same verifier
// and the same gate as the Connect procedures behind the Diagnostics tab.
// The health rows and the build come from this package, which is the only
// one that knows both; internal/diag stays a plain registry.
func metricsHandler(authSvc *auth.Service, instanceSvc *instance.Service, queue *queueStats) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		identity, err := authSvc.VerifyToken(r.Context(), token)
		if !ok || err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "a bearer token is required", http.StatusUnauthorized)
			return
		}
		ctx := authctx.WithIdentity(r.Context(), identity)
		if !authctx.Allows(ctx, authctx.InstanceRead) {
			http.Error(w, "this token isn't allowed to "+authctx.InstanceRead.Describe(), http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err := diag.WriteText(w, diag.Default.Snapshot()); err != nil {
			return
		}
		writeHealth(w, instanceSvc.HealthSnapshot(ctx))
		if q, err := queue.stats(ctx); err == nil {
			writeQueue(w, q)
		}
		writeBuildInfo(w, buildinfo.Get())
	})
}

// writeHealth is the Health panel as one gauge family: 0 ok, 1 warn,
// 2 danger, 3 off, the order of instance.CheckState.
func writeHealth(w io.Writer, checks []instance.Check) {
	_, _ = io.WriteString(w, "# HELP stoop_health Health check state: 0 ok, 1 warn, 2 danger, 3 off.\n# TYPE stoop_health gauge\n")
	for _, c := range checks {
		_, _ = fmt.Fprintf(w, "stoop_health{check=%s} %d\n", strconv.Quote(c.Name), int(c.State))
	}
}

// writeQueue is the webhook queue, counted for this scrape rather than
// sampled: nothing runs the query while no one is asking.
func writeQueue(w io.Writer, q instance.QueueStats) {
	for _, g := range []struct {
		name, help string
		v          int64
	}{
		{"stoop_webhooks_queued", "Outgoing webhook deliveries waiting for the worker.", q.Queued},
		{"stoop_webhooks_leased", "Outgoing webhook deliveries in flight.", q.Leased},
		{"stoop_webhooks_dead", "Outgoing webhook deliveries dead-lettered.", q.Dead},
	} {
		_, _ = fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n%s %d\n", g.name, g.help, g.name, g.name, g.v)
	}
}

func writeBuildInfo(w io.Writer, bi buildinfo.Info) {
	_, _ = io.WriteString(w, "# HELP stoop_build_info The running build.\n# TYPE stoop_build_info gauge\n")
	_, _ = fmt.Fprintf(w, "stoop_build_info{version=%s,commit=%s,go=%s} 1\n",
		strconv.Quote(bi.Version), strconv.Quote(bi.Commit), strconv.Quote(bi.GoVersion))
}
