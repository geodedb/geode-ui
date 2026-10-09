package server

import (
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestLoginLimiter_ConcurrentInsertRace deliberately drives the COW
// insert path under contention. 64 goroutines × 200 iterations all
// touch overlapping (50% shared / 50% unique) IPs to exercise:
//
//   - the lookup-then-insert race (two readers miss simultaneously,
//     both call insertIPBucket, the second must observe the first's
//     install under the writer mutex and return the same *ipBucket)
//   - the COW publish race (a reader holds an old map snapshot while
//     a writer publishes a new one; the reader's bucket pointer must
//     stay valid)
//
// Runs under -race so any data race on perIP, perUserFails, or the
// bucket fields trips the detector.
func TestLoginLimiter_ConcurrentInsertRace(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1e9,
		PerIPBurst:    1e9,
		FailThreshold: 1 << 30,
		LockoutWindow: time.Hour,
		Now:           clk.Now,
	})
	const goroutines = 64
	const iterations = 200
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := range goroutines {
		go func(g int) {
			defer wg.Done()
			for i := range iterations {
				// Half the keys overlap across goroutines, half are
				// unique — guarantees both insert-race and shared-bucket
				// contention.
				var key string
				if i%2 == 0 {
					key = "shared-" + strconv.Itoa(i%32)
				} else {
					key = "uniq-" + strconv.Itoa(g) + "-" + strconv.Itoa(i)
				}
				l.Allow(key, "default", "alice")
				if i%17 == 0 {
					l.NoteFail("default", "alice")
				}
				if i%23 == 0 {
					l.NoteSuccess("default", "alice")
				}
			}
		}(g)
	}
	wg.Wait()
}

// TestProfileLimiter_ConcurrentInsertRace mirrors the LoginLimiter test
// for the profile limiter's single perActor map. Same intent: exercise
// COW insert + concurrent reader to surface any race under -race.
func TestProfileLimiter_ConcurrentInsertRace(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	l := NewProfileLimiter(ProfileLimiterConfig{
		PerActorRate:  1e9,
		PerActorBurst: 1e9,
		Now:           clk.Now,
	})
	const goroutines = 64
	const iterations = 200
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := range goroutines {
		go func(g int) {
			defer wg.Done()
			for i := range iterations {
				var key string
				if i%2 == 0 {
					key = "u\x00shared-" + strconv.Itoa(i%32)
				} else {
					key = "u\x00uniq-" + strconv.Itoa(g) + "-" + strconv.Itoa(i)
				}
				l.Allow(key)
			}
		}(g)
	}
	wg.Wait()
}

// BenchmarkLoginLimiter_Allow_Parallel measures the per-IP cache-hit fast
// path under contention. PERF-2026-05-13-06 / #220: pre-fix the limiter
// held a single sync.Mutex across every Allow() call, serialising the
// hot path. Post-fix the hot path uses atomic.Pointer[map] + a
// per-bucket mutex so concurrent goroutines hitting different IPs no
// longer block one another.
//
// Each goroutine rotates over `keyCount` unique IPs to spread contention
// across many buckets (the realistic burst-attack shape). PerIPBurst
// is set high enough that no request rate-limits within the bench window,
// so we measure pure path overhead, not rejection bookkeeping.
func BenchmarkLoginLimiter_Allow_Parallel(b *testing.B) {
	const keyCount = 1024
	l := NewLoginLimiter(LoginLimiterConfig{
		PerIPRate:     1e9, // unlimited for bench
		PerIPBurst:    1e9,
		FailThreshold: 1 << 30,
		LockoutWindow: time.Hour,
		Now:           time.Now,
	})
	// Pre-populate so we benchmark the cache-hit path, not the insert
	// path. Insert is the rare cold path; cache-hit is the hot path the
	// 2-map redesign targets.
	keys := make([]string, keyCount)
	for i := range keyCount {
		keys[i] = "10.0." + strconv.Itoa(i/256) + "." + strconv.Itoa(i%256)
		l.Allow(keys[i], "default", "alice")
	}

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		var idx uint64
		for pb.Next() {
			k := keys[atomic.AddUint64(&idx, 1)%keyCount]
			l.Allow(k, "default", "alice")
		}
	})
}
