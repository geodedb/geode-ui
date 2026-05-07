package mcpx

import (
	"strings"
	"sync"
	"testing"
)

// captureSink intercepts mcpx audit emissions so the test can assert
// what (if anything) SetWSAllowAnyOrigin logged. The mcpx package
// dispatches audit events through an internal auditConfigChange hook
// (see engine.go) which tests in this package can swap.
type captureSink struct {
	mu      sync.Mutex
	entries []captureEntry
}

type captureEntry struct {
	event string
	data  map[string]any
}

func (c *captureSink) record(event string, data map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = append(c.entries, captureEntry{event: event, data: data})
}

// installAuditCapture replaces the package-private auditConfigChange
// hook with a capture sink for the duration of the test.
func installAuditCapture(t *testing.T) *captureSink {
	t.Helper()
	sink := &captureSink{}
	prev := auditConfigChange
	auditConfigChange = sink.record
	t.Cleanup(func() { auditConfigChange = prev })
	return sink
}

// TestSetWSAllowAnyOrigin_AuditsTransitionToTrue is the regression
// test for APPSEC-14. Toggling the SEC-0008 fail-closed gate off via
// SetWSAllowAnyOrigin(true) used to leave no audit-log trail at all,
// so a misconfiguration ("we forgot we set this") could not be
// reconstructed forensically.
//
// After the fix the false → true transition emits a structured
// audit record naming the call site (mcp_ws_allow_any_origin_enabled)
// so deployers can grep audit logs to verify the gate state at
// startup or alert on it.
func TestSetWSAllowAnyOrigin_AuditsTransitionToTrue(t *testing.T) {
	// Ensure clean state so the false → true transition fires.
	prev := wsAllowAnyOrigin
	t.Cleanup(func() { wsAllowAnyOrigin = prev })
	wsAllowAnyOrigin = false

	sink := installAuditCapture(t)
	SetWSAllowAnyOrigin(true)

	if len(sink.entries) == 0 {
		t.Fatal("SetWSAllowAnyOrigin(true) emitted no audit log entry")
	}
	found := false
	for _, e := range sink.entries {
		if strings.Contains(e.event, "allow_any_origin") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected audit event mentioning allow_any_origin, got events: %+v", sink.entries)
	}
}

// TestSetWSAllowAnyOrigin_NoAuditOnNoTransition asserts the audit log
// is not noisy when callers re-issue the same value (e.g. a config
// reload that re-applies the existing setting). Only state changes
// are forensically interesting.
func TestSetWSAllowAnyOrigin_NoAuditOnNoTransition(t *testing.T) {
	prev := wsAllowAnyOrigin
	t.Cleanup(func() { wsAllowAnyOrigin = prev })
	wsAllowAnyOrigin = true

	sink := installAuditCapture(t)
	SetWSAllowAnyOrigin(true)

	if len(sink.entries) != 0 {
		t.Errorf("idempotent SetWSAllowAnyOrigin(true) should not audit-log, got %d entries", len(sink.entries))
	}
}

// TestSetWSAllowAnyOrigin_AuditsTransitionToFalse asserts the
// re-tightening path (true → false) is also audited so the absence
// of a "disabled" event in the trail is itself meaningful.
func TestSetWSAllowAnyOrigin_AuditsTransitionToFalse(t *testing.T) {
	prev := wsAllowAnyOrigin
	t.Cleanup(func() { wsAllowAnyOrigin = prev })
	wsAllowAnyOrigin = true

	sink := installAuditCapture(t)
	SetWSAllowAnyOrigin(false)

	if len(sink.entries) == 0 {
		t.Fatal("SetWSAllowAnyOrigin(false) on a true → false transition emitted no audit log entry")
	}
}
