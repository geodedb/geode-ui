package obsx

import (
	"expvar"
	"sync"
	"sync/atomic"
)

// MetricsProvider abstracts counter and histogram metrics.
type MetricsProvider interface {
	IncCounter(name string, labels map[string]string)
	ObserveHistogram(name string, value float64, labels map[string]string)
}

// metricsHolder wraps a MetricsProvider so atomic.Value always stores the same
// concrete type regardless of the underlying provider implementation.
type metricsHolder struct{ p MetricsProvider }

var metricsPtr atomic.Value

func init() {
	metricsPtr.Store(metricsHolder{p: &ExpvarMetrics{}})
}

// SetMetrics configures the package-level metrics provider. If m is nil, the call is a no-op.
func SetMetrics(m MetricsProvider) {
	if m != nil {
		metricsPtr.Store(metricsHolder{p: m})
	}
}

// Metrics returns the current MetricsProvider.
func Metrics() MetricsProvider {
	h, ok := metricsPtr.Load().(metricsHolder)
	if !ok {
		return &ExpvarMetrics{}
	}
	return h.p
}

// ExpvarMetrics implements MetricsProvider using expvar.
type ExpvarMetrics struct {
	mu sync.Mutex
}

func (e *ExpvarMetrics) IncCounter(name string, _ map[string]string) {
	e.mu.Lock()
	v, ok := expvar.Get(name).(*expvar.Int)
	if !ok {
		v = new(expvar.Int)
		expvar.Publish(name, v)
	}
	e.mu.Unlock()
	v.Add(1)
}

func (e *ExpvarMetrics) ObserveHistogram(name string, value float64, _ map[string]string) {
	key := name + "_sum"
	e.mu.Lock()
	v, ok := expvar.Get(key).(*expvar.Int)
	if !ok {
		v = new(expvar.Int)
		expvar.Publish(key, v)
	}
	e.mu.Unlock()
	v.Add(int64(value))
}
