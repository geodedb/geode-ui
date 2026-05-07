package server

import (
	"context"

	genmcp "geodedb.com/geode-ui/gen/mcp"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// MCPServer adapts *GraphServer to the generated genmcp.MCPServerInterface
// contract. The single tool wired today (`query`) delegates straight to
// handleQuery — the same private method backing POST /api/v1/query, so
// an MCP client and an HTTP client see identical semantics, statement
// validation, and timeout handling.
//
// Mirrors ~/src/devnw/go/oidc/mcp.go: thin pass-through, no extra
// validation or shaping at the MCP boundary. genapi-generated NewTools
// has already validated the request payload via QueryReq.Valid() before
// calling Query, so this method only needs to forward.
type MCPServer struct {
	genmcp.UnimplementedMCPServer
	server *GraphServer
}

// NewMCPServer wraps srv so it can be passed to genmcp.Register.
func NewMCPServer(srv *GraphServer) *MCPServer {
	return &MCPServer{server: srv}
}

// Query is the MCP `query` tool entry point. It accepts the same
// QueryReq the HTTP surface accepts and delegates to handleQuery; the
// generated MCP layer marshals the result back to the caller.
//
// We use context.Background here because MCP tool calls do not carry
// a per-request *http.Request — handleQuery applies the per-call
// timeout from req.TimeoutMs internally so we are not losing
// cancellation propagation by detaching from the JSON-RPC frame.
func (m *MCPServer) Query(params *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	return m.server.handleQuery(context.Background(), params)
}
