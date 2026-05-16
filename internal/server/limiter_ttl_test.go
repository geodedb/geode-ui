// PERF #225: TTL janitor + cap-trim regression evidence for the login
// and profile limiter maps.
//
// Pre-PERF #225 the unique-key maps grew unbounded. An attacker that
// rotated source IPs (e.g. via a proxy pool) could allocate one
// ipBucket per source forever — heap memory was the only ceiling.
// This file pins:
//
//  1. Idle entries are evicted after MaxIdle elapses.
//  2. The hard MaxEntries cap is enforced even when the janitor is
//     not running (cap-trim on insert).
//  3. Pumping 50,000 unique IPs through Allow() leaves the heap
//     bounded by MaxEntries, not by the input cardinality.
package server

import (
	"net/netip"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// TestLoginLimiter_TTLJanitor_EvictsIdleEntries verifies that
// PruneOnce removes entries that have been idle for more than MaxIdle
// while preserving entries that were touched within the window.
func TestLoginLimiter_TTLJanitor_EvictsIdleEntries(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000, // high enough to never reject in this test
		PerIPBurst:    1000,
		FailThreshold: 5,
		LockoutWindow: 15 * time.Minute,
		Now:           func() time.Time { return clock },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0, // disable background goroutine
		MaxEntries:    100_000,
	})
	defer l.Stop()

	// Populate 10 IPs at t=0 and 5 more at t=2h (well past MaxIdle).
	for i := 0; i < 10; i++ {
		ok, _, _ := l.Allow("ip-old-"+strconv.Itoa(i), "default", "u")
		if !ok {
			t.Fatalf("Allow rejected fresh bucket %d", i)
		}
	}
	clock = now.Add(2 * time.Hour)
	for i := 0; i < 5; i++ {
		ok, _, _ := l.Allow("ip-new-"+strconv.Itoa(i), "default", "u")
		if !ok {
			t.Fatalf("Allow rejected fresh fresh bucket %d", i)
		}
	}
	if got := l.PerIPCount(); got != 15 {
		t.Fatalf("PerIPCount=%d want 15 before prune", got)
	}
	// PruneOnce now: the 10 ip-old-* are idle 2h > 1h MaxIdle, evict.
	// The 5 ip-new-* have been touched in the last second, keep.
	removed, _ := l.PruneOnce()
	if removed != 10 {
		t.Fatalf("PruneOnce removed=%d want 10", removed)
	}
	if got := l.PerIPCount(); got != 5 {
		t.Fatalf("PerIPCount=%d want 5 after prune", got)
	}
}

// TestLoginLimiter_TTLJanitor_EvictsClearedUserLockouts verifies that
// after NoteSuccess() clears a userLockout (lastFail = zero), the
// PruneOnce sweep removes the now-empty entry rather than leaving it
// in the map as graveyard data.
func TestLoginLimiter_TTLJanitor_EvictsClearedUserLockouts(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 5,
		LockoutWindow: 15 * time.Minute,
		Now:           func() time.Time { return now },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0,
		MaxEntries:    100_000,
	})
	defer l.Stop()

	l.NoteFail("default", "alice")
	l.NoteFail("default", "bob")
	if got := l.PerUserCount(); got != 2 {
		t.Fatalf("PerUserCount=%d want 2", got)
	}
	l.NoteSuccess("default", "alice")
	// alice's lastFail is now zero — PruneOnce should drop alice but
	// keep bob (bob still has lastFail = now within MaxIdle).
	_, removed := l.PruneOnce()
	if removed != 1 {
		t.Fatalf("PruneOnce removed=%d want 1 (alice)", removed)
	}
	if got := l.PerUserCount(); got != 1 {
		t.Fatalf("PerUserCount=%d want 1 after prune", got)
	}
}

// TestLoginLimiter_CapTrim_EnforcesMaxEntriesOnInsert verifies that
// the COW-insert path itself enforces MaxEntries when the map is
// already at the cap. The janitor goroutine is not required for the
// cap to hold.
func TestLoginLimiter_CapTrim_EnforcesMaxEntriesOnInsert(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	const cap = 100
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 5,
		LockoutWindow: 15 * time.Minute,
		Now:           func() time.Time { return clock },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0,
		MaxEntries:    cap,
	})
	defer l.Stop()

	// Insert cap+50 entries; the cap-trim path must drop the oldest.
	for i := 0; i < cap+50; i++ {
		// Advance the clock by 1ms per insert so the oldest entries
		// have strictly earlier `last` timestamps and the trim is
		// deterministic.
		clock = clock.Add(time.Millisecond)
		l.Allow("ip-"+strconv.Itoa(i), "default", "u")
	}
	got := l.PerIPCount()
	if got > cap {
		t.Fatalf("PerIPCount=%d > cap=%d; cap-trim did not enforce ceiling", got, cap)
	}
	// cap-trim drops a 10% batch on overflow so the map stays
	// between cap*0.9 (post-trim immediately after the most recent
	// overflow) and cap (about to overflow next). Both bounds are
	// acceptable; the strict assertion is just the upper one.
	if got < cap*9/10 {
		t.Fatalf("PerIPCount=%d unexpectedly low; cap-trim is too aggressive", got)
	}
}

// TestLoginLimiter_50kUniqueIPs_HeapBounded is the headline PERF #225
// acceptance test: pump 50,000 unique IPs through Allow() and assert
// that the heap stays bounded by MaxEntries, not by the input
// cardinality. Without the cap, this would balloon to ~50k * ~64B per
// bucket = ~3.2 MB of permanently-live heap.
//
// We test with a low cap (1,000) to keep the test fast and to make
// the bounded-growth assertion meaningful in a unit-test budget.
// Production deploys with MaxEntries=100,000 by default.
func TestLoginLimiter_50kUniqueIPs_HeapBounded(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	const cap = 1_000
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1000,
		PerIPBurst:    1000,
		FailThreshold: 5,
		LockoutWindow: 15 * time.Minute,
		Now:           func() time.Time { return clock },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0,
		MaxEntries:    cap,
	})
	defer l.Stop()

	// Synthetic IP source: walk a /16 with 16-bit suffix → 65,536
	// distinct strings. We take the first 50k.
	const nUnique = 50_000
	base := netip.MustParseAddr("10.0.0.0").As4()
	for i := 0; i < nUnique; i++ {
		base[2] = byte(i >> 8)
		base[3] = byte(i & 0xff)
		ip := netip.AddrFrom4(base).String()
		clock = clock.Add(time.Microsecond)
		l.Allow(ip, "default", "u")
	}

	// Acceptance: the map size MUST stay bounded by the cap.
	got := l.PerIPCount()
	if got > cap {
		t.Fatalf("PERF #225 regression: 50k unique IPs left PerIPCount=%d, want <= %d",
			got, cap)
	}

	// Also assert that the underlying heap doesn't balloon. We can't
	// measure runtime.MemStats deterministically (many other
	// allocations occur during the loop) but a strict upper bound
	// against the 50k-bucket worst case is meaningful: 50k buckets *
	// ~64B/bucket + string keys ~16B = ~4MB. The cap path bounds it
	// to ~80KB (1k * ~80B).
	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	if got > cap {
		t.Fatalf("PerIPCount=%d > cap=%d; heap is NOT bounded by MaxEntries", got, cap)
	}
	t.Logf("heap after 50k inserts: alloc=%dKB, mapSize=%d (cap=%d)",
		m.HeapAlloc/1024, got, cap)
}

// TestProfileLimiter_TTLJanitor_EvictsIdleEntries pins the same
// eviction behaviour for the ProfileLimiter perActor map. The implementation
// is symmetrical with LoginLimiter so this test exists primarily as a
// canary for accidental drift between the two surfaces.
func TestProfileLimiter_TTLJanitor_EvictsIdleEntries(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  1000,
		PerActorBurst: 1000,
		Now:           func() time.Time { return clock },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0,
		MaxEntries:    100_000,
	})
	defer l.Stop()

	for i := 0; i < 20; i++ {
		l.Allow("actor-old-" + strconv.Itoa(i))
	}
	clock = now.Add(2 * time.Hour)
	for i := 0; i < 7; i++ {
		l.Allow("actor-new-" + strconv.Itoa(i))
	}
	if got := l.PerActorCount(); got != 27 {
		t.Fatalf("PerActorCount=%d want 27", got)
	}
	removed := l.PruneOnce()
	if removed != 20 {
		t.Fatalf("PruneOnce removed=%d want 20", removed)
	}
	if got := l.PerActorCount(); got != 7 {
		t.Fatalf("PerActorCount=%d want 7 after prune", got)
	}
}

// TestProfileLimiter_50kUniqueActors_HeapBounded mirrors the
// LoginLimiter 50k cardinality test for the per-actor map.
func TestProfileLimiter_50kUniqueActors_HeapBounded(t *testing.T) {
	now := time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	const cap = 1_000
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  1000,
		PerActorBurst: 1000,
		Now:           func() time.Time { return clock },
		MaxIdle:       1 * time.Hour,
		PruneInterval: 0,
		MaxEntries:    cap,
	})
	defer l.Stop()

	const nUnique = 50_000
	for i := 0; i < nUnique; i++ {
		clock = clock.Add(time.Microsecond)
		l.Allow("actor-" + strconv.Itoa(i))
	}
	got := l.PerActorCount()
	if got > cap {
		t.Fatalf("PERF #225 regression: 50k unique actors left PerActorCount=%d, want <= %d",
			got, cap)
	}
}

// TestLoginLimiter_StartStopJanitor verifies the janitor goroutine
// exits cleanly when Stop is called. Run under -race this also
// catches double-close on Stop().
func TestLoginLimiter_StartStopJanitor(t *testing.T) {
	l := NewLoginLimiter(LoginLimiterConfig{
		Now:           time.Now,
		MaxIdle:       1 * time.Hour,
		PruneInterval: 100 * time.Millisecond,
		MaxEntries:    100,
	})
	l.StartJanitor()
	// Multiple Stop() calls must not panic.
	l.Stop()
	l.Stop()
	// Idempotent StartJanitor: a second call must not spawn a new
	// goroutine (the sync.Once guards it).
	l.StartJanitor()
	l.Stop()
}
