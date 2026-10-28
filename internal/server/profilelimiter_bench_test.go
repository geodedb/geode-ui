package server

import (
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// BenchmarkProfileLimiter_Allow_Parallel mirrors the loginlimiter bench:
// measures the per-actor cache-hit fast path under contention.
// PERF-2026-05-13-06 / #220: pre-fix the limiter held a single sync.Mutex
// across every Allow() call. Post-fix the hot path uses
// atomic.Pointer[map] + a per-bucket mutex so concurrent goroutines on
// different actor keys no longer serialise on a global lock.
func BenchmarkProfileLimiter_Allow_Parallel(b *testing.B) {
	const keyCount = 1024
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  1e9,
		PerActorBurst: 1e9,
		Now:           time.Now,
	})
	keys := make([]string, keyCount)
	for i := range keyCount {
		keys[i] = "u\x00user" + strconv.Itoa(i)
		l.Allow(keys[i])
	}

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		var idx atomic.Uint64
		for pb.Next() {
			k := keys[idx.Add(1)%keyCount]
			l.Allow(k)
		}
	})
}
