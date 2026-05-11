package server

import (
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// PERF-2026-05-11-01 / F1 (#128): server-side cache for schema-discovery
// results (labels / edge-types).
//
// Background: GET /api/v1/graphs/{graph}/labels runs
// `MATCH (n) RETURN DISTINCT labels(n) AS l` and edge-types runs
// `MATCH ()-[r]->() RETURN DISTINCT type(r) AS t` — both are full-graph
// scans (O(N) over every node/edge). The SchemaExplorer in the SPA hits
// these on every graph switch and on tab focus, so a busy multi-user
// dashboard re-pays the scan repeatedly even though graph schemas barely
// change.
//
// TTL rationale: 120 seconds. Schema-shape changes (new label, new edge
// type) are rare and operator-driven; a 2-minute staleness window is far
// shorter than the human latency to notice "I just added a node type and
// the explorer hasn't refreshed" while still collapsing the steady-state
// re-query storm from the dashboard's polling. Profile mutations
// (profile_updated / profile_deleted audit events) invalidate the cache
// immediately, so the only window for stale data is genuine schema DDL
// that bypasses the profiles CRUD path — acceptable for a discovery hint.
//
// singleflight: concurrent cache misses for the same key collapse into a
// single upstream query (golang.org/x/sync/singleflight, already a direct
// dependency). Without this, a burst of dashboard tabs opening at once
// would each fire its own full-graph scan.
const schemaCacheTTL = 120 * time.Second

// schemaCacheKind distinguishes the two cached discovery queries so a
// labels lookup and an edge-types lookup for the same (profile, graph)
// don't collide.
type schemaCacheKind string

const (
	schemaCacheKindLabels    schemaCacheKind = "labels"
	schemaCacheKindEdgeTypes schemaCacheKind = "edge-types"
)

type schemaCacheKey struct {
	profile string
	graph   string
	kind    schemaCacheKind
}

type schemaCacheEntry struct {
	value  []string
	expiry time.Time
}

// schemaCache is a small mutex-guarded TTL cache fronted by a
// singleflight.Group. The stored []string slices are treated as
// immutable once cached — callers must not mutate the returned slice
// (Labels/EdgeTypes only read it).
type schemaCache struct {
	mu      sync.Mutex
	entries map[schemaCacheKey]schemaCacheEntry
	sf      singleflight.Group
	// now is a test seam for the TTL clock; nil means time.Now.
	now func() time.Time
}

func newSchemaCache() *schemaCache {
	return &schemaCache{entries: make(map[schemaCacheKey]schemaCacheEntry)}
}

func (c *schemaCache) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// get returns the cached value for key when present and not expired.
func (c *schemaCache) get(key schemaCacheKey) ([]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if c.clock().After(e.expiry) {
		delete(c.entries, key)
		return nil, false
	}
	return e.value, true
}

func (c *schemaCache) set(key schemaCacheKey, value []string) {
	c.mu.Lock()
	c.entries[key] = schemaCacheEntry{value: value, expiry: c.clock().Add(schemaCacheTTL)}
	c.mu.Unlock()
}

// getOrLoad returns the cached value for key, or invokes loader (under
// singleflight) on a miss, caches the successful result, and returns it.
// Loader errors are not cached.
func (c *schemaCache) getOrLoad(key schemaCacheKey, loader func() ([]string, error)) ([]string, error) {
	if v, ok := c.get(key); ok {
		return v, nil
	}
	sfKey := string(key.kind) + "\x00" + key.profile + "\x00" + key.graph
	v, err, _ := c.sf.Do(sfKey, func() (any, error) {
		// Re-check inside the singleflight slot: a concurrent caller may
		// have populated the cache between our miss and acquiring the slot.
		if cached, ok := c.get(key); ok {
			return cached, nil
		}
		out, lerr := loader()
		if lerr != nil {
			return nil, lerr
		}
		c.set(key, out)
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]string), nil
}

// invalidateAll drops every cached entry. Called when a profile mutation
// (create/update/delete) lands, since the connection-profile -> graph
// mapping is not 1:1 with profilestore record IDs and scoping the
// invalidation would be error-prone; clearing all is cheap (the cache is
// tiny) and correctness-preserving.
func (c *schemaCache) invalidateAll() {
	c.mu.Lock()
	if len(c.entries) != 0 {
		c.entries = make(map[schemaCacheKey]schemaCacheEntry)
	}
	c.mu.Unlock()
}

// schemaCacheRef returns the server's schema cache, lazily initialising
// it on first use so a zero-value GraphServer (constructed via a struct
// literal in tests) still works.
func (s *GraphServer) schemaCacheRef() *schemaCache {
	s.schemaCacheOnce.Do(func() {
		s.schemaCacheInst = newSchemaCache()
	})
	return s.schemaCacheInst
}

// invalidateSchemaCache clears the schema-discovery cache. Wired into the
// profiles CRUD handlers so a profile create/update/delete forces the
// next labels/edge-types lookup to re-query upstream.
func (s *GraphServer) invalidateSchemaCache() {
	s.schemaCacheRef().invalidateAll()
}
