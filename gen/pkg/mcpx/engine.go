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
var ErrInvalidRequest = errors.New("invalid request")

// ErrToolTimeout indicates a tool exceeded its allotted time.
var ErrToolTimeout = errors.New("tool timeout")

// Tool is a function that takes params as raw JSON and returns result JSON.
type Tool func(params jsontext.Value) (jsontext.Value, error)

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
var authVerifier func(*http.Request) error
var wsOriginAllowlist []string

// SetToolBuckets configures per-tool rate limiting buckets.
func SetToolBuckets(tools map[string]Tool, rate, burst float64) {
	toolBuckets = BuildToolBuckets(tools, rate, burst)
}

// SetToolTimeout sets the per-tool timeout for execution.
func SetToolTimeout(d time.Duration) { toolTimeout = d }

// SetAuthVerifier configures MCP request authentication verification.
// When unset, HandleHTTP/ServeWS fail closed.
func SetAuthVerifier(v func(*http.Request) error) { authVerifier = v }

// SetWSOriginAllowlist configures allowed Origin values for MCP WebSocket
// upgrades. Empty list disables origin checks.
func SetWSOriginAllowlist(origins []string) {
	if len(origins) == 0 {
		wsOriginAllowlist = nil
		return
	}
	cpy := make([]string, len(origins))
	copy(cpy, origins)
	wsOriginAllowlist = cpy
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
	if err := authVerifier(r); err != nil {
		AuditMCP.AuthFail("http", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "http", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	AuditMCP.AuthOK("http", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "http", "id": id})
	w.Header().Set("Content-Type", "application/json")
	var v any
	if err := json.UnmarshalRead(r.Body, &v); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
		return
	}
	switch vv := v.(type) {
	case map[string]any:
		// If tools/call, emit basic rate headers before processing
		if name := extractToolName(vv); name != "" {
			if bk, ok := toolBuckets[name]; ok {
				lim, rem, reset := bk.snapshot()
				setRateHeaders(w, lim, rem, reset)
			}
		}
		res := handleOne(vv, tools, toolBuckets)
		_ = json.MarshalWrite(w, res)
	case []any:
		out := make([]any, 0, len(vv))
		for _, it := range vv {
			m, _ := it.(map[string]any)
			res := handleOne(m, tools, toolBuckets)
			if res != nil {
				out = append(out, res)
			}
		}
		_ = json.MarshalWrite(w, out)
	default:
		w.WriteHeader(http.StatusBadRequest)
		_ = json.MarshalWrite(w, objErr(nil, -32600, "invalid request"))
	}
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
	if err := authVerifier(r); err != nil {
		AuditMCP.AuthFail("ws", "missing auth")
		obsx.LogAudit("mcp_auth_fail", map[string]any{"transport": "ws", "id": id, "reason": "missing auth"})
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	AuditMCP.AuthOK("ws", "")
	obsx.LogAudit("mcp_auth_ok", map[string]any{"transport": "ws", "id": id})
	conn, err := wsx.Upgrade(w, r, wsx.Options{
		OriginAllowlist: wsOriginAllowlist,
		MaxFrame:        1 << 20,
		MaxMessage:      1 << 20,
	})
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
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
		var m map[string]any
		if e := json.Unmarshal(msg, &m); e != nil {
			_ = conn.WriteMessage(0x1, []byte(`{"jsonrpc":"2.0","error":{"code":-32600,"message":"invalid request"}}`))
			continue
		}
		res := handleOne(m, tools, toolBuckets)
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
func serveSTDIOWith(in io.Reader, out io.Writer, tools map[string]Tool) error {
	br := bufio.NewReader(in)
	for {
		line, err := br.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		var v any
		if e := json.Unmarshal(bytesTrimSpace(line), &v); e != nil {
			_ = json.MarshalWrite(out, objErr(nil, -32600, "invalid request"))
			_, _ = out.Write([]byte("\n"))
			continue
		}
		switch m := v.(type) {
		case map[string]any:
			res := handleOne(m, tools, toolBuckets)
			if res == nil { // notification
				_, _ = out.Write([]byte("null\n"))
				continue
			}
			_ = json.MarshalWrite(out, res)
			_, _ = out.Write([]byte("\n"))
		case []any:
			outArr := make([]any, 0, len(m))
			for _, it := range m {
				mm, _ := it.(map[string]any)
				res := handleOne(mm, tools, toolBuckets)
				if res != nil {
					outArr = append(outArr, res)
				}
			}
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

func handleOne(m map[string]any, tools map[string]Tool, buckets map[string]*bucket) any {
	ver, _ := m["jsonrpc"].(string)
	if ver != "2.0" {
		return objErr(m["id"], -32600, "invalid request")
	}
	method, _ := m["method"].(string)
	id := m["id"]
	// notifications: no response
	if id == nil {
		return nil
	}
	switch method {
	case "initialize":
		return objRes(id, map[string]any{"capabilities": map[string]any{}})
	case "ping":
		return objRes(id, map[string]any{"ok": true})
	case "shutdown":
		return objRes(id, map[string]any{"ok": true})
	case "tools/list":
		list := make([]string, 0, len(tools))
		for k := range tools {
			list = append(list, k)
		}
		sort.Strings(list)
		return objRes(id, map[string]any{"tools": list})
	case "tools/call":
		var pr struct {
			Name   string         `json:"name"`
			Params jsontext.Value `json:"params"`
		}
		b, _ := json.Marshal(m["params"])
		_ = json.Unmarshal(b, &pr)
		if pr.Name == "" {
			return objErr(id, -32602, "invalid params")
		}
		fn, ok := tools[pr.Name]
		if !ok {
			return objErr(id, -32601, "method not found")
		}
		if buckets != nil {
			if bk, ok := buckets[pr.Name]; ok && !bk.allow() {
				return objErr(id, -32000, "rate limited")
			}
		}
		AuditMCP.ToolCall(pr.Name)
		obsx.LogAudit("mcp_tool_call", map[string]any{"tool": pr.Name})
		// enforce per-tool timeout
		ctx, cancel := context.WithTimeout(context.Background(), toolTimeout)
		defer cancel()
		ch := make(chan struct {
			out jsontext.Value
			err error
		}, 1)
		gen.SafeGo("mcp-tool-exec", func() {
			o, e := fn(pr.Params)
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
		case <-ctx.Done():
			return objErr(id, -32000, ErrToolTimeout.Error())
		}
		if err != nil {
			return objErr(id, -32000, err.Error())
		}
		var v any
		_ = json.Unmarshal(out, &v)
		obsx.LogAudit("mcp_tool_result", map[string]any{"tool": pr.Name})
		return objRes(id, v)
	default:
		return objErr(id, -32601, "method not found")
	}
}

func objRes(id any, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}
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

// extract tool name if request is tools/call
func extractToolName(m map[string]any) string {
	if m == nil {
		return ""
	}
	method, _ := m["method"].(string)
	if method != "tools/call" {
		return ""
	}
	p := m["params"]
	pm, _ := p.(map[string]any)
	if pm == nil {
		return ""
	}
	name, _ := pm["name"].(string)
	return name
}
