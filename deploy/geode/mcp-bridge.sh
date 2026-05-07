#!/usr/bin/env bash
# Exposes `geode mcp --stdio` (JSON-RPC over stdin/stdout) over TCP :8090
# by forking one MCP process per inbound connection.
#
# Why a stdio bridge instead of `geode mcp serve --port 8090`?
# -----------------------------------------------------------
# Geode v0.5.11's HTTP transport for MCP has two issues that make it
# unusable in this compose stack:
#   1. The HTTP server thread is spawned but the CLI's main returns
#      immediately after `serveHttp()`, so the geode process exits and
#      the listener thread dies with it (no `wait`/`join` on the
#      accept loop). The container exits 0 within milliseconds.
#   2. Even if the process stayed alive, the listener binds to
#      127.0.0.1 — there is no `--bind` flag — so port-mapping from
#      the host can't reach it.
#
# `geode mcp --stdio` works correctly: it reads JSON-RPC frames from
# stdin and writes responses to stdout in a blocking loop, identical
# to LSP. socat fork + EXEC turns each TCP connection into a fresh
# stdio MCP child, mirroring the lsp-bridge.sh pattern.
#
# socat's EXEC: option tokenizes its value on whitespace before
# execvp'ing the child, which makes complex inline shell strings
# brittle (the LSP bridge gets away with `EXEC:"geode lsp"` only
# because no extra args follow). We therefore exec a tiny launcher
# script that pulls the endpoint and bearer token from env vars and
# replaces itself with `geode mcp --stdio …` — keeping socat's view
# of the EXEC value to a single absolute path with no embedded
# whitespace.
#
# Required env (passed by compose):
#   MCP_GEODE_ENDPOINT   geode host:port (default: geode:3141)
#   MCP_BEARER_TOKEN     bearer token clients must present
#                        (default: e2e-mcp-token)
set -euo pipefail

# Export so the per-connection child sees them (socat propagates the
# parent's full env to EXEC children).
export MCP_GEODE_ENDPOINT="${MCP_GEODE_ENDPOINT:-geode:3141}"
export MCP_BEARER_TOKEN="${MCP_BEARER_TOKEN:-e2e-mcp-token}"

exec socat -d -d \
    TCP-LISTEN:8090,reuseaddr,fork \
    EXEC:/mcp/mcp-stdio-launch.sh,pty,stderr
