package instance

import (
	"strings"
	"testing"
)

// Internal (package instance, not instance_test) so it can see the
// unexported wordlists directly.
func TestInstanceNameWordlists(t *testing.T) {
	checkNoDuplicates(t, "instanceAdjectives", instanceAdjectives)
	checkNoDuplicates(t, "instanceNouns", instanceNouns)

	// Every name is one adjective, a space, one noun — where a noun may
	// itself carry a space ("Fire Escape"), so split on the lists, not on
	// whitespace.
	for i := 0; i < 200; i++ {
		name, err := randomInstanceName()
		if err != nil {
			t.Fatal(err)
		}
		if !isPair(name) {
			t.Fatalf("randomInstanceName() = %q, not an adjective + noun from the lists", name)
		}
	}
}

func isPair(name string) bool {
	for _, adj := range instanceAdjectives {
		rest, ok := strings.CutPrefix(name, adj+" ")
		if !ok {
			continue
		}
		for _, noun := range instanceNouns {
			if rest == noun {
				return true
			}
		}
	}
	return false
}

func checkNoDuplicates(t *testing.T, name string, words []string) {
	t.Helper()
	if len(words) == 0 {
		t.Fatalf("%s is empty", name)
	}
	seen := make(map[string]bool, len(words))
	for _, w := range words {
		if seen[w] {
			t.Errorf("%s contains %q twice", name, w)
		}
		seen[w] = true
	}
}
