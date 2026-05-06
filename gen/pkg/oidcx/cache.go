// Package oidcx provides an auto-refreshing JWK Set cache that survives
// IdP key rotation without restarting the host process. It is a thin,
// import-light wrapper around jwx's jwk.AutoRefresh that:
//
//   - registers a single JWKS URL with sane defaults (15-minute minimum
//     refresh interval, refresh-on-failure semantics);
//   - exposes a Set(ctx) accessor that callers use on every JWT
//     verification path so that key rotation is picked up without
//     polling or process restart;
//   - emits structured failure callbacks via an optional Logger hook so
//     that obsx (or any other observability package) can audit refresh
//     errors without oidcx pulling obsx in as a dependency.
//
// The cache is safe for concurrent use; jwk.AutoRefresh serializes
// refresh requests internally.
package oidcx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/lestrrat-go/jwx/jwk"
)

// DefaultMinRefreshInterval is the floor for re-fetching the JWKS,
// regardless of any Cache-Control / Expires hint supplied by the IdP.
// 15 minutes balances rotation responsiveness against IdP load.
const DefaultMinRefreshInterval = 15 * time.Minute

// DefaultFetchTimeout is the default per-request timeout applied to
// the HTTP client used to fetch the JWKS document. APPSEC-7: prior
// versions inherited http.DefaultClient (no timeout), so a hung IdP
// could stall cold-start, refresh goroutines, and (once wired) every
// sync JWT verification. 30 seconds is conservative enough to cover
// slow-but-healthy IdPs while still bounding the worst case.
const DefaultFetchTimeout = 30 * time.Second

// DefaultMaxStaleness is 0, which disables the staleness cap. Callers
// that want a hard upper bound on how stale the cache may become on
// extended IdP outages must opt in via [WithMaxStaleness]. APPSEC-3.
const DefaultMaxStaleness = 0

// HTTPClient is the minimal interface jwk.AutoRefresh needs to fetch
// JWKS over HTTP. Tests and callers using a non-default transport (mTLS,
// proxy, custom timeout) inject their own client via [WithHTTPClient].
type HTTPClient = jwk.HTTPClient

// Logger is the structured logging contract the cache uses to surface
// refresh failures and stale-fallback events. Callers wire their own
// logger (slog, obsx audit, log.Logger) by passing [WithLogger]. Keeping
// this an interface rather than a concrete type lets oidcx stay free of
// any logging dependency.
type Logger interface {
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

// Option configures a [JWKCache] at construction time.
type Option func(*config)

type config struct {
	httpClient         HTTPClient
	minRefreshInterval time.Duration
	fetchTimeout       time.Duration
	maxStaleness       time.Duration
	logger             Logger
	errSinkBuffer      int
}

// WithHTTPClient configures the underlying HTTP client used to fetch the
// JWKS document. Defaults to http.DefaultClient via jwx.
func WithHTTPClient(c HTTPClient) Option {
	return func(cfg *config) { cfg.httpClient = c }
}

// WithMinRefreshInterval overrides [DefaultMinRefreshInterval]. Values
// below 1 second are clamped to 1 second to avoid pathological refresh
// storms; values above 24 hours are accepted as-is so operators can
// extend the floor for tightly cost-controlled environments.
func WithMinRefreshInterval(d time.Duration) Option {
	return func(cfg *config) {
		if d < time.Second {
			d = time.Second
		}
		cfg.minRefreshInterval = d
	}
}

// WithLogger registers a structured logger that receives a Warn entry on
// every refresh failure followed by an Error entry if the cache cannot
// serve any prior key set (cold-start failure).
func WithLogger(l Logger) Option {
	return func(cfg *config) { cfg.logger = l }
}

// WithFetchTimeout overrides the per-request HTTP timeout applied when
// fetching the JWKS document. Defaults to [DefaultFetchTimeout].
// Values <= 0 fall back to the default rather than disabling the
// timeout: a permanently-disabled timeout was the APPSEC-7 root
// cause and is not user-recoverable from the cache contract. Callers
// that need an unusual timeout policy should inject their own
// http.Client via [WithHTTPClient]; that client's Timeout is
// preserved verbatim. APPSEC-7.
func WithFetchTimeout(d time.Duration) Option {
	return func(cfg *config) {
		if d <= 0 {
			d = DefaultFetchTimeout
		}
		cfg.fetchTimeout = d
	}
}

// WithMaxStaleness configures the upper bound on how stale the cached
// JWK set may become before [JWKCache.Set] starts returning
// [ErrJWKSStaleExceeded]. Counted from the last successful fetch.
// Zero (the default) disables the cap, preserving the legacy
// "serve last-good indefinitely" behaviour. Operators running
// security-sensitive workloads should set this to a value larger
// than the JWKS rotation cadence but smaller than the access-token
// lifetime so an extended IdP outage cannot indefinitely extend the
// trust window. APPSEC-3.
func WithMaxStaleness(d time.Duration) Option {
	return func(cfg *config) {
		if d < 0 {
			d = 0
		}
		cfg.maxStaleness = d
	}
}

// JWKCache is an auto-refreshing JWK Set cache. The zero value is not
// usable; construct one with [NewJWKCache].
type JWKCache struct {
	ar           *jwk.AutoRefresh
	url          string
	maxStaleness time.Duration

	// lastFreshAt is the unix-nano timestamp of the most recent
	// successful JWKS fetch as observed by the instrumented HTTP
	// client. Used to enforce [WithMaxStaleness]. APPSEC-3.
	lastFreshAt atomic.Int64
}

// instrumentedHTTPClient wraps an [HTTPClient] and bumps a freshness
// timestamp once a 2xx response body successfully parses as a
// non-empty JWK Set. The cache uses this to enforce the max-staleness
// cap (APPSEC-3) without relying on jwk.AutoRefresh's internal state,
// which is not exposed.
//
// APPSEC-13: validating the body (rather than trusting any 2xx) is
// load-bearing for the staleness cap. A degraded-but-not-down IdP
// can return 200 OK with malformed JWK content; without the parse
// gate the cache would silently treat that as a successful refresh
// and indefinitely bypass WithMaxStaleness.
type instrumentedHTTPClient struct {
	inner     HTTPClient
	onSuccess func()
	bodyCap   int64
}

// jwksMaxResponseBytes caps the body size we are willing to read for
// the JWK Set parse check. JWK sets are tiny (typically <10 KiB);
// 512 KiB is a generous defensive ceiling against a malicious IdP
// streaming a huge body just to drain memory.
const jwksMaxResponseBytes int64 = 512 * 1024

func (c *instrumentedHTTPClient) Do(r *http.Request) (*http.Response, error) {
	resp, err := c.inner.Do(r)
	if err != nil || resp == nil {
		return resp, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp, nil
	}
	limit := c.bodyCap
	if limit <= 0 {
		limit = jwksMaxResponseBytes
	}
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, limit))
	_ = resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(body))
	if readErr != nil {
		return resp, nil
	}
	// Parse-gate: a 200 OK with malformed JWK content (CWE-754) must
	// not advance freshness. APPSEC-13.
	parsed, parseErr := jwk.Parse(body)
	if parseErr != nil || parsed == nil || parsed.Len() == 0 {
		return resp, nil
	}
	if c.onSuccess != nil {
		c.onSuccess()
	}
	return resp, nil
}

// ErrEmptyJWKSet is returned by [NewJWKCache] when the IdP responds with
// a parseable but empty JWK set on cold start. Callers should treat this
// as a misconfiguration of the JWKS endpoint.
var ErrEmptyJWKSet = errors.New("oidcx: jwks endpoint returned no keys")

// ErrNilJWKCache is returned by methods on a nil receiver. This is
// strictly a defense against caller error -- production code should
// always inject a non-nil cache.
var ErrNilJWKCache = errors.New("oidcx: nil JWKCache")

// ErrEmptyJWKSURL is returned by [NewJWKCache] when the supplied JWKS
// URL is empty. Distinct from ErrEmptyJWKSet which signals that a
// fetch succeeded but returned no keys.
var ErrEmptyJWKSURL = errors.New("oidcx: empty JWKS URL")

// ErrJWKSStaleExceeded is returned by [JWKCache.Set] when the most
// recent successful fetch is older than the configured
// [WithMaxStaleness] window. Callers should treat this as a hard
// authentication failure rather than fall back to the cached set:
// jwk.AutoRefresh would otherwise serve the stale set indefinitely
// during an extended IdP outage. APPSEC-3.
var ErrJWKSStaleExceeded = errors.New("oidcx: jwks cache exceeded max staleness")

// NewJWKCache creates a cache for the given JWKS URL and primes it by
// performing an initial Refresh against the IdP. It returns an error if
// the cold-start fetch fails or the response is empty. The supplied
// context governs only the cold-start fetch; once the cache is
// constructed, refreshes use a context derived from the host process.
func NewJWKCache(ctx context.Context, jwksURL string, opts ...Option) (*JWKCache, error) {
	if jwksURL == "" {
		return nil, ErrEmptyJWKSURL
	}

	cfg := config{
		minRefreshInterval: DefaultMinRefreshInterval,
		fetchTimeout:       DefaultFetchTimeout,
		maxStaleness:       DefaultMaxStaleness,
		errSinkBuffer:      8,
	}
	for _, opt := range opts {
		opt(&cfg)
	}

	cache := &JWKCache{
		url:          jwksURL,
		maxStaleness: cfg.maxStaleness,
	}

	// APPSEC-7: ensure the HTTP client used for JWKS fetches has a
	// finite per-request timeout. If the caller injected their own
	// client via WithHTTPClient, we trust their timeout policy. If
	// not, build an http.Client with cfg.fetchTimeout so an
	// unresponsive IdP cannot stall cold-start, refresh goroutines,
	// or sync verifies.
	httpClient := cfg.httpClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: cfg.fetchTimeout}
	}

	// APPSEC-3: instrument the client so every successful fetch
	// stamps lastFreshAt. Set() consults this to enforce the
	// max-staleness cap; jwk.AutoRefresh's internal state is not
	// observable and would otherwise let the cache serve indefinitely-
	// old keys during an extended IdP outage.
	httpClient = &instrumentedHTTPClient{
		inner: httpClient,
		onSuccess: func() {
			cache.lastFreshAt.Store(time.Now().UnixNano())
		},
	}

	ar := jwk.NewAutoRefresh(ctx)
	configureOpts := []jwk.AutoRefreshOption{
		jwk.WithMinRefreshInterval(cfg.minRefreshInterval),
		jwk.WithHTTPClient(httpClient),
	}
	ar.Configure(jwksURL, configureOpts...)

	if cfg.logger != nil {
		errSink := make(chan jwk.AutoRefreshError, cfg.errSinkBuffer)
		ar.ErrorSink(errSink)
		go drainErrors(ctx, errSink, cfg.logger)
	}

	// Cold-start: warm the cache so we fail fast on misconfiguration
	// rather than on the first auth request.
	set, err := ar.Refresh(ctx, jwksURL)
	if err != nil {
		return nil, fmt.Errorf("oidcx: cold-start JWKS fetch: %w", err)
	}
	if set == nil || set.Len() == 0 {
		return nil, ErrEmptyJWKSet
	}

	cache.ar = ar
	return cache, nil
}

// Set returns the current JWK set, triggering a refresh if the
// configured interval has elapsed. Per AutoRefresh semantics: if a
// refresh is in progress, callers receive the cached set, not a stale
// error. If the refresh fails, the cache continues to serve the
// last-good set so authentication does not flap during transient IdP
// outages -- subject to the [WithMaxStaleness] cap, which when set
// causes Set to return [ErrJWKSStaleExceeded] rather than indefinitely
// extend the trust window. APPSEC-3.
func (c *JWKCache) Set(ctx context.Context) (jwk.Set, error) {
	if c == nil {
		return nil, ErrNilJWKCache
	}
	set, err := c.ar.Fetch(ctx, c.url)
	if err != nil {
		return nil, err
	}
	if !c.freshEnough() {
		return nil, ErrJWKSStaleExceeded
	}
	return set, nil
}

// Healthy reports whether the cache is within the configured
// max-staleness window. Always true when [WithMaxStaleness] was not
// supplied. APPSEC-3.
func (c *JWKCache) Healthy() bool {
	if c == nil {
		return false
	}
	return c.freshEnough()
}

// freshEnough reports true when the configured max-staleness window
// has not elapsed since the most recent successful fetch. The check
// is permissive when MaxStaleness is 0 to preserve the legacy
// "serve last-good indefinitely" behaviour for callers that did not
// opt in.
func (c *JWKCache) freshEnough() bool {
	if c.maxStaleness <= 0 {
		return true
	}
	last := c.lastFreshAt.Load()
	if last == 0 {
		return false
	}
	return time.Since(time.Unix(0, last)) <= c.maxStaleness
}

// Refresh forces an immediate refresh of the cached JWK set. Intended
// for tests, key-rotation event handlers, and admin-triggered refresh
// endpoints. Production paths should rely on Set's auto-refresh.
func (c *JWKCache) Refresh(ctx context.Context) (jwk.Set, error) {
	if c == nil {
		return nil, ErrNilJWKCache
	}
	return c.ar.Refresh(ctx, c.url)
}

// URL reports the JWKS URL the cache is bound to.
func (c *JWKCache) URL() string {
	if c == nil {
		return ""
	}
	return c.url
}

func drainErrors(ctx context.Context, sink <-chan jwk.AutoRefreshError, logger Logger) {
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-sink:
			if !ok {
				return
			}
			logger.Warn(
				"oidcx: jwks refresh failed; serving last-good set",
				"url", e.URL,
				"error", e.Error,
			)
		}
	}
}
