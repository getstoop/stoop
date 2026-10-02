package release

import "testing"

func TestParseIndex(t *testing.T) {
	index, err := ParseIndex([]byte(`{"latest":"0.3.1","supported":"0.2.0","releases":[{"version":"0.3.1","files":{"compose":"https://example.test/compose.yml"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if index.Latest != "0.3.1" || index.Supported != "0.2.0" {
		t.Errorf("latest %q, supported %q", index.Latest, index.Supported)
	}
	if len(index.Releases) != 1 || index.Releases[0].Version != "0.3.1" || index.Releases[0].Files["compose"] != "https://example.test/compose.yml" {
		t.Errorf("releases = %+v", index.Releases)
	}
}

func TestParseIndexMalformed(t *testing.T) {
	if _, err := ParseIndex([]byte(`{"latest":`)); err == nil {
		t.Error("want an error for malformed JSON")
	}
}

func TestOlder(t *testing.T) {
	for _, example := range []struct {
		older, newer string
		want         bool
	}{
		{"0.2.0", "0.3.0", true}, {"0.3.0", "0.2.0", false}, {"0.2.0", "0.2.0", false},
		{"0.9.0", "0.10.0", true}, {"0.2", "0.2.1", true}, {"0.2.0", "dev", true}, {"dev", "0.2.0", false}, {"v0.2.0", "0.3.0", true},
	} {
		if got := Older(example.older, example.newer); got != example.want {
			t.Errorf("Older(%q, %q) = %v", example.older, example.newer, got)
		}
	}
}
