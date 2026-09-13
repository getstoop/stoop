package app

import (
	"strings"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// Every procedure a Stoop proto declares must have an access rule, and every
// rule must name a real procedure and real actions.
func TestEveryProcedureHasAnAccessRule(t *testing.T) {
	declared := map[string]bool{}
	protoregistry.GlobalFiles.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		if !strings.HasPrefix(fd.Path(), "stoop/") {
			return true
		}
		services := fd.Services()
		for i := range services.Len() {
			sd := services.Get(i)
			methods := sd.Methods()
			for j := range methods.Len() {
				declared["/"+string(sd.FullName())+"/"+string(methods.Get(j).Name())] = true
			}
		}
		return true
	})
	if len(declared) == 0 {
		t.Fatal("no Stoop services registered; the gen packages aren't linked")
	}

	for p := range declared {
		if _, ok := procedures[p]; !ok {
			t.Errorf("%s has no access rule; add it to internal/app/procedures.go", p)
		}
	}
	for p, rule := range procedures {
		if !declared[p] {
			t.Errorf("%s has an access rule but no service declares it", p)
		}
		if rule.Public && len(rule.AnyOf) > 0 {
			t.Errorf("%s is public and also names actions", p)
		}
		for _, a := range rule.AnyOf {
			if !a.Known() {
				t.Errorf("%s names unknown action %q", p, a)
			}
		}
	}
}
