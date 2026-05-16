// Package server: PERF #218 scale evidence for the single-goroutine
// cancel-reader refactor.
//
// The original 2-goroutine-per-session implementation cost 2N goroutines
// to keep N concurrent /ws/query streams parked on their inbound side.
// This file pins the new behavior: opening 100 then 1000 concurrent
// sessions must produce a goroutine count that grows at most ~N (one
// per session), not 2N.
//
// Methodology:
//  1. Snapshot runtime.NumGoroutine() with no sessions live (steady
//     state).
//  2. Spin up N sessions, each driven by a net.Pipe + wsx.NewConn so
//     no real WebSocket handshake happens. Each session calls
//     startCancelReader and parks in readMsg.
//  3. Sleep briefly so the runtime schedules every reader and they
//     reach the parked-in-Read state.
//  4. Snapshot runtime.NumGoroutine() again. Assert the delta is
//     <= 1.5 * N (the 0.5 slack absorbs runtime worker goroutines
//     that occasionally appear during scheduler churn).
//  5. Shut every session down and assert the goroutine count returns
//     to baseline within a short timeout (no leaks).
//
// The pre-PERF #218 delta would have been ~2 * N + headroom, well above
// the 1.5N ceiling.
package server

import (
	"context"
	"net"
	"runtime"
	"sync"
	"testing"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// readerHandle bundles the per-session resources so the benchmark can
// shut everything down cleanly after measurement.
type readerHandle struct {
	conn *wsx.Conn
	cr   *cancelReader
	a    net.Conn // peer end of the net.Pipe; closed at teardown
}

// startScaleSession opens one synthetic /ws/query session backed by a
// net.Pipe and returns the handle. No frames are written to the conn;
// the reader is expected to park in readMsg.
func startScaleSession(t testing.TB) *readerHandle {
	t.Helper()
	a, b := net.Pipe()
	conn := wsx.NewConn(b, wsx.Options{MaxFrame: 4096, MaxMessage: 4096})
	_, cancel := context.WithCancel(context.Background())
	s := &WSServer{}
	cr := s.startCancelReader(conn, cancel)
	return &readerHandle{conn: conn, cr: cr, a: a}
}

// teardown closes the session and waits for the reader goroutine to
// exit so the next snapshot is not racing scheduler tails.
func (h *readerHandle) teardown() {
	h.cr.Shutdown(h.conn)
	<-h.cr.Exited()
	_ = h.conn.Close()
	_ = h.a.Close()
}

// TestCancelReader_ScaleGoroutineBudget_100Sessions is the small-N
// canary. With 100 sessions, a 2-goroutine-per-session implementation
// would add ~200 goroutines; the single-goroutine implementation must
// stay at or below 100 + slack.
func TestCancelReader_ScaleGoroutineBudget_100Sessions(t *testing.T) {
	scaleGoroutineBudget(t, 100)
}

// TestCancelReader_ScaleGoroutineBudget_1000Sessions is the headline
// scale assertion: at N=1000 the difference between 1 vs 2 goroutines
// per session is 1000 goroutines (= 4-8 MB of stack). The new
// implementation must stay sub-linear vs the prior 2N baseline.
//
// Skipped under -short because spinning up 1000 net.Pipe pairs is
// slow under -race.
func TestCancelReader_ScaleGoroutineBudget_1000Sessions(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 1000-session scale test in -short mode")
	}
	scaleGoroutineBudget(t, 1000)
}

func scaleGoroutineBudget(t *testing.T, n int) {
	t.Helper()
	// Stabilise: drain any prior goroutines.
	runtime.GC()
	time.Sleep(50 * time.Millisecond)
	before := runtime.NumGoroutine()

	handles := make([]*readerHandle, n)
	for i := 0; i < n; i++ {
		handles[i] = startScaleSession(t)
	}
	// Give the runtime time to schedule every reader so each is parked
	// in readMsg before we snapshot.
	time.Sleep(200 * time.Millisecond)

	after := runtime.NumGoroutine()
	delta := after - before

	// Acceptance: delta MUST stay sub-linear vs the prior baseline.
	// The prior baseline was 2*n (coordinator + relay per session). We
	// pin the new ceiling at 1.5*n: that is well below the prior 2.0*n
	// and gives ~0.5*n slack for scheduler workers, GC sweepers, and
	// any incidental goroutines that appear during the spin-up burst.
	ceiling := n + n/2
	if delta > ceiling {
		t.Fatalf("PERF #218 regression: %d sessions added %d goroutines (ceiling %d, prior 2N baseline %d)",
			n, delta, ceiling, 2*n)
	}

	// Defensive lower bound: we MUST have at least one goroutine per
	// session, otherwise the reader is not actually starting and the
	// test is meaningless.
	if delta < n-n/10 {
		t.Fatalf("PERF #218 sanity: only %d goroutines for %d sessions; reader is not starting",
			delta, n)
	}

	// Teardown in parallel so the test runs in seconds not minutes.
	var wg sync.WaitGroup
	wg.Add(len(handles))
	for _, h := range handles {
		go func(h *readerHandle) {
			defer wg.Done()
			h.teardown()
		}(h)
	}
	wg.Wait()

	// Post-teardown leak check: after Exited() has fired for every
	// session the goroutine count should return to the baseline within
	// a short window.
	runtime.GC()
	time.Sleep(100 * time.Millisecond)
	settled := runtime.NumGoroutine()
	residual := settled - before
	if residual > n/10 {
		t.Fatalf("PERF #218 leak: %d goroutines still alive after teardown (baseline %d, settled %d)",
			residual, before, settled)
	}
}

// BenchmarkCancelReader_PerSessionOverhead is the per-op cost of
// spawning AND tearing down one cancel-reader session. The interesting
// numbers are ns/op (how fast we can spin a session) and allocs/op
// (how many heap objects each session costs). The PERF #218 refactor
// drops the per-session allocations by eliminating the second goroutine
// stack + the relay channel.
func BenchmarkCancelReader_PerSessionOverhead(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		h := startScaleSession(b)
		h.teardown()
	}
}
