package netguard

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A resolver that redirects is not followed: the lookup fails and the
// place it pointed at is never contacted.
func TestResolverRedirectIsRefused(t *testing.T) {
	contacted := false
	elsewhere := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		contacted = true
	}))
	defer elsewhere.Close()
	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL, http.StatusTemporaryRedirect)
	}))
	defer resolver.Close()

	client := newResolverClient((&net.Dialer{}).DialContext)
	_, err := resolveOverHTTPS(context.Background(), client, resolver.URL, "preview.invalid")
	if err == nil || !strings.Contains(err.Error(), "307") {
		t.Errorf("a redirecting resolver should fail the lookup, got %v", err)
	}
	if contacted {
		t.Error("the redirect was followed")
	}
}
