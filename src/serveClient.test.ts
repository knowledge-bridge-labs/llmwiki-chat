import { afterEach, describe, expect, it, vi } from 'vitest'
import appSource from './App.tsx?raw'
import agentRuntimesSource from './agentRuntimes.ts?raw'
import {
  A2aKnowledgeClient,
  LlmWikiServeClient,
  McpKnowledgeClient,
  clientFor,
  diagnosticFromError,
  normalizeGraphPayload,
  normalizeQueryResult,
} from './serveClient'
import type { Connection } from './domain'
import { a2aKnowledgeSourceMessageUrlPolicyMessage } from './urlPolicy'

const baseConnection: Connection = {
  id: 'wiki',
  name: 'Configured Wiki',
  protocol: 'llmwiki-http',
  url: 'http://127.0.0.1:8765',
  selected: true,
  status: 'unknown',
}

function contextPayload() {
  return {
    wiki_title: 'Serve Wiki',
    description: 'Projected Markdown wiki',
    adapter: 'obsidian',
    implementation: 'Obsidian vault',
    page_count: 8,
    approved_page_count: 7,
    orientation: [{ title: 'Index', role: 'index', snippet: 'See [[Release|release plan]].' }],
    evidence: [
      {
        page_id: 'release',
        title: 'Release',
        path: 'release.md',
        snippet: 'Use **approved** release notes.',
        source_refs: ['SRC-1'],
      },
    ],
    limitations: ['1 draft or unapproved page(s) were withheld.'],
    graph: graphPayload(),
  }
}

function graphPayload() {
  return {
    nodes: [{ id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md' }],
    edges: [{ source: 'page:index', target: 'page:release', relation: 'links_to' }],
  }
}

function pagePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'release',
    title: 'Release',
    path: 'release.md',
    role: 'topic',
    text: '# Release\n\nUse approved release notes.',
    source_refs: ['SRC-1'],
    ...overrides,
  }
}

describe('LlmWikiServeClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('discovers manifest metadata and graph nodes from HTTP serve endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/manifest')) {
        return Response.json({
          title: 'Serve Wiki',
          description: 'Projected Markdown wiki',
          adapter: 'obsidian',
          implementation: 'Obsidian vault',
          page_count: 8,
          approved_page_count: 7,
          capabilities: ['llmwiki_context', 'llmwiki_graph'],
        })
      }
      if (url.includes('/graph')) {
        return Response.json(graphPayload())
      }
      return new Response('not found', { status: 404 })
    }))

    const discovered = await new LlmWikiServeClient().discover(baseConnection)

    expect(discovered).toMatchObject({
      name: 'Serve Wiki',
      description: 'Projected Markdown wiki',
      adapter: 'obsidian',
      implementation: 'Obsidian vault',
      pageCount: 8,
      approvedPageCount: 7,
      capabilities: ['llmwiki_context', 'llmwiki_graph'],
      status: 'ready',
    })
    expect(discovered.graph?.nodes).toEqual([
      { id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md', metadata: undefined },
    ])
  })

  it('normalizes query evidence without replacing failed real calls with sample data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))

    await expect(new LlmWikiServeClient().query(baseConnection, 'release')).rejects.toThrow('query returned HTTP 502')
  })

  it('attaches diagnostic metadata from HTTP problem details without changing the thrown message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      type: 'https://llmwiki.test/problems/bridge',
      title: 'Bridge request failed',
      detail: 'The bridge could not reach the selected source.',
      traceId: 'trace-http-502',
      diagnostics: [
        {
          schemaVersion: 'llmwiki.agent-bridge.diagnostic.v1',
          severity: 'error',
          scope: 'runtime',
          phase: 'chat-completions',
          protocol: 'openai-compatible',
          subject: 'agent-bridge',
          retryable: true,
          redacted: true,
          observations: [
            { name: 'httpStatus', value: '502' },
            { name: 'timeoutMs', value: '120000' },
          ],
          remediation: 'Check runtime settings, then retry.',
          message: 'Runtime request failed.',
        },
      ],
      error: {
        diagnostic: {
          observations: ['The selected source refused the bridge connection.'],
          remediation: ['Test the source URL from the bridge host.'],
        },
        traceId: 'trace-http-502',
        steps: [
          {
            id: 'reach-source',
            label: 'Reach selected source',
            status: 'failed',
            error: 'ECONNREFUSED',
          },
        ],
        partial: { answer: 'Partial bridge answer.' },
      },
    }, { status: 502 })))

    let thrown: unknown
    try {
      await new LlmWikiServeClient().query(baseConnection, 'release')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('query returned HTTP 502')
    expect(diagnosticFromError(thrown)).toMatchObject({
      title: 'Bridge request failed',
      detail: 'The bridge could not reach the selected source.',
      traceId: 'trace-http-502',
      severity: 'error',
      scope: 'runtime',
      phase: 'chat-completions',
      protocol: 'openai-compatible',
      subject: 'agent-bridge',
      retryable: 'yes',
      observations: [
        'The selected source refused the bridge connection.',
        'httpStatus: 502',
        'timeoutMs: 120000',
      ],
      remediation: [
        'Test the source URL from the bridge host.',
        'Check runtime settings, then retry.',
      ],
      steps: [
        {
          id: 'reach-source',
          label: 'Reach selected source',
          status: 'error',
          error: 'ECONNREFUSED',
        },
      ],
      partial: { answer: 'Partial bridge answer.' },
    })
  })

  it('reads an approved page from the HTTP read endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8765/read/release')
      return Response.json(pagePayload())
    }))

    await expect(new LlmWikiServeClient().readPage(baseConnection, 'release')).resolves.toEqual({
      id: 'release',
      title: 'Release',
      path: 'release.md',
      text: '# Release\n\nUse approved release notes.',
      sourceRefs: ['SRC-1'],
    })
  })

  it('encodes HTTP read page path segments without flattening nested paths', async () => {
    const fetchMock = vi.fn(async () => Response.json(pagePayload({
      id: 'wiki/release plan',
      path: 'wiki/release plan.md',
    })))
    vi.stubGlobal('fetch', fetchMock)

    await new LlmWikiServeClient().readPage(baseConnection, 'wiki/release plan#Q1?.md')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/read/wiki/release%20plan%23Q1%3F.md',
      expect.any(Object),
    )
  })

  it('throws HTTP read not found responses as Error instances', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    await expect(new LlmWikiServeClient().readPage(baseConnection, 'missing')).rejects.toThrow('read returned HTTP 404')
  })

  it('times out stalled HTTP query requests', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    const query = new LlmWikiServeClient().query(baseConnection, 'release')
    const assertion = expect(query).rejects.toThrow('query timed out after 10s')

    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('rejects aborted HTTP query requests', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const controller = new AbortController()

    const query = new LlmWikiServeClient().query(baseConnection, 'release', controller.signal)
    const assertion = expect(query).rejects.toThrow('query request was canceled.')

    controller.abort()
    await assertion
  })
})

describe('McpKnowledgeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers, queries, and loads graph through llmwiki-serve MCP tools', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8765/mcp')
      const body = JSON.parse(String(init?.body || '{}')) as {
        method?: string
        params?: { name?: string; arguments?: Record<string, unknown> }
      }
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [{ name: 'llmwiki_context' }, { name: 'llmwiki_graph' }] },
        })
      }
      if (body.params?.name === 'llmwiki_context') {
        return Response.json({ jsonrpc: '2.0', id: 2, result: contextPayload() })
      }
      if (body.params?.name === 'llmwiki_graph') {
        return Response.json({ jsonrpc: '2.0', id: 3, result: graphPayload() })
      }
      return Response.json({ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'unknown method' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const connection: Connection = { ...baseConnection, protocol: 'mcp' }
    const discovered = await new McpKnowledgeClient().discover(connection)
    const result = await new McpKnowledgeClient().query(connection, 'release')
    const graph = await new McpKnowledgeClient().graph(connection)

    expect(discovered).toMatchObject({
      name: 'Serve Wiki',
      description: 'Projected Markdown wiki',
      capabilities: ['llmwiki_context', 'llmwiki_graph'],
      status: 'ready',
    })
    expect(result.citations[0].title).toBe('Release')
    expect(graph.nodes[0].id).toBe('page:release')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8765/mcp', expect.any(Object))
  })

  it('uses a URL that already points to /mcp without appending another segment', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8765/mcp')
      const body = JSON.parse(String(init?.body || '{}')) as { params?: { name?: string } }
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: body.params?.name === 'llmwiki_graph' ? graphPayload() : contextPayload(),
      })
    }))

    const connection: Connection = { ...baseConnection, protocol: 'mcp', url: 'http://127.0.0.1:8765/mcp' }

    await expect(new McpKnowledgeClient().query(connection, 'release')).resolves.toMatchObject({
      wikiTitle: 'Serve Wiki',
    })
  })

  it('throws JSON-RPC error objects as Error instances', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'tool failed' },
    })))

    const connection: Connection = { ...baseConnection, protocol: 'mcp' }

    await expect(new McpKnowledgeClient().query(connection, 'release')).rejects.toThrow(
      'mcp llmwiki_context returned JSON-RPC error: -32000 tool failed',
    )
  })

  it('reads a page through the llmwiki_read MCP tool', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        method?: string
        params?: { name?: string; arguments?: Record<string, unknown> }
      }
      expect(body).toMatchObject({
        method: 'tools/call',
        params: { name: 'llmwiki_read', arguments: { page_id: 'release' } },
      })
      return Response.json({ jsonrpc: '2.0', id: 1, result: pagePayload() })
    })
    vi.stubGlobal('fetch', fetchMock)

    const connection: Connection = { ...baseConnection, protocol: 'mcp' }

    await expect(new McpKnowledgeClient().readPage(connection, 'release')).resolves.toMatchObject({
      id: 'release',
      title: 'Release',
      sourceRefs: ['SRC-1'],
    })
  })

  it('throws MCP read not found payloads as Error instances', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: { found: false, reason: 'not approved for serving' },
    })))

    const connection: Connection = { ...baseConnection, protocol: 'mcp' }

    await expect(new McpKnowledgeClient().readPage(connection, 'draft-note')).rejects.toThrow(
      'mcp llmwiki_read did not find page "draft-note": not approved for serving',
    )
  })
})

describe('A2aKnowledgeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers, queries, and loads graph from A2A agent-card and message artifacts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({
          name: 'Serve A2A Wiki',
          description: 'A2A llmwiki endpoint',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      expect(url).toBe('http://127.0.0.1:8765/message:send')
      expect(JSON.parse(String(init?.body || '{}'))).toHaveProperty('data.query')
      return Response.json({
        status: { state: 'completed' },
        artifacts: [
          {
            name: 'llmwiki_context',
            parts: [{ kind: 'data', data: contextPayload() }],
          },
        ],
      })
    }))

    const connection: Connection = { ...baseConnection, protocol: 'a2a' }
    const discovered = await new A2aKnowledgeClient().discover(connection)
    const result = await new A2aKnowledgeClient().query(connection, 'release')
    const graph = await new A2aKnowledgeClient().graph(connection)

    expect(discovered).toMatchObject({
      name: 'Serve A2A Wiki',
      description: 'A2A llmwiki endpoint',
      capabilities: ['a2a-message'],
      status: 'ready',
    })
    expect(result.wikiTitle).toBe('Serve Wiki')
    expect(result.citations[0].sourceRefs).toEqual(['SRC-1'])
    expect(graph.nodes[0].id).toBe('page:release')
  })

  it('uses a URL that already points to the agent card', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'Card URL Wiki', url: '/message:send' })
      }
      return Response.json({
        artifacts: [{ name: 'llmwiki_context', parts: [{ kind: 'data', data: contextPayload() }] }],
      })
    }))

    const connection: Connection = {
      ...baseConnection,
      protocol: 'a2a',
      url: 'http://127.0.0.1:8765/.well-known/agent-card.json',
    }

    await expect(new A2aKnowledgeClient().query(connection, 'release')).resolves.toMatchObject({
      wikiTitle: 'Serve Wiki',
    })
  })

  it('resolves bare message:send card URLs relative to the A2A service base', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'Nested A2A Wiki', url: 'message:send' })
      }
      expect(url).toBe('http://127.0.0.1:8765/agents/wiki/message:send')
      return Response.json({
        artifacts: [{ name: 'llmwiki_context', parts: [{ kind: 'data', data: contextPayload() }] }],
      })
    }))

    const connection: Connection = {
      ...baseConnection,
      protocol: 'a2a',
      url: 'http://127.0.0.1:8765/agents/wiki',
    }

    await expect(new A2aKnowledgeClient().query(connection, 'release')).resolves.toMatchObject({
      wikiTitle: 'Serve Wiki',
    })
  })

  it('allows absolute loopback card message URLs for local A2A development', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'Local A2A Wiki', url: 'http://localhost:8765/message:send' })
      }
      expect(url).toBe('http://localhost:8765/message:send')
      return Response.json({
        artifacts: [{ name: 'llmwiki_context', parts: [{ kind: 'data', data: contextPayload() }] }],
      })
    }))

    const connection: Connection = {
      ...baseConnection,
      protocol: 'a2a',
      url: 'http://127.0.0.1:8765/agents/wiki',
    }

    await expect(new A2aKnowledgeClient().query(connection, 'release')).resolves.toMatchObject({
      wikiTitle: 'Serve Wiki',
    })
  })

  it.each([
    'http://wiki.example.com/message:send',
    'http://10.0.0.5/message:send',
    'https://wiki.internal/message:send',
    'https://[::ffff:192.168.0.2]/message:send',
  ])('rejects unsafe A2A card message URL %s without exposing it', async (cardMessageUrl) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'A2A Wiki', url: cardMessageUrl })
      }
      return Response.json({
        artifacts: [{ name: 'llmwiki_context', parts: [{ kind: 'data', data: contextPayload() }] }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const connection: Connection = {
      ...baseConnection,
      protocol: 'a2a',
      url: 'https://wiki.example.com/agents/wiki',
    }

    let thrown: unknown
    try {
      await new A2aKnowledgeClient().query(connection, 'release')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      `A2A Knowledge Source agent card message URL is not allowed. ${a2aKnowledgeSourceMessageUrlPolicyMessage}`,
    )
    expect((thrown as Error).message).not.toContain(cardMessageUrl)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps Agent Runtime private URL override out of A2A Knowledge Source message URL validation', async () => {
    const env = import.meta.env as Record<string, string | boolean | undefined>
    const previous = env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
    try {
      env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = 'true'
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/.well-known/agent-card.json')) {
          return Response.json({ name: 'A2A Wiki', url: 'http://100.64.0.1/message:send' })
        }
        return Response.json({
          artifacts: [{ name: 'llmwiki_context', parts: [{ kind: 'data', data: contextPayload() }] }],
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const connection: Connection = {
        ...baseConnection,
        protocol: 'a2a',
        url: 'https://wiki.example.com/agents/wiki',
      }

      await expect(new A2aKnowledgeClient().query(connection, 'release')).rejects.toThrow(
        `A2A Knowledge Source agent card message URL is not allowed. ${a2aKnowledgeSourceMessageUrlPolicyMessage}`,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) {
        delete env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
      } else {
        env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = previous
      }
    }
  })

  it('returns no citations with a limitation when A2A omits the llmwiki_context artifact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) return Response.json({ name: 'A2A Wiki', url: '/message:send' })
      return Response.json({
        status: { state: 'completed' },
        message: { parts: [{ kind: 'text', text: 'I can answer, but no context artifact was attached.' }] },
        artifacts: [],
      })
    }))

    const connection: Connection = { ...baseConnection, protocol: 'a2a' }
    const result = await new A2aKnowledgeClient().query(connection, 'release')

    expect(result.citations).toEqual([])
    expect(result.orientation[0].snippet).toBe('I can answer, but no context artifact was attached.')
    expect(result.limitations[0]).toContain('did not include a llmwiki_context data artifact')
  })

  it('does not discover a non-LLMWiki A2A endpoint as ready without a context artifact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'Generic A2A Agent', url: '/message:send' })
      }
      return Response.json({
        status: { state: 'completed' },
        message: { parts: [{ kind: 'text', text: 'Generic A2A response.' }] },
        artifacts: [],
      })
    }))

    const connection: Connection = { ...baseConnection, protocol: 'a2a' }

    await expect(new A2aKnowledgeClient().discover(connection)).rejects.toThrow(
      'A2A discovery did not receive a llmwiki_context data artifact',
    )
  })

  it('throws failed A2A task status as an Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) return Response.json({ name: 'A2A Wiki', url: '/message:send' })
      return Response.json({
        status: {
          state: 'failed',
          message: { parts: [{ kind: 'text', text: 'runtime unavailable' }] },
        },
      })
    }))

    const connection: Connection = { ...baseConnection, protocol: 'a2a' }

    await expect(new A2aKnowledgeClient().query(connection, 'release')).rejects.toThrow(
      'a2a message failed: runtime unavailable',
    )
  })

  it('throws a clear unsupported error for A2A page reads', async () => {
    const connection: Connection = { ...baseConnection, protocol: 'a2a' }

    await expect(new A2aKnowledgeClient().readPage(connection, 'release')).rejects.toThrow(
      'A2A page read is not implemented in llmwiki-chat; choose llmwiki-http or mcp for Configured Wiki.',
    )
  })
})

describe('clientFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not replace failed HTTP calls with bundled sample data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const connection: Connection = { ...baseConnection, adapter: 'sample' }

    await expect(clientFor(connection).query(connection, 'release')).rejects.toThrow('query returned HTTP 404')
  })

  it('returns protocol-specific clients for HTTP, MCP, and A2A', () => {
    expect(clientFor(baseConnection)).toBeInstanceOf(LlmWikiServeClient)
    expect(clientFor({ ...baseConnection, protocol: 'mcp' })).toBeInstanceOf(McpKnowledgeClient)
    expect(clientFor({ ...baseConnection, protocol: 'a2a' })).toBeInstanceOf(A2aKnowledgeClient)
  })
})

describe('knowledge endpoint normalization', () => {
  it('normalizes serve query payloads into UI citations and graph data', () => {
    const result = normalizeQueryResult(baseConnection, contextPayload())

    expect(result.wikiTitle).toBe('Serve Wiki')
    expect(result.orientation[0]).toEqual({ title: 'Index', role: 'index', snippet: 'See release plan.' })
    expect(result.citations[0]).toMatchObject({
      id: 'wiki:release',
      title: 'Release',
      path: 'release.md',
      snippet: 'Use **approved** release notes.',
      sourceRefs: ['SRC-1'],
    })
    expect(result.limitations).toEqual(['1 draft or unapproved page(s) were withheld.'])
    expect(result.graph?.nodes[0].id).toBe('page:release')
  })

  it('normalizes graph payloads defensively', () => {
    expect(normalizeGraphPayload({
      nodes: [{ id: 'page:hot', title: 'Hot Page', role: 'hot', metadata: { status: 'approved' } }],
      edges: [{ source: 'page:hot', target: 'source:SRC-1', kind: 'cites' }, { source: '', target: 'x' }],
    })).toEqual({
      nodes: [
        {
          id: 'page:hot',
          label: 'Hot Page',
          kind: 'hot',
          path: '',
          metadata: { status: 'approved' },
        },
      ],
      edges: [
        {
          source: 'page:hot',
          target: 'source:SRC-1',
          relation: 'cites',
          metadata: undefined,
        },
      ],
    })
  })

  it('keeps active code imports on serveClient instead of stale adapters', () => {
    expect(appSource).toContain("from './serveClient'")
    expect(agentRuntimesSource).toContain("from './serveClient'")
    const staleAdapterImport = "from './" + "adapters'"
    expect(`${appSource}\n${agentRuntimesSource}`).not.toContain(staleAdapterImport)
  })
})
