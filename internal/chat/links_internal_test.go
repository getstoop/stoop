package chat

import (
	"reflect"
	"testing"
)

// What extractLinks finds is held to the client's linksIn in
// shared_cases_internal_test.go; the cap is the server's own.
func TestExtractLinksKeepsTheFirstThree(t *testing.T) {
	in := "https://a.example https://b.example https://c.example https://d.example"
	want := []string{"https://a.example", "https://b.example", "https://c.example"}
	if got := extractLinks(in); !reflect.DeepEqual(got, want) {
		t.Errorf("extractLinks(%q) = %v, want %v", in, got, want)
	}
}
