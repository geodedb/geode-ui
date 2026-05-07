package gen

import (
	"expvar"
	"log/slog"
	"runtime/debug"
	"time"
)

var panicCounter = func() *expvar.Int {
	if v, ok := expvar.Get("panics").(*expvar.Int); ok {
		return v
	}
	v := new(expvar.Int)
	expvar.Publish("panics", v)
	return v
}()

// SafeGo launches fn in a goroutine with panic recovery.
// Panics are logged via slog.Error and counted in the "panics" expvar.
func SafeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				panicCounter.Add(1)
				slog.Error("goroutine panic recovered",
					"goroutine", name,
					"panic", r,
					"stack", string(debug.Stack()),
				)
			}
		}()
		fn()
	}()
}

// SafeLoop launches fn in a goroutine that restarts on panic with
// exponential backoff (100ms to 5s cap). Stops when stop closes.
func SafeLoop(name string, stop <-chan struct{}, fn func(stop <-chan struct{})) {
	go func() {
		backoff := 100 * time.Millisecond
		const maxBackoff = 5 * time.Second
		for {
			panicked := true
			func() {
				defer func() {
					if r := recover(); r != nil {
						panicCounter.Add(1)
						slog.Error("goroutine panic recovered",
							"goroutine", name,
							"panic", r,
							"stack", string(debug.Stack()),
						)
					}
				}()
				fn(stop)
				panicked = false
			}()
			select {
			case <-stop:
				return
			default:
			}
			if panicked {
				slog.Warn("restarting goroutine after panic", "goroutine", name, "backoff", backoff)
			} else {
				slog.Warn("goroutine exited unexpectedly", "goroutine", name, "backoff", backoff)
			}
			select {
			case <-stop:
				return
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}()
}
