package chat

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// The cases the client runs too (web/src/core/markdown/shared-cases.json,
// read by markdown.test.ts and mentions.test.ts): the parser here is the
// client's ported to Go, held to the same answers from one copy.
type sharedCases struct {
	MaxMessageLength int `json:"maxMessageLength"`
	PlainText        []struct {
		In   string `json:"in"`
		Want string `json:"want"`
	} `json:"plainText"`
	Blocks []struct {
		In   string   `json:"in"`
		Want []string `json:"want"`
	} `json:"blocks"`
	Links []struct {
		In   string   `json:"in"`
		Want []string `json:"want"`
	} `json:"links"`
	WrittenLength []struct {
		In   string `json:"in"`
		Want int    `json:"want"`
	} `json:"writtenLength"`
}

func loadSharedCases(t *testing.T) sharedCases {
	t.Helper()
	raw, err := os.ReadFile("../../web/src/core/markdown/shared-cases.json")
	if err != nil {
		t.Fatalf("read shared cases: %v", err)
	}
	var cases sharedCases
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse shared cases: %v", err)
	}
	// A section renamed on one side would read as no cases, and pass.
	if len(cases.PlainText) == 0 || len(cases.Blocks) == 0 || len(cases.Links) == 0 || len(cases.WrittenLength) == 0 {
		t.Fatal("a section of the shared cases is empty or misnamed")
	}
	return cases
}

func TestSharedMessageLimit(t *testing.T) {
	if got := loadSharedCases(t).MaxMessageLength; got != maxMessageLen {
		t.Errorf("shared maxMessageLength = %d, the server's is %d", got, maxMessageLen)
	}
}

func TestSharedPlainText(t *testing.T) {
	for _, tc := range loadSharedCases(t).PlainText {
		if got := plainText(tc.In); got != tc.Want {
			t.Errorf("plainText(%q) = %q, want %q", tc.In, got, tc.Want)
		}
	}
}

func TestSharedBlocks(t *testing.T) {
	names := map[blockKind]string{
		blockLines: "lines",
		blockQuote: "quote",
		blockList:  "list",
		blockCode:  "codeblock",
	}
	for _, tc := range loadSharedCases(t).Blocks {
		got := []string{}
		for _, b := range parseMarkdown(tc.In) {
			got = append(got, names[b.kind])
		}
		if !reflect.DeepEqual(got, tc.Want) {
			t.Errorf("parseMarkdown(%q) kinds = %v, want %v", tc.In, got, tc.Want)
		}
	}
}

// The client lists every link; the server keeps the first three, which
// no shared case passes.
func TestSharedLinks(t *testing.T) {
	for _, tc := range loadSharedCases(t).Links {
		got := extractLinks(tc.In)
		if got == nil {
			got = []string{}
		}
		if !reflect.DeepEqual(got, tc.Want) {
			t.Errorf("extractLinks(%q) = %v, want %v", tc.In, got, tc.Want)
		}
	}
}

func TestSharedWrittenLength(t *testing.T) {
	for _, tc := range loadSharedCases(t).WrittenLength {
		if got := writtenLength(tc.In); got != tc.Want {
			t.Errorf("writtenLength(%q) = %d, want %d", tc.In, got, tc.Want)
		}
	}
}
