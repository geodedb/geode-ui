package gen

import (
	"bytes"
	"expvar"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

func panicCount() int64 {
	v, ok := expvar.Get("panics").(*expvar.Int)
	if !ok {
		return 0
	}
	return v.Value()
}

func TestSafeGo_NoPanic(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)
	SafeGo("test-no-panic", func() {
		defer wg.Done()
	})
	wg.Wait()
}

func TestSafeGo_RecoversPanic(t *testing.T) {
	before := panicCount()
	SafeGo("test-panic", func() {
		panic("boom")
	})
	// Wait for the recovery handler to run and increment the counter.
	deadline := time.After(2 * time.Second)
	for panicCount() <= before {
		select {
		case <-deadline:
			t.Fatalf("panic counter did not increment: before=%d after=%d", before, panicCount())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestSafeLoop_StopsOnClose(t *testing.T) {
	stop := make(chan struct{})
	started := make(chan struct{}, 1)
	SafeLoop("test-loop", stop, func(stop <-chan struct{}) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-stop
	})
	<-started
	close(stop)
	// Give goroutine time to exit
	time.Sleep(50 * time.Millisecond)
}

func TestSafeLoop_RestartsOnPanic(t *testing.T) {
	stop := make(chan struct{})
	count := make(chan int, 5)
	n := 0
	SafeLoop("test-restart", stop, func(stop <-chan struct{}) {
		n++
		count <- n
		if n < 3 {
			panic("restart me")
		}
		<-stop
	})
	// Wait for at least 3 invocations
	for range 3 {
		select {
		case <-count:
		case <-time.After(5 * time.Second):
			t.Fatal("timed out waiting for restart")
		}
	}
	close(stop)
}

func TestSafeLoop_NormalReturn_LogsExitedNotPanic(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	stop := make(chan struct{})
	started := make(chan struct{}, 2)
	n := 0
	SafeLoop("test-normal-exit", stop, func(stop <-chan struct{}) {
		n++
		select {
		case started <- struct{}{}:
		default:
		}
		if n >= 2 {
			<-stop
		}
		// return normally without panic on first invocation
	})
	<-started // first invocation (normal return)
	<-started // second invocation (restarted)
	close(stop)
	time.Sleep(50 * time.Millisecond)

	logged := buf.String()
	if strings.Contains(logged, "restarting goroutine after panic") {
		t.Errorf("should not say 'after panic' on normal return, got: %s", logged)
	}
	if !strings.Contains(logged, "goroutine exited unexpectedly") {
		t.Errorf("expected 'goroutine exited unexpectedly', got: %s", logged)
	}
}
