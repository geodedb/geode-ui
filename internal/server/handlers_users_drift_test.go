package server

import (
	"sync"
	"testing"
)

// TestWarnRowDrift_DedupeAndConcurrency is the regression gate for
// PERF #221: the (stmt, col) dedupe was a sync.Mutex even though every
// already-seen observation is read-only. The swap to sync.RWMutex
// keeps the hot path lock-free for readers, but it must NOT regress
// dedupe correctness — first-sighting must still log exactly once
// even under concurrent first-sighting from many goroutines.
//
// We can't easily intercept slog without a global rebind, so we
// observe dedupe state by inspecting `driftSeen.set` after the run:
// every key MUST appear exactly once.
func TestWarnRowDrift_DedupeAndConcurrency(t *testing.T) {
	// Reset dedupe state so test order doesn't matter. Write-locked
	// because Reset is the cold-path equivalent.
	driftSeen.mu.Lock()
	driftSeen.set = map[string]struct{}{}
	driftSeen.mu.Unlock()

	const (
		statement = "SHOW USERS"
		column    = "tenant_id"
		repeats   = 100
		workers   = 32
	)

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for i := 0; i < repeats; i++ {
				warnRowDrift(statement, column)
			}
		}()
	}
	wg.Wait()

	// The (statement, column) pair should appear exactly once in the
	// dedupe set despite 32x100=3200 concurrent calls. The use of
	// RWMutex on the read path does not change this contract because
	// the cold-path Lock() + re-check still serialises the first-
	// sighting insert.
	driftSeen.mu.RLock()
	defer driftSeen.mu.RUnlock()

	key := statement + "\x00" + column
	if _, ok := driftSeen.set[key]; !ok {
		t.Fatalf("expected drift key %q to be recorded", key)
	}
	if got := len(driftSeen.set); got != 1 {
		t.Fatalf("driftSeen.set len=%d want 1; map=%v", got, driftSeen.set)
	}
}

// TestWarnRowDrift_MultipleKeys ensures the dedupe per-key isolation
// still holds: distinct (stmt, col) pairs each get their own entry.
func TestWarnRowDrift_MultipleKeys(t *testing.T) {
	driftSeen.mu.Lock()
	driftSeen.set = map[string]struct{}{}
	driftSeen.mu.Unlock()

	pairs := []struct {
		stmt, col string
	}{
		{"SHOW USERS", "tenant_id"},
		{"SHOW ROLES", "scope"},
		{"SHOW PERMISSIONS", "resource"},
		{"SHOW USERS", "scope"},
	}
	// Fire each pair twice so the dedupe path is exercised.
	for _, p := range pairs {
		warnRowDrift(p.stmt, p.col)
		warnRowDrift(p.stmt, p.col)
	}

	driftSeen.mu.RLock()
	got := len(driftSeen.set)
	driftSeen.mu.RUnlock()

	if got != len(pairs) {
		t.Fatalf("driftSeen.set len=%d want %d", got, len(pairs))
	}
}

// BenchmarkWarnRowDrift_ReadMostly is the regression gate for the
// PERF #221 RWMutex swap. With the prior sync.Mutex this benchmark
// would serialise every goroutine on one lock; with sync.RWMutex
// concurrent observers on already-seen keys proceed in parallel and
// the per-op cost scales with available CPU.
func BenchmarkWarnRowDrift_ReadMostly(b *testing.B) {
	// Seed the dedupe set so every benchmark iteration hits the
	// already-seen RLock branch.
	driftSeen.mu.Lock()
	driftSeen.set = map[string]struct{}{}
	driftSeen.mu.Unlock()
	warnRowDrift("BENCH", "col")

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			warnRowDrift("BENCH", "col")
		}
	})
}
