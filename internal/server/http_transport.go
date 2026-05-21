// Package server — http_transport.go
//
// PERF-2026-05-21-03 (Item 6, 2026-05-21 audit): tuned package-level
// *http.Transport shared by every outbound HTTP call this server
// makes (currently the /api/v1/metrics Prom proxy and the HIBP range
// fetch in the password policy). Constructing a fresh transport per
// call resets idle connections, forces a new TLS handshake on every
// request, and pins MaxIdleConnsPerHost at the Go default of 2 — all
// of which compound at the 5s metrics-poll cadence and during HIBP
// burst checks.
//
// The singleton is intentionally NOT a *http.Client: each caller
// constructs its own client around the shared transport so per-
// callsite Timeout values remain distinct (metrics is 2s, HIBP is
// 5s) without coupling them through a shared Client field.
package server

import (
	"net/http"
	"sync"
	"time"
)

// sharedOutboundTransport returns the process-wide *http.Transport
// used by every "outbound HTTP call from the geode-ui server"
// callsite. Idle connection budget is sized for the bursty 5s-poll
// metrics workload + low-rate HIBP checks; both targets are
// long-lived hosts so reusing a TLS-warm keep-alive pool is a
// strict win.
//
// Tuning rationale:
//
//   - MaxIdleConns 100        — global pool ceiling.
//   - MaxIdleConnsPerHost 16  — comfortably above the burst factor
//     for either upstream; default of 2 was the regression.
//   - IdleConnTimeout 90s     — matches Go's DefaultTransport so a
//     remote idle-closer policy (typical proxies) sees the same
//     behaviour we already get for non-tuned clients elsewhere.
//   - ForceAttemptHTTP2 true  — both upstreams may speak h2 (Prom
//     server, Cloudflare for HIBP); h2 connection reuse compounds
//     the keep-alive win.
//   - DisableCompression false — HIBP responses compress well; the
//     CPU cost is dwarfed by the bytes saved on a sha1-prefix range
//     fetch.
//   - TLSHandshakeTimeout 10s — defensive bound; handshake on an
//     unreachable host should still surface within the per-call
//     timeout.
var (
	sharedOutboundTransportOnce sync.Once
	sharedOutboundTransportT    *http.Transport
)

func sharedOutboundTransport() *http.Transport {
	sharedOutboundTransportOnce.Do(func() {
		// Start from a fresh struct rather than cloning
		// http.DefaultTransport so an upstream stdlib bump cannot
		// silently change our pool sizing.
		sharedOutboundTransportT = &http.Transport{
			MaxIdleConns:          100,
			MaxIdleConnsPerHost:   16,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			ForceAttemptHTTP2:     true,
		}
	})
	return sharedOutboundTransportT
}

// newSharedClient returns a *http.Client wrapping the package's
// shared transport, with the supplied Timeout applied per call.
// Callers should hold the returned pointer in a package-level
// sync.Once-guarded slot if they need to amortise the allocation,
// or just call newSharedClient inline if the call frequency is low
// enough that one *http.Client alloc per call is in the noise.
func newSharedClient(timeout time.Duration) *http.Client {
	return &http.Client{Transport: sharedOutboundTransport(), Timeout: timeout}
}
