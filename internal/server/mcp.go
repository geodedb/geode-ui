package server

import (
	"context"
	"net/http"
	"runtime"
	"strconv"
	"sync"

	genmcp "geodedb.com/geode-ui/gen/mcp"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// MCPServer adapts *GraphServer to the generated genmcp.MCPServerInterface
// contract. The single tool wired today (`query`) delegates to
// handleQuery — the same private method backing POST /api/v1/query, so
// an MCP client and an HTTP client see identical semantics, statement
// validation, and timeout handling.
//
// F-AUTH-1 (#132): the generated MCPServerInterface.Query signature
// carries neither a *http.Request nor a context.Context, so the verified
// JWT claims that mcpx's auth verifier produces never reach this method.
// The full fix threads context.Context through MCPServerInterface.Query
// in genapi (tracked upstream, genapi issue pending). Until then we
// mitigate in-repo: the MCP HTTP path runs through MCPAuthVerifier
// (wired in cmd/server/main.go in place of bare srv.AuthJWT), which —
// after AuthJWT validates the token — stashes the per-request context
// (carrying profileCtxKey / userCtxKey / rolesCtxKey) keyed by the
// goroutine that handles the JSON-RPC request. mcpx.HandleHTTP runs the
// verifier and then dispatches the tool synchronously on that same
// goroutine, so Query() can pull the context back out. This keeps MCP
// query execution scoped to the caller's JWT `profile` claim instead of
// silently falling back to the "default" profile.
type MCPServer struct {
	genmcp.UnimplementedMCPServer
	server *GraphServer
}

// NewMCPServer wraps srv so it can be passed to genmcp.Register.
func NewMCPServer(srv *GraphServer) *MCPServer {
	return &MCPServer{server: srv}
}

// mcpRequestCtx maps a goroutine id to the *http.Request-derived context
// for an in-flight MCP HTTP request. Populated by MCPAuthVerifier on a
// successful auth, cleared by WrapMCPHTTP's deferred cleanup once the
// request completes. The window in which an entry is live is exactly the
// span of a single synchronous mcpx.HandleHTTP call on one goroutine, so
// concurrent MCP requests never collide (distinct goroutine ids) and a
// stale entry — if cleanup ever races a panic — is overwritten by the
// next request's verifier before that goroutine's Query runs.
//
//nolint:gochecknoglobals // process-wide per-request bridge; see type doc
var mcpRequestCtx sync.Map // uint64 goroutine id -> context.Context

// MCPAuthVerifier wraps GraphServer.AuthJWT for the MCP HTTP transport.
// It first runs the standard JWT verification (which validates the token
// and enriches r's context with the subject/profile/roles claims), then
// — on success — records that context against the current goroutine so
// MCPServer.Query can recover the caller's profile. A verification
// failure is returned unchanged and nothing is stashed.
func (s *GraphServer) MCPAuthVerifier(r *http.Request) error {
	if err := s.AuthJWT(r); err != nil {
		return err
	}
	mcpRequestCtx.Store(goID(), r.Context())
	return nil
}

// WrapMCPHTTP returns an http.Handler that runs next (the genmcp MCP
// JSON-RPC handler) and then clears this goroutine's entry from
// mcpRequestCtx. Wire it around genmcp.HandleMCPHTTP so the per-request
// context bridge does not leak past the request.
func (s *GraphServer) WrapMCPHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer mcpRequestCtx.Delete(goID())
		next.ServeHTTP(w, r)
	})
}

// mcpQueryContext returns the context to run an MCP `query` tool call
// under: the JWT-enriched context stashed by MCPAuthVerifier for this
// goroutine when present, else context.Background(). The latter is the
// pre-mitigation behaviour (and the only option for transports that
// don't run through MCPAuthVerifier, e.g. stdio), which downstream maps
// to the "default" profile via profileFromContextOrDefault.
func mcpQueryContext() context.Context {
	if v, ok := mcpRequestCtx.Load(goID()); ok {
		if ctx, ok := v.(context.Context); ok && ctx != nil {
			return ctx
		}
	}
	return context.Background()
}

// Query is the MCP `query` tool entry point. It accepts the same
// QueryReq the HTTP surface accepts and delegates to handleQuery, which
// applies the per-call timeout from req.TimeoutMs internally. The
// context comes from mcpQueryContext so the query (and its audit event)
// run against the caller's JWT `profile` claim — see the MCPServer doc
// comment and F-AUTH-1 (#132).
func (m *MCPServer) Query(params *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	return m.server.handleQuery(mcpQueryContext(), params)
}

// goID returns the calling goroutine's id by parsing the runtime stack
// header ("goroutine <id> [...]"). This is a pragmatic bridge for the
// F-AUTH-1 mitigation only — it is confined to this file and goes away
// once genapi threads context.Context through the MCP tool contract.
func goID() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	// Layout: "goroutine 123 [running]:\n..."
	s := buf[:n]
	const prefix = "goroutine "
	if len(s) < len(prefix) {
		return 0
	}
	s = s[len(prefix):]
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	id, err := strconv.ParseUint(string(s[:i]), 10, 64)
	if err != nil {
		return 0
	}
	return id
}
