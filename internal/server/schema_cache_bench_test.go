package server

import (
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestSchemaCache_ConcurrentReadersAndWriters exercises the RWMutex
// hot path under contention: many concurrent get() readers interleaved
// with rare set() and invalidateAll() writers. Pinned for race-free
// behaviour under -race so any RLock/Lock balance bug or torn map
// access trips the detector.
//
// PERF-2026-05-13-07 (#223): standalone stress test that doesn't rely
// on the schema-test fakeDriver harness (which uses a process-scoped
// sql.Register that confounds -count>1 runs); this test can be run
// under -race -count=10 cleanly.
func TestSchemaCache_ConcurrentReadersAndWriters(t *testing.T) {
	t.Parallel()
	c := newSchemaCache()
	// Pre-populate.
	const keyCount = 64
	keys := make([]schemaCacheKey, keyCount)
	for i := range keyCount {
		k := schemaCacheKey{
			profile: "p" + strconv.Itoa(i%4),
			graph:   "g" + strconv.Itoa(i%8),
			kind:    schemaCacheKindLabels,
		}
		if i%2 == 0 {
			k.kind = schemaCacheKindEdgeTypes
		}
		keys[i] = k
		c.set(k, []string{"a", "b", "c"})
	}

	const readers = 32
	const writers = 4
	const invalidators = 1
	const iterations = 500
	var wg sync.WaitGroup
	wg.Add(readers + writers + invalidators)
	for range readers {
		go func() {
			defer wg.Done()
			for i := range iterations {
				_, _ = c.get(keys[i%keyCount])
			}
		}()
	}
	for w := range writers {
		go func(w int) {
			defer wg.Done()
			for i := range iterations {
				c.set(keys[(w*7+i)%keyCount], []string{"x", "y", strconv.Itoa(i)})
			}
		}(w)
	}
	for range invalidators {
		go func() {
			defer wg.Done()
			for range iterations / 10 {
				c.invalidateAll()
			}
		}()
	}
	wg.Wait()
}

// BenchmarkSchemaCache_Get_Parallel measures the cache-hit read path
// under contention. PERF-2026-05-13-07 / #223: pre-fix the cache held
// a single sync.Mutex on every get(); on a multi-tab dashboard a busy
// burst of labels+edge-types lookups serialised every reader. Swapping
// to RWMutex lets the cache-hit path scale with reader count.
func BenchmarkSchemaCache_Get_Parallel(b *testing.B) {
	c := newSchemaCache()
	const keyCount = 64
	// Pre-populate with realistic per-(profile, graph, kind) shapes.
	keys := make([]schemaCacheKey, keyCount)
	for i := range keyCount {
		k := schemaCacheKey{
			profile: "p" + strconv.Itoa(i%4),
			graph:   "g" + strconv.Itoa(i%8),
			kind:    schemaCacheKindLabels,
		}
		if i%2 == 0 {
			k.kind = schemaCacheKindEdgeTypes
		}
		keys[i] = k
		c.set(k, []string{"a", "b", "c"})
	}
	// Pin clock far in the future so set() entries never expire mid-bench.
	c.now = func() time.Time { return time.Unix(0, 0) }

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		var idx uint64
		for pb.Next() {
			k := keys[atomic.AddUint64(&idx, 1)%keyCount]
			_, _ = c.get(k)
		}
	})
}
