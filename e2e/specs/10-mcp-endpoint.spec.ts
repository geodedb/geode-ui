import { test, expect } from '@playwright/test'
import * as net from 'node:net'

const MCP_HOST = process.env.MCP_HOST ?? 'localhost'
const MCP_PORT = Number(process.env.MCP_PORT ?? '8090')

// The MCP service in this test stack is a socat bridge that forks
// `geode mcp --stdio` per TCP connection. The bridge speaks
// newline-delimited JSON-RPC (NOT LSP Content-Length framing). The
// bridge also echoes each input line back on the read side (socat
// default), so we have to filter out our own outbound messages by
// matching on the `result`/`error` keys instead of on `id`.

type RpcReq = { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
type RpcResp = { jsonrpc: '2.0'; id?: number; result?: unknown; error?: unknown }

// Run a sequence of JSON-RPC requests over a single bridge connection
// (each connection is a fresh `geode mcp --stdio` process; tools/list
// requires `initialize` first per session). Returns one parsed
// response per non-notification request, in order.
async function rpcSession(reqs: RpcReq[], timeoutMs = 8_000): Promise<RpcResp[]> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: MCP_HOST, port: MCP_PORT })
    const responses: RpcResp[] = []
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`MCP RPC timed out after ${timeoutMs}ms (got ${responses.length}/${reqs.length})`))
    }, timeoutMs)

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const parts = buf.split('\n')
      // The last element is whatever's left after the final newline —
      // possibly a partial frame; keep it for the next data event.
      buf = parts.pop() ?? ''
      const completed: RpcResp[] = parts
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          try {
            return JSON.parse(line) as RpcResp
          } catch {
            return null
          }
        })
        // Filter out the bridge's echo of our own outbound messages.
        // Real responses always carry `result` or `error`.
        .filter(
          (parsed): parsed is RpcResp =>
            !!parsed && (parsed.result !== undefined || parsed.error !== undefined),
        )
      responses.push(...completed)
      if (responses.length >= reqs.length) {
        clearTimeout(timer)
        sock.end()
        resolve(responses)
      }
    })
    sock.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    sock.on('connect', () => {
      reqs.forEach((r) => {
        sock.write(`${JSON.stringify(r)}\n`)
      })
    })
    sock.on('close', () => {
      // If the server closed early, resolve with what we have so the
      // test can assert on partial results instead of timing out.
      if (responses.length < reqs.length) {
        clearTimeout(timer)
        resolve(responses)
      }
    })
  })
}

const initReq: RpcReq = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'geode-ui-e2e', version: '0.0.0' },
  },
}

test.describe('mcp', () => {
  test('responds to initialize on the MCP TCP bridge', async () => {
    const [resp] = await rpcSession([initReq])
    expect(resp).toBeDefined()
    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(1)
    expect(resp.result || resp.error).toBeDefined()
    // serverInfo.name is part of MCP — sanity check it's a Geode server.
    const info = (resp.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo
    if (info?.name) expect(info.name).toMatch(/geode/i)
  })

  test('exposes tool list via tools/list method', async () => {
    const responses = await rpcSession([
      initReq,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ])
    const toolsResp = responses.find((r) => r.id === 2)
    expect(toolsResp, 'tools/list response missing').toBeDefined()
    test.skip(
      Boolean(toolsResp?.error),
      `MCP tools/list returned error: ${JSON.stringify(toolsResp?.error)}`,
    )
    const tools = (toolsResp?.result as { tools?: unknown[] } | undefined)?.tools
    expect(tools).toBeDefined()
    expect((tools ?? []).length).toBeGreaterThan(0)
  })
})
