// Package release is the published release index and how versions compare.
package release

import "encoding/json"

// IndexURL is where the release index is published.
const IndexURL = "https://getstoop.org/releases.json"

// Index is the release index: docs/architecture/runtime.md → The update
// check has the file's shape. Supported is the oldest release still
// supported; an index without one names none.
type Index struct {
	Latest    string    `json:"latest"`
	Supported string    `json:"supported"`
	Releases  []Release `json:"releases"`
}

// Release is one published version and where each of its files is.
type Release struct {
	Version string            `json:"version"`
	Files   map[string]string `json:"files"`
}

// ParseIndex reads the index from its JSON.
func ParseIndex(body []byte) (Index, error) {
	var index Index
	if err := json.Unmarshal(body, &index); err != nil {
		return Index{}, err
	}
	return index, nil
}
