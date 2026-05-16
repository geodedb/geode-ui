package mcpx

import (
	"bufio"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/gen"
	"geodedb.com/geode-ui/gen/pkg/obsx"
	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// ErrInvalidRequest indicates a malformed JSON-RPC 2.0 request.
var ErrInvalidRequest = errors.New("mcpx: invalid request")

// ErrToolTimeout indicates a tool exceeded its allotted time.
var ErrToolTimeout = errors.New("mcpx: tool timeout")

// Tool is a function that takes the request-scoped context plus params as
// raw JSON and returns result JSON. The ctx carries any verifier-derived
// values (e.g. JWT claims) so tool bodies can read them natively rather
// than reaching for a per-goroutine stash. For STDIO the ctx is
// context.Background() (no per-request enrichment is possible there).
type Tool func(ctx context.Context, params jsontext.Value) (jsontext.Value, error)

// AuditMCP provides hooks for auth and tool-call events.
var AuditMCP = struct {
	AuthOK   func(transport, sub string)
	AuthFail func(transport, reason string)
	ToolCall func(name string)
}{
	AuthOK:   func(string, string) {},
	AuthFail: func(string, string) {},
	ToolCall: func(string) {},
}

// lightweight token bucket for per-tool rate limiting
type bucket struct {
	mu          sync.Mutex
	tokens      float64
	last        time.Time
	rate, burst float64
}

func (b *bucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	dt := now.Sub(b.last).Seconds()
	b.tokens += dt * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}

func (b *bucket) snapshot() (int, int, time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	limit := int(b.burst)
	remaining := int(b.tokens)
	reset := time.Now().Add(time.Second)
	return limit, remaining, reset
}

var toolBuckets map[string]*bucket
var toolTimeout = 5 * time.Second
var authVerifier func(*http.Request) (context.Context, error)
var toolRoles map[string][]string
var wsOriginAllowlist []string
var wsAllowAnyOrigin bool

// serialTools marks tools that must execute strictly in batch order
// even when parallel batch dispatch (PERF #238) is enabled. Tools
// that mutate shared in-process state (counters, caches, queue
// position) belong here. Mirrors SetToolRoles semantics: absent or
// false means parallel-eligible.
var serialTools map[string]bool

// batchMaxConcurrency caps the in-flight goroutine count for parallel
// batch dispatch (PERF #238). 8 is the documented default — large
// enough to overlap I/O-bound tools, small enough not to starve a
// shared DB connection pool or thread the GC. SetBatchMaxConcurrency
// overrides at runtime.
var batchMaxConcurrency int64 = 8

// batchToolTimeout overrides toolTimeout for batch members; it
// defaults to 30 seconds per PERF #238 design, on the theory that
// batch dispatch lets a slow tool not block the whole pipeline so a
// longer per-tool deadline is acceptable. Set to 0 to inherit
// toolTimeout.
var batchToolTimeout = 30 * time.Second

// SetBatchMaxConcurrency overrides the parallel-batch concurrency cap
// (default 8). A value <= 0 falls back to the default; 1 effectively
// disables parallelism (serial dispatch) without re-introducing the
// torn-read between Snapshot and Allow.
func SetBatchMaxConcurrency(n int64) {
	if n <= 0 {
		batchMaxConcurrency = 8
		return
	}
	batchMaxConcurrency = n
}

// BatchMaxConcurrency reports the current cap. Used by tests and by
// operator-facing /debug/config introspection.
func BatchMaxConcurrency() int64 { return batchMaxConcurrency }

// SetBatchToolTimeout overrides the per-tool deadline applied inside
// parallel batch dispatch (default 30s). Set to 0 to fall back to
// SetToolTimeout(). Both values are evaluated per-tool inside the
// dispatcher so a runtime change takes effect on the next batch.
func SetBatchToolTimeout(d time.Duration) { batchToolTimeout = d }

// BatchToolTimeout reports the current per-tool timeout for batch
// dispatch. Returns 0 if SetBatchToolTimeout has not been called and
// toolTimeout should be used.
func BatchToolTimeout() time.Duration { return batchToolTimeout }

// SetSerialTools marks tools whose batch invocations must run in
// strict request order (no parallelism). Pass nil to clear. Mirrors
// SetToolRoles for the parallel-batch opt-out. Tools that mutate
// shared state belong on this list. PERF #238.
func SetSerialTools(s map[string]bool) {
	if s == nil {
		serialTools = nil
		return
	}
	cpy := make(map[string]bool, len(s))
	for k, v := range s {
		cpy[k] = v
	}
	serialTools = cpy
}

// isSerialTool reports whether name is registered as serial-only.
// Returns false if SetSerialTools was never called or name is absent.
func isSerialTool(name string) bool {
	if serialTools == nil {
		return false
	}
	return serialTools[name]
}

// ctxRolesKey is the unexported context key under which mcpx stashes the
// caller's role set for per-tool role enforcement. It is owned by this
// package so consumers go through ContextWithRoles / RolesFromContext
// rather than guessing the key.
type ctxRolesKey struct{}

// ContextWithRoles returns a copy of ctx carrying the supplied role set.
// The MCP auth verifier (or an adapter around it) calls this so the
// dispatcher can enforce per-tool required-role policy without re-parsing
// the bearer token. A nil/empty slice is stored as-is (RolesFromContext
// then reports no roles).
func ContextWithRoles(ctx context.Context, roles []string) context.Context {
	return context.WithValue(ctx, ctxRolesKey{}, roles)
}

// RolesFromContext returns the role set stashed by ContextWithRoles, or
// nil if none was set.
func RolesFromContext(ctx context.Context) []string {
	if ctx == nil {
		return nil
	}
	if v, ok := ctx.Value(ctxRolesKey{}).([]string); ok {
		return v
	}
	return nil
}

// SetToolRoles configures the per-tool required-role policy. For each
// tool name with a non-empty role list, a tools/call dispatch is allowed
// only if the caller's context (see ContextWithRoles) carries at least
// one of the listed roles; tools absent from the map (or mapped to an
// empty list) have no role requirement. Mirrors SetToolBuckets.
func SetToolRoles(roles map[string][]string) { toolRoles = roles }

// DefaultMaxHTTPBodyBytes is the default per-request body cap that
// HandleHTTP enforces via io.LimitReader. Mirrors the route-level
// MaxBytesReader cap in genapi's emitted /mcp wrapper. APPSEC-1.
const DefaultMaxHTTPBodyBytes int64 = 1 << 20

var maxHTTPBodyBytes int64 = DefaultMaxHTTPBodyBytes

// MaxHTTPBodyBytes reports the current body cap for HandleHTTP.
// APPSEC-1.
func MaxHTTPBodyBytes() int64 { return maxHTTPBodyBytes }

// SetMaxHTTPBodyBytes configures the per-request body cap that
// HandleHTTP applies to incoming JSON-RPC requests. Set to 0 to
// disable the cap (operators that have already wrapped the route at
// a higher layer may opt out, but doing so is discouraged because it
// re-opens the unbounded io.ReadAll DoS path that motivated this
// finding). APPSEC-1.
func SetMaxHTTPBodyBytes(n int64) { maxHTTPBodyBytes = n }

// SetToolBuckets configures per-tool rate limiting buckets.
func SetToolBuckets(tools map[string]Tool, rate, burst float64) {
	toolBuckets = BuildToolBuckets(tools, rate, burst)
}

// SetToolTimeout sets the per-tool timeout for execution.
func SetToolTimeout(d time.Duration) { toolTimeout = d }

// SetAuthVerifier configures MCP request authentication verification.
// On success the verifier returns the request-scoped context to thread
// into tool bodies (e.g. r.Context() after a JWT middleware has stashed
// claims on it); on failure it returns (nil, err) and the request is
// rejected with HTTP 401 before any dispatch. When unset,
// HandleHTTP/ServeWS fail closed.
func SetAuthVerifier(v func(*http.Request) (context.Context, error)) { authVerifier = v }

// SetWSOriginAllowlist configures allowed Origin values for MCP WebSocket
// upgrades. SEC-0008: an empty list now means fail-closed under
// UpgradeStrict — every upgrade is rejected with HTTP 403 unless
// SetWSAllowAnyOrigin(true) has been called. The legacy "empty list
// disables origin checks" behaviour was a fail-open default that
// allowed cross-origin WS hijack on the privileged MCP surface.
func SetWSOriginAllowlist(origins []string) {
	if len(origins) == 0 {
		wsOriginAllowlist = nil
		return
	}
	cpy := make([]string, len(origins))
	copy(cpy, origins)
	wsOriginAllowlist = cpy
}

// auditConfigChange dispatches package-config audit events. The
// indirection lets tests intercept emissions without depending on
// obsx's stdout JSON path. APPSEC-14.
var auditConfigChange = obsx.LogAudit

// SetWSAllowAnyOrigin toggles the explicit "any origin" override for
// MCP WebSocket upgrades. SEC-0008: callers MUST opt in by passing
// true to bypass the fail-closed allowlist gate. Intended for STDIO-
// adjacent or non-browser deployments where origin policing is not
// the right protection. Defaults to false.
//
// APPSEC-14: every false → true and true → false transition is
// recorded as a structured audit event so a misconfiguration leaves
// a forensic trail. Idempotent calls (no transition) are silent so
// config-reload callers do not flood the audit log.
func SetWSAllowAnyOrigin(allow bool) {
	prev := wsAllowAnyOrigin
	wsAllowAnyOrigin = allow
	switch {
	case !prev && allow:
		auditConfigChange("mcp_ws_allow_any_origin_enabled", map[string]any{
			"warning": "SEC-0008 fail-closed gate disabled; all WS upgrades will accept any Origin header value",
		})
	case prev && !allow:
		auditConfigChange("mcp_ws_allow_any_origin_disabled", map[string]any{
			"info": "SEC-0008 fail-closed gate re-enabled; WS upgrades fall back to OriginAllowlist enforcement",
		})
	}
}

// BuildToolBuckets constructs default buckets for tools.
func BuildToolBuckets(tools map[string]Tool, rate, burst float64) map[string]*bucket {
	m := make(map[string]*bucket, len(tools))
	for k := range tools {
		m[k] = &bucket{tokens: burst, last: time.Now(), rate: rate, burst: burst}
	}
	return m
}

// HandleHTTP implements JSON-RPC 2.0 over HTTP, including single, batch, and notifications.
func HandleHTTP(w http.ResponseWriter, r *http.Request, tools map[string]Tool) {
	id := obsx.RequestIDFrom(r)
	if authVerifier == nil {
		AuditMCP.AuthFail("http", "missing verifier")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "http", "id": id, "reason": "missing verifier"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx, err := authVerifier(r)
	if err != nil {
		AuditMCP.AuthFail("http", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "http", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if ctx == nil {
		ctx = r.Context()
	}
	AuditMCP.AuthOK("http", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "http", "id": id})
	w.Header().Set("Content-Type", "application/json")

	body, err := readBoundedBody(r.Body, maxHTTPBodyBytes)
	if err != nil {
		switch err {
		case errBodyTooLarge:
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "request body too large"))
		default:
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
		}
		return
	}
	dispatchHTTP(ctx, w, body, tools)
}

// errBodyTooLarge is returned by readBoundedBody when a request body
// strictly exceeds the configured cap. Distinct sentinel so HandleHTTP
// can map it to HTTP 413 rather than the generic 400.
var errBodyTooLarge = errors.New("mcpx: request body exceeds limit")

// readBoundedBody streams r through io.LimitReader with cap+1 bytes so
// any read returning more than cap bytes signals a violation. A cap
// value of 0 or negative disables bounding (legacy behaviour;
// discouraged because of CWE-770). APPSEC-1.
func readBoundedBody(r io.Reader, cap int64) ([]byte, error) {
	if cap <= 0 {
		return io.ReadAll(r)
	}
	body, err := io.ReadAll(io.LimitReader(r, cap+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > cap {
		return nil, errBodyTooLarge
	}
	return body, nil
}

// dispatchHTTP variant of dispatch that sets http.StatusBadRequest for
// malformed top-level JSON. Splitting from dispatch lets the STDIO/WS
// paths stay header-agnostic.
func dispatchHTTP(ctx context.Context, w http.ResponseWriter, body []byte, tools map[string]Tool) {
	if ctx == nil {
		ctx = context.Background()
	}
	trimmed := bytesTrimSpace(body)
	if len(trimmed) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
		return
	}
	switch trimmed[0] {
	case '{':
		env, err := decodeEnvelope(trimmed)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
			return
		}
		if env.Method == "tools/call" {
			if name := extractToolNameRaw(env.Params); name != "" {
				if bk, ok := toolBuckets[name]; ok {
					lim, rem, reset := bk.snapshot()
					setRateHeaders(w, lim, rem, reset)
				}
			}
		}
		res := handleRaw(ctx, env, tools, toolBuckets)
		if res == nil {
			// notification: legacy behavior writes "null"
			_, _ = w.Write([]byte("null"))
			return
		}
		_ = json.MarshalWrite(w, res)
	case '[':
		var batch []jsontext.Value
		if err := json.Unmarshal(trimmed, &batch); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
			return
		}
		out := dispatchBatch(ctx, batch, tools, toolBuckets)
		_ = json.MarshalWrite(w, out)
	default:
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
	}
}

// dispatchBatch executes a JSON-RPC 2.0 batch with bounded parallel
// concurrency and ordered response reassembly (PERF #238).
//
// Per the design:
//   - max-concurrency = batchMaxConcurrency (default 8, settable via
//     SetBatchMaxConcurrency). Implemented as a semaphore channel so
//     a slot is acquired before launching each worker goroutine.
//   - per-tool timeout = batchToolTimeout (default 30s, settable via
//     SetBatchToolTimeout). handleRaw applies the per-tool deadline
//     internally via context.WithTimeout.
//   - ordered reassembly = responses are written into a fixed-size
//     slice indexed by request position; notifications (nil
//     response) leave that slot empty and are filtered before the
//     wire response is built.
//   - serial opt-out = tools registered via SetSerialTools dispatch
//     in strict request order (one in-flight at a time across the
//     whole batch). The default decision uses isSerialTool keyed on
//     the tool name extracted from the request envelope.
//
// Notifications (envelopes with no id) are dispatched but produce no
// response, mirroring the pre-fix loop. Malformed envelopes are
// skipped (compatibility with the pre-fix continue-on-err behaviour).
func dispatchBatch(ctx context.Context, batch []jsontext.Value, tools map[string]Tool, buckets map[string]*bucket) []any {
	if ctx == nil {
		ctx = context.Background()
	}
	n := len(batch)
	if n == 0 {
		return []any{}
	}
	results := make([]any, n)
	// Decode envelopes first so the serial/parallel decision and
	// the index-keyed result slot are both known before any worker
	// launches. Malformed envelopes are recorded as a sentinel and
	// skipped in the final output assembly.
	envs := make([]*rawEnvelope, n)
	serialIndices := make([]int, 0, n)
	parallelIndices := make([]int, 0, n)
	for i, raw := range batch {
		env, err := decodeEnvelope(raw)
		if err != nil {
			envs[i] = nil
			continue
		}
		envs[i] = env
		name := extractToolNameFromEnv(env)
		if isSerialTool(name) {
			serialIndices = append(serialIndices, i)
		} else {
			parallelIndices = append(parallelIndices, i)
		}
	}

	// Serial pass: dispatch in batch order, one at a time. Tools
	// that mutate shared state never race each other; serial-tool
	// dispatch also runs before parallel dispatch starts so a
	// serial-then-parallel batch sees a clean state when the
	// parallel phase begins.
	for _, i := range serialIndices {
		results[i] = handleRawWithTimeout(ctx, envs[i], tools, buckets)
	}

	// Parallel pass: bounded by batchMaxConcurrency via a semaphore
	// channel. errgroup-style fan-out without the explicit error
	// channel because handleRawWithTimeout always returns a usable
	// envelope (success or RPC-error) — there is no Go-level error
	// to propagate.
	cap := batchMaxConcurrency
	if cap <= 0 {
		cap = 8
	}
	sem := make(chan struct{}, cap)
	var wg sync.WaitGroup
	for _, idx := range parallelIndices {
		idx := idx // capture for closure
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			results[idx] = handleRawWithTimeout(ctx, envs[idx], tools, buckets)
		}()
	}
	wg.Wait()

	// Assemble the on-wire response array. Notifications (nil res)
	// and undecodable envelopes (envs[i] == nil) drop out so the
	// wire format matches the pre-fix loop.
	out := make([]any, 0, n)
	for i := 0; i < n; i++ {
		if envs[i] == nil {
			continue
		}
		if results[i] != nil {
			out = append(out, results[i])
		}
	}
	return out
}

// handleRawWithTimeout wraps handleRaw with the batch per-tool
// timeout. handleRaw already applies toolTimeout internally; this
// indirection lets the batch path use a more generous deadline
// (default 30s) without altering the single-request path.
func handleRawWithTimeout(ctx context.Context, env *rawEnvelope, tools map[string]Tool, buckets map[string]*bucket) any {
	if env == nil {
		return nil
	}
	if batchToolTimeout > 0 {
		// Apply the batch-specific deadline to the per-tool context.
		// handleRaw will derive its own context.WithTimeout from this
		// for the tool body, which is the inner deadline.
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, batchToolTimeout)
		defer cancel()
	}
	return handleRaw(ctx, env, tools, buckets)
}

// extractToolNameFromEnv pulls the tool name out of a decoded
// envelope's params for tools/call requests. Returns "" for any
// other method or malformed params; isSerialTool(""")  is false so
// non-tools/call methods naturally take the parallel path.
func extractToolNameFromEnv(env *rawEnvelope) string {
	if env == nil || env.Method != "tools/call" {
		return ""
	}
	return extractToolNameRaw(env.Params)
}

// ServeWS upgrades to WS and serves JSON-RPC 2.0 messages bidirectionally (simple text frames JSON).
func ServeWS(w http.ResponseWriter, r *http.Request, tools map[string]Tool) {
	id := obsx.RequestIDFrom(r)
	if authVerifier == nil {
		AuditMCP.AuthFail("ws", "missing verifier")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "ws", "id": id, "reason": "missing verifier"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx, err := authVerifier(r)
	if err != nil {
		AuditMCP.AuthFail("ws", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "ws", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if ctx == nil {
		ctx = r.Context()
	}
	AuditMCP.AuthOK("ws", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "ws", "id": id})
	// SEC-0008: UpgradeStrict fails closed when wsOriginAllowlist is
	// empty/nil unless wsAllowAnyOrigin was explicitly enabled. The
	// MCP WS surface is privileged; browser-side cross-origin hijack
	// is unacceptable, so we never want the legacy fail-open default.
	conn, err := wsx.UpgradeStrict(w, r, wsx.Options{
		OriginAllowlist: wsOriginAllowlist,
		AllowAnyOrigin:  wsAllowAnyOrigin,
		MaxFrame:        1 << 20,
		MaxMessage:      1 << 20,
	})
	if err != nil {
		// UpgradeStrict has already written the 403 response on
		// origin failures; only the protocol-error path needs an
		// explicit 400 here.
		if !errors.Is(err, wsx.ErrOriginNotAllowed) {
			w.WriteHeader(http.StatusBadRequest)
		}
		return
	}
	defer func() { _ = conn.Close() }()
	for {
		op, msg, err := conn.ReadMessage()
		if err != nil || op == 0x8 {
			return
		}
		if op != 0x1 {
			continue
		}
		trimmed := bytesTrimSpace(msg)
		if len(trimmed) == 0 || trimmed[0] != '{' {
			// WS only handles single requests (no batch in this transport).
			_ = conn.WriteMessage(0x1, []byte(`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid request"}}`))
			continue
		}
		env, e := decodeEnvelope(trimmed)
		if e != nil {
			_ = conn.WriteMessage(0x1, []byte(`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid request"}}`))
			continue
		}
		res := handleRaw(ctx, env, tools, toolBuckets)
		if res == nil {
			continue
		}
		b, _ := json.Marshal(res)
		_ = conn.WriteMessage(0x1, b)
	}
}

// ServeSTDIO runs a JSON-RPC 2.0 loop over stdin/stdout for MCP.
func ServeSTDIO(tools map[string]Tool) error {
	return serveSTDIOWith(os.Stdin, os.Stdout, tools)
}

// serveSTDIOWith is an internal helper to enable tests with pipes.
// STDIO has no per-request enrichment hook, so tool bodies receive
// context.Background(). This is the fail-safe default: a tool that
// expects a verifier-derived value will see the zero value rather
// than another request's leaked context.
func serveSTDIOWith(in io.Reader, out io.Writer, tools map[string]Tool) error {
	ctx := context.Background()
	br := bufio.NewReader(in)
	for {
		line, err := br.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		trimmed := bytesTrimSpace(line)
		if len(trimmed) == 0 {
			_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
			_, _ = out.Write([]byte("\n"))
			continue
		}
		switch trimmed[0] {
		case '{':
			env, e := decodeEnvelope(trimmed)
			if e != nil {
				_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
				_, _ = out.Write([]byte("\n"))
				continue
			}
			res := handleRaw(ctx, env, tools, toolBuckets)
			if res == nil { // notification
				_, _ = out.Write([]byte("null\n"))
				continue
			}
			_ = json.MarshalWrite(out, res)
			_, _ = out.Write([]byte("\n"))
		case '[':
			var batch []jsontext.Value
			if e := json.Unmarshal(trimmed, &batch); e != nil {
				_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
				_, _ = out.Write([]byte("\n"))
				continue
			}
			outArr := dispatchBatch(ctx, batch, tools, toolBuckets)
			_ = json.MarshalWrite(out, outArr)
			_, _ = out.Write([]byte("\n"))
		default:
			_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
			_, _ = out.Write([]byte("\n"))
		}
	}
}

func bytesTrimSpace(b []byte) []byte {
	i := 0
	for i < len(b) && (b[i] == ' ' || b[i] == '\t' || b[i] == '\r' || b[i] == '\n') {
		i++
	}
	j := len(b) - 1
	for j >= i && (b[j] == ' ' || b[j] == '\t' || b[j] == '\r' || b[j] == '\n') {
		j--
	}
	return b[i : j+1]
}

// rawEnvelope is the minimally-decoded JSON-RPC 2.0 request envelope.
// id and params are kept as raw jsontext.Value so the dispatcher can
// splice them back into the response (id) and forward them to a tool
// (params) without an intermediate any/map round-trip. See PERF-0041.
type rawEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id,omitzero"`
	Method  string         `json:"method"`
	Params  jsontext.Value `json:"params,omitzero"`
}

// rawToolCall is the minimally-decoded params payload for tools/call.
// The inner Params is forwarded to the tool unchanged.
type rawToolCall struct {
	Name   string         `json:"name"`
	Params jsontext.Value `json:"params,omitzero"`
}

// decodeEnvelope parses a single JSON-RPC 2.0 request into rawEnvelope.
// It does not validate the protocol version; that is the caller's job.
func decodeEnvelope(raw jsontext.Value) (*rawEnvelope, error) {
	env := &rawEnvelope{}
	if err := json.Unmarshal(raw, env); err != nil {
		return nil, err
	}
	return env, nil
}

// extractToolNameRaw reads only the "name" field from a raw tools/call
// params payload without decoding the inner params bytes. Returns ""
// for malformed/missing inputs.
func extractToolNameRaw(params jsontext.Value) string {
	if len(params) == 0 {
		return ""
	}
	var p struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return ""
	}
	return p.Name
}

// rpcResultEnvelope is the success-response envelope written for
// non-tools/call paths. result is set as a Go value (map/slice/etc).
type rpcResultEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Result  any            `json:"result"`
}

// rpcRawResultEnvelope writes a tools/call success response by splicing
// the tool's raw jsontext.Value result back in unchanged. This avoids
// the post-call json.Unmarshal(out, &v) round-trip that PERF-0041
// targeted.
type rpcRawResultEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Result  jsontext.Value `json:"result"`
}

// rpcErrEnvelope is the error-response envelope.
type rpcErrEnvelope struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      jsontext.Value `json:"id"`
	Error   rpcErrPayload  `json:"error"`
}

type rpcErrPayload struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// handleRaw is the single-request dispatcher operating on a
// minimally-decoded envelope. Returns nil for notifications.
func handleRaw(ctx context.Context, env *rawEnvelope, tools map[string]Tool, buckets map[string]*bucket) any {
	if ctx == nil {
		ctx = context.Background()
	}
	if env.JSONRPC != "2.0" {
		return objErrRaw(env.ID, -32600, "invalid request")
	}
	// Notifications have no id field. jsontext.Value zero-length means
	// the id key was absent or set to null/undefined.
	if isNullID(env.ID) {
		return nil
	}
	switch env.Method {
	case "initialize":
		return objResRaw(env.ID, map[string]any{"capabilities": map[string]any{}})
	case "ping":
		return objResRaw(env.ID, map[string]any{"ok": true})
	case "shutdown":
		return objResRaw(env.ID, map[string]any{"ok": true})
	case "tools/list":
		list := make([]string, 0, len(tools))
		for k := range tools {
			list = append(list, k)
		}
		sort.Strings(list)
		return objResRaw(env.ID, map[string]any{"tools": list})
	case "tools/call":
		var call rawToolCall
		if len(env.Params) > 0 {
			if err := json.Unmarshal(env.Params, &call); err != nil {
				return objErrRaw(env.ID, -32602, "invalid params")
			}
		}
		if call.Name == "" {
			return objErrRaw(env.ID, -32602, "invalid params")
		}
		fn, ok := tools[call.Name]
		if !ok {
			return objErrRaw(env.ID, -32601, "method not found")
		}
		// Per-tool role enforcement (F-AUTH-2). If a required-role
		// policy is registered for this tool, the caller's context (set
		// by ContextWithRoles in the auth path) must carry at least one
		// of the listed roles, or the tool body never runs.
		if required, ok := toolRoles[call.Name]; ok && len(required) > 0 {
			if !hasAnyRole(RolesFromContext(ctx), required) {
				AuditMCP.AuthFail("tool", "insufficient role")
				obsx.LogAudit("mcp_tool_role_denied", map[string]any{"tool": call.Name, "required": required})
				return objErrRaw(env.ID, -32000, "insufficient role")
			}
		}
		if buckets != nil {
			if bk, ok := buckets[call.Name]; ok && !bk.allow() {
				return objErrRaw(env.ID, -32000, "rate limited")
			}
		}
		AuditMCP.ToolCall(call.Name)
		obsx.LogAudit("mcp_tool_call", map[string]any{"tool": call.Name})
		timeoutCtx, cancel := context.WithTimeout(ctx, toolTimeout)
		defer cancel()
		ch := make(chan struct {
			out jsontext.Value
			err error
		}, 1)
		gen.SafeGo("mcp-tool-exec", func() {
			o, e := fn(timeoutCtx, call.Params)
			ch <- struct {
				out jsontext.Value
				err error
			}{o, e}
		})
		var out jsontext.Value
		var err error
		select {
		case res := <-ch:
			out = res.out
			err = res.err
		case <-timeoutCtx.Done():
			return objErrRaw(env.ID, -32000, ErrToolTimeout.Error())
		}
		if err != nil {
			return objErrRaw(env.ID, -32000, err.Error())
		}
		obsx.LogAudit("mcp_tool_result", map[string]any{"tool": call.Name})
		// Splice raw result bytes directly into the envelope so the
		// outer MarshalWrite emits them verbatim. If the tool returned
		// no bytes, encode an explicit JSON null to keep wire format.
		if len(out) == 0 {
			out = jsontext.Value("null")
		}
		return &rpcRawResultEnvelope{JSONRPC: "2.0", ID: cloneID(env.ID), Result: out}
	default:
		return objErrRaw(env.ID, -32601, "method not found")
	}
}

// isNullID reports whether the JSON-RPC id field was absent or null,
// indicating a notification. We treat a present-but-null id as a
// notification per legacy behavior (handleOne returned nil when m["id"]
// was nil).
func isNullID(v jsontext.Value) bool {
	if len(v) == 0 {
		return true
	}
	t := bytesTrimSpace(v)
	return len(t) == 4 && string(t) == "null"
}

// cloneID copies the id bytes so subsequent reuse of the request buffer
// can't mutate the response.
func cloneID(v jsontext.Value) jsontext.Value {
	if len(v) == 0 {
		return jsontext.Value("null")
	}
	out := make(jsontext.Value, len(v))
	copy(out, v)
	return out
}

func objResRaw(id jsontext.Value, result any) *rpcResultEnvelope {
	return &rpcResultEnvelope{JSONRPC: "2.0", ID: cloneID(id), Result: result}
}

func objErrRaw(id jsontext.Value, code int, msg string) *rpcErrEnvelope {
	return &rpcErrEnvelope{
		JSONRPC: "2.0",
		ID:      cloneID(id),
		Error:   rpcErrPayload{Code: code, Message: msg},
	}
}

// objErr is the parse-failure error envelope used when the request
// body cannot be decoded enough to recover an id field. It always uses
// id=null per JSON-RPC 2.0.
func objErr(id any, code int, msg string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
}

// Helpers for HTTP rate headers
func setRateHeaders(w http.ResponseWriter, limit, remaining int, reset time.Time) {
	w.Header().Set("X-RateLimit-Limit", itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", fmtUnix(reset))
}

func itoa(v int) string          { return strconv.Itoa(v) }
func fmtUnix(t time.Time) string { return strconv.FormatInt(t.Unix(), 10) }

// hasAnyRole reports whether have contains at least one element of want.
// Both slices are expected to be small (a handful of role names), so the
// O(n*m) scan is fine and avoids allocating a set.
func hasAnyRole(have, want []string) bool {
	for _, w := range want {
		for _, h := range have {
			if h == w {
				return true
			}
		}
	}
	return false
}
