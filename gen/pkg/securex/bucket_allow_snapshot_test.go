package securex

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestBucket_AllowAndSnapshot_SingleCallReportsBoth proves the combined
// op returns both the admit decision and a Snapshot in the SAME lock
// acquisition. The Snapshot captures the post-deduction state when
// allowed=true: a burst of 5 with rate=0 should report Remaining=4
// after the first allowed call.
func TestBucket_AllowAndSnapshot_SingleCallReportsBoth(t *testing.T) {
	b := NewBucket(0, 5) // burst=5, no refill — deterministic
	ctx := context.Background()

	allowed, snap := b.AllowAndSnapshot(ctx)
	if !allowed {
		t.Fatalf("first call should be allowed")
	}
	if snap.Limit != 5 {
		t.Fatalf("snap.Limit = %d, want 5", snap.Limit)
	}
	if snap.Remaining != 4 {
		t.Fatalf("snap.Remaining = %d after one allowed call (burst=5, rate=0), want 4", snap.Remaining)
	}
	if snap.Reset.Before(time.Now().Add(-time.Second)) {
		t.Fatalf("snap.Reset is too far in the past: %v", snap.Reset)
	}
}

// TestBucket_AllowAndSnapshot_DeniedReportsZeroRemaining proves that
// after the burst is exhausted, AllowAndSnapshot returns (false, snap)
// where snap.Remaining == 0. The snapshot reflects exactly the state at
// reject-time so the X-RateLimit-Remaining header is accurate.
func TestBucket_AllowAndSnapshot_DeniedReportsZeroRemaining(t *testing.T) {
	b := NewBucket(0, 2) // burst=2
	ctx := context.Background()

	if a, _ := b.AllowAndSnapshot(ctx); !a {
		t.Fatalf("call 1 should be allowed")
	}
	if a, _ := b.AllowAndSnapshot(ctx); !a {
		t.Fatalf("call 2 should be allowed")
	}
	allowed, snap := b.AllowAndSnapshot(ctx)
	if allowed {
		t.Fatalf("call 3 should be throttled (burst=2 exhausted)")
	}
	if snap.Remaining != 0 {
		t.Fatalf("snap.Remaining = %d on reject, want 0", snap.Remaining)
	}
}

// TestBucket_AllowAndSnapshot_MatchesSequentialSemantics proves the
// combined op produces the same admit decision and post-call Remaining
// as the legacy Allow() + Snapshot() pair. Without this anchor, a
// regression that flips the decision logic inside AllowAndSnapshot
// would silently change rate-limit behaviour.
func TestBucket_AllowAndSnapshot_MatchesSequentialSemantics(t *testing.T) {
	combined := NewBucket(0, 3)
	legacy := NewBucket(0, 3)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		gotAllowed, gotSnap := combined.AllowAndSnapshot(ctx)

		wantAllowed := legacy.Allow()
		wantLim, wantRem, _ := legacy.Snapshot()

		if gotAllowed != wantAllowed {
			t.Fatalf("iter %d: combined allowed=%v, legacy allowed=%v", i, gotAllowed, wantAllowed)
		}
		if gotSnap.Limit != wantLim {
			t.Fatalf("iter %d: combined Limit=%d, legacy Limit=%d", i, gotSnap.Limit, wantLim)
		}
		if gotSnap.Remaining != wantRem {
			t.Fatalf("iter %d: combined Remaining=%d, legacy Remaining=%d", i, gotSnap.Remaining, wantRem)
		}
	}
}

// TestBucket_AllowAndSnapshot_RespectsContextCancellation proves that a
// canceled context aborts the call with allowed=false. This keeps the
// signature future-proof against tracing/timeout integrations that
// thread ctx through the limiter path.
func TestBucket_AllowAndSnapshot_RespectsContextCancellation(t *testing.T) {
	b := NewBucket(0, 100)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	allowed, _ := b.AllowAndSnapshot(ctx)
	if allowed {
		t.Fatalf("canceled ctx should not admit; want allowed=false")
	}
}

// TestBucket_AllowAndSnapshot_ConcurrentSafety hammers the combined op
// from N goroutines and verifies the total admit count never exceeds
// the burst (for a high-burst, no-refill bucket). The race detector
// covers the lock-ordering invariant: a single mutex covers both the
// admit decision and snapshot capture.
func TestBucket_AllowAndSnapshot_ConcurrentSafety(t *testing.T) {
	const goroutines = 64
	const callsPer = 100
	const burst = 1000

	b := NewBucket(0, burst)
	ctx := context.Background()

	var allowedCount atomic.Int64
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < callsPer; i++ {
				if ok, _ := b.AllowAndSnapshot(ctx); ok {
					allowedCount.Add(1)
				}
			}
		}()
	}
	wg.Wait()
	total := allowedCount.Load()
	if total > int64(burst) {
		t.Fatalf("allowed %d calls, burst=%d (bucket leaked tokens under contention)", total, burst)
	}
}

// BenchmarkBucket_AllowAndSnapshot_Parallel measures the combined op
// under contention. It should run ~2x faster than Allow() + Snapshot()
// because a single mutex acquire covers both operations.
func BenchmarkBucket_AllowAndSnapshot_Parallel(b *testing.B) {
	bk := NewBucket(1e9, 1e9) // never throttled; measure pure lock cost
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, _ = bk.AllowAndSnapshot(ctx)
		}
	})
}

// BenchmarkBucket_AllowThenSnapshot_Parallel is the baseline that pays
// for two mutex acquires per request. The benchmark exists to
// demonstrate the regression-vs-fix delta side-by-side in benchstat
// output; it is not used as a CI gate.
func BenchmarkBucket_AllowThenSnapshot_Parallel(b *testing.B) {
	bk := NewBucket(1e9, 1e9)
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, _, _ = bk.Snapshot()
			_ = bk.Allow()
		}
	})
}
