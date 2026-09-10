package config

import (
	"os"
	"regexp"
	"sort"
	"testing"
)

var (
	envKeyRE   = regexp.MustCompile(`"(STOOP_[A-Z0-9_]+)"`)
	tableKeyRE = regexp.MustCompile("(?m)^\\|\\s*`(STOOP_[A-Z0-9_]+)`")
)

// The Configuration reference in docs/self-hosting.md is what operators
// read to find a setting, and the compose file passes .env straight
// through, so a variable missing from the table is a variable nobody can
// find. Keep the two in step.
func TestConfigReferenceDocumentsEveryVariable(t *testing.T) {
	inCode := keys(t, envKeyRE, "config.go")
	inDocs := keys(t, tableKeyRE, "../../docs/self-hosting.md")

	for k := range inCode {
		if !inDocs[k] {
			t.Errorf("%s is read by config.go but has no row in docs/self-hosting.md → Configuration reference", k)
		}
	}
	for k := range inDocs {
		if !inCode[k] {
			t.Errorf("%s has a row in docs/self-hosting.md → Configuration reference but config.go no longer reads it", k)
		}
	}
}

func keys(t *testing.T, re *regexp.Regexp, path string) map[string]bool {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(b), -1) {
		found[m[1]] = true
	}
	if len(found) == 0 {
		t.Fatalf("no STOOP_* variables found in %s", path)
	}
	return found
}

// A key the table lists must also be one the example file can carry, so
// spot-check that .env.example only names variables that still exist.
func TestEnvExampleNamesOnlyRealVariables(t *testing.T) {
	b, err := os.ReadFile("../../deploy/.env.example")
	if err != nil {
		t.Fatal(err)
	}
	inCode := keys(t, envKeyRE, "config.go")
	assign := regexp.MustCompile(`(?m)^(STOOP_[A-Z0-9_]+)=`)
	var unknown []string
	for _, m := range assign.FindAllStringSubmatch(string(b), -1) {
		if !inCode[m[1]] {
			unknown = append(unknown, m[1])
		}
	}
	sort.Strings(unknown)
	if len(unknown) > 0 {
		t.Errorf("deploy/.env.example sets variables config.go does not read: %v", unknown)
	}
}
