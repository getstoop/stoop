package voice

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSignalingProxy_StripsPrefixAndForwards(t *testing.T) {
	var gotPath, gotQuery, gotUpgrade string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotUpgrade = r.URL.Path, r.URL.RawQuery, r.Header.Get("Upgrade")
		w.WriteHeader(http.StatusTeapot)
	}))
	defer upstream.Close()

	s := New(nil, nil, Options{LiveKitURL: "ws" + upstream.URL[len("http"):], LiveKitAPIKey: "k", LiveKitAPISecret: "s"}, nil)
	h, err := s.SignalingProxy()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, SignalingPath+"/rtc?access_token=abc", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want upstream's 418", rec.Code)
	}
	if gotPath != "/rtc" || gotQuery != "access_token=abc" || gotUpgrade != "websocket" {
		t.Errorf("upstream saw path=%q query=%q upgrade=%q", gotPath, gotQuery, gotUpgrade)
	}
}

func TestSignalingProxy_Unconfigured(t *testing.T) {
	h, err := New(nil, nil, Options{}, nil).SignalingProxy()
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, SignalingPath+"/rtc", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}
