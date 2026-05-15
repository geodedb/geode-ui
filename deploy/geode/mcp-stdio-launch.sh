#!/bin/sh
# Per-connection MCP stdio launcher invoked by socat. Kept tiny because
# socat's EXEC: option splits its argument on whitespace by default,
# making complex inline shell strings brittle. Reads endpoint and token
# from env, exec's geode so socat sees a single child process to wait on.
#
# Required env (set by mcp-bridge.sh, exported into socat's child env):
#   MCP_GEODE_ENDPOINT   geode host:port
#   MCP_BEARER_TOKEN     bearer token clients must present
exec geode mcp --stdio -e "${MCP_GEODE_ENDPOINT}" --token "${MCP_BEARER_TOKEN}"
