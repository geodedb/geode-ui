#!/usr/bin/env bash
# Exposes `geode lsp` (stdin/stdout JSON-RPC) over TCP :2087 by forking
# one `geode lsp` process per inbound connection. Conventional pattern
# for stdio-only LSP servers.
#
# socat options:
#   TCP-LISTEN:2087  bind on every interface inside the container
#   reuseaddr        allow restart without TIME_WAIT delay
#   fork             one child per connection
#   EXEC:"geode lsp" pipes stdin/stdout to the spawned process
#   stderr           bubble child stderr into our log so editor errors
#                    appear in `docker logs geode-lsp`
set -euo pipefail
exec socat -d -d \
    TCP-LISTEN:2087,reuseaddr,fork \
    EXEC:"geode lsp",pty,stderr
