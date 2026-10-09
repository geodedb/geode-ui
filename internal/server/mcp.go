package server

import (
	"context"
	"net/http"

	genmcp "geodedb.com/geode-ui/gen/mcp"
	"geodedb.com/geode-ui/gen/pkg/mcpx"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// MCPServer adapts *GraphServer to the generated genmcp.MCPServerInterface
// contract. The single tool wired today (`query`) delegates to
// handleQuery — the same private method backing POST /api/v1/query, so
// an MCP client and an HTTP client see identical semantics, statement
// validation, and timeout handling.
//
// F-AUTH-1 (#132): genapi now threads context.Context through
// MCPServerInterface.Query, and mcpx's auth verifier returns the
// request-scoped context. mcpAuthVerifier runs GraphServer.AuthJWT —
// which mutates *r in place so r.Context() afterwards carries
// userCtxKey / profileCtxKey / rolesCtxKey / cidCtxKey /
// authSourceCtxKey — and hands that context to mcpx, which threads it
// straight into Query below. The query (and its audit event) therefore
// run against the caller's JWT `profile` claim natively; the old
// per-goroutine sync.Map stash mitigation is gone.
type MCPServer struct {
	genmcp.UnimplementedMCPServer

	server *GraphServer
}

// NewMCPServer wraps srv so it can be passed to genmcp.Register.
func NewMCPServer(srv *GraphServer) *MCPServer {
	return &MCPServer{server: srv}
}

// MCPAuthVerifier is the mcpx.SetAuthVerifier callback for the MCP HTTP
// (and WS) transport. It runs the standard JWT verification — which both
// validates the token and enriches *r's context with the
// subject/profile/roles/connection-id claims — then returns that
// enriched context for mcpx to thread into the tool body. The JWT roles
// claim is also re-published under the mcpx-owned context key so the
// dispatcher's per-tool role gate (F-AUTH-2 / #135) can read it without
// re-parsing the bearer token. A verification failure is returned as
// (nil, err) and nothing is dispatched.
func (s *GraphServer) MCPAuthVerifier(r *http.Request) (context.Context, error) {
	if err := s.AuthJWT(r); err != nil {
		return nil, err
	}
	ctx := r.Context()
	return mcpx.ContextWithRoles(ctx, rolesFromContext(ctx)), nil
}

// Query is the MCP `query` tool entry point. It accepts the same
// QueryReq the HTTP surface accepts and delegates to handleQuery, which
// applies the per-call timeout from req.TimeoutMs internally. The ctx is
// the JWT-enriched, request-scoped context threaded from mcpx, so the
// query and its audit event are scoped to the caller's `profile` claim —
// see the MCPServer doc comment and F-AUTH-1 (#132).
func (m *MCPServer) Query(ctx context.Context, params *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	return m.server.handleQuery(ctx, params)
}
