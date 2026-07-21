import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BridgeMcpAgentRuntimeClient,
  ExternalA2aAgentRuntimeClient,
  agentClientFor,
  discoverBridgeKnowledgeSources,
  discoverAgentRuntime,
  starterAgentConnections,
} from './agentRuntimes'
import type { AgentConnection, Connection } from './domain'
import { agentRuntimeUrlPolicyMessage, isAllowedAgentRuntimeUrl } from './urlPolicy'

const runtime: AgentConnection = {
  id: 'custom-a2a',
  name: 'Custom A2A',
  protocol: 'custom-a2a',
  url: 'http://127.0.0.1:8770/agents/wiki',
  selected: true,
  status: 'ready',
}

const bridgeMcpRuntime: AgentConnection = {
  id: 'bridge-mcp',
  name: 'Local Agent Bridge (MCP)',
  protocol: 'bridge-mcp',
  url: 'http://127.0.0.1:8788',
  selected: true,
  status: 'ready',
}

const knowledgeSource: Connection = {
  id: 'wiki',
  name: 'Serve Wiki',
  protocol: 'llmwiki-http',
  url: 'http://serve.test',
  selected: true,
  status: 'ready',
  description: 'Serve wiki description',
  adapter: 'llmwiki-markdown',
  implementation: 'atomicstrata/llm-wiki-compiler',
  capabilities: ['llmwiki_context', 'llmwiki_graph'],
  graph: {
    nodes: [{ id: 'page:release', label: 'Release', kind: 'topic' }],
    edges: [],
  },
}

const teamKnowledgeSource: Connection = {
  ...knowledgeSource,
  id: 'team-wiki',
  name: 'Team Wiki',
  url: 'http://team.test',
  description: 'Team process wiki description',
  protocol: 'mcp',
  adapter: 'dendron',
  implementation: 'Dendron vault',
}

const unreadyKnowledgeSource: Connection = {
  ...knowledgeSource,
  id: 'draft-wiki',
  name: 'Draft Wiki',
  url: 'http://draft.test',
  selected: true,
  status: 'unknown',
}

function requestHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

describe('starterAgentConnections', () => {
  it('selects Local Development Runtime by default and keeps local bridge available', () => {
    expect(starterAgentConnections[0]).toMatchObject({
      id: 'bridge-a2a',
      name: 'Local Agent Bridge (A2A)',
      protocol: 'bridge-a2a',
      url: 'http://127.0.0.1:8788',
      selected: false,
      status: 'unknown',
    })
    expect(starterAgentConnections.find((agent) => agent.id === 'bridge-mcp')).toMatchObject({
      protocol: 'bridge-mcp',
      url: 'http://127.0.0.1:8788',
      selected: false,
      status: 'unknown',
    })
    expect(starterAgentConnections.find((agent) => agent.id === 'mock-agent')).toMatchObject({
      name: 'Local Development Runtime',
      protocol: 'mock-agent',
      selected: true,
      status: 'ready',
    })
  })
})

describe('BridgeMcpAgentRuntimeClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('discovers the bridge MCP runtime from tools/list and settings metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8788/mcp')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        method: 'tools/list',
      })
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          settingsUrl: '/settings/agents',
          tools: [
            { name: 'llmwiki_agent_run', description: 'Run an agent over selected LLMWiki sources.' },
          ],
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const discovered = await discoverAgentRuntime({ ...bridgeMcpRuntime, status: 'unknown' })

    expect(discovered).toMatchObject({
      id: 'bridge-mcp',
      protocol: 'bridge-mcp',
      url: 'http://127.0.0.1:8788',
      status: 'ready',
      capabilities: ['mcp-tools/list', 'mcp-tools/call', 'llmwiki_agent_run'],
      settingsUrl: 'http://127.0.0.1:8788/settings/agents',
      error: '',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lists bridge registered Knowledge Sources through llmwiki_list_sources', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8788/mcp')
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      requestBodies.push(body)
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          structuredContent: {
            llmwiki_sources: {
              sources: [
                {
                  id: 'project-wiki',
                  name: 'Project Wiki',
                  protocol: 'llmwiki-http',
                  url: 'http://127.0.0.1:19870',
                  status: 'ready',
                  selected: true,
                  capabilities: ['llmwiki_context'],
                },
              ],
              readySourceCount: 1,
            },
          },
        },
      })
    }))

    const sources = await discoverBridgeKnowledgeSources(bridgeMcpRuntime)

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'llmwiki_list_sources',
        arguments: {},
      },
    })
    expect(sources).toEqual([
      expect.objectContaining({
        id: 'project-wiki',
        name: 'Project Wiki',
        protocol: 'llmwiki-http',
        url: 'http://127.0.0.1:19870',
        status: 'ready',
        selected: true,
        capabilities: ['llmwiki_context'],
      }),
    ])
  })

  it('runs llmwiki_agent_run through MCP tools/call with selected ready sources', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const messages = [
      { role: 'user' as const, content: 'Earlier question?' },
      { role: 'assistant' as const, content: 'Earlier answer.' },
      { role: 'user' as const, content: 'What is ready?' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8788/mcp')
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      requestBodies.push(body)
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{ name: 'llmwiki_agent_run' }],
          },
        })
      }

      expect(body.method).toBe('tools/call')
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          structuredContent: {
            answer: 'Bridge MCP grounded answer.',
            citations: [
              {
                id: 'wiki:cite-1',
                title: 'Release',
                path: 'release.md',
                snippet: 'Release evidence.',
                connectionId: 'wiki',
                sourceRefs: ['SRC-1'],
              },
            ],
            graph: {
              nodes: [{ id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md' }],
              edges: [],
            },
            steps: [
              {
                id: 'bridge-tool-wiki',
                label: 'Call LLMWiki source',
                status: 'done',
                connection_id: 'wiki',
                tool_name: 'llmwiki_context__wiki',
                citation_ids: ['wiki:cite-1'],
              },
            ],
          },
        },
      })
    }))

    const result = await new BridgeMcpAgentRuntimeClient(bridgeMcpRuntime).run({
      agent: bridgeMcpRuntime,
      knowledgeSources: [knowledgeSource, unreadyKnowledgeSource],
      query: 'What is ready?',
      messages,
      messageId: 'message-mcp-test',
      threadId: 'thread-mcp-test',
      sessionId: 'session-mcp-test',
      turnId: 'turn-mcp-test',
    })
    const toolCall = requestBodies.find((body) => body.method === 'tools/call')
    const params = toolCall?.params as {
      name: string
      arguments: {
        query: string
        message: Record<string, unknown>
        messages: typeof messages
        threadId: string
        sessionId: string
        turnId: string
        runtimeContext: Record<string, unknown>
        knowledgeSources: Array<Record<string, unknown>>
        tools: Array<Record<string, unknown>>
      }
    }

    expect(requestBodies.map((body) => body.method)).toEqual(['tools/list', 'tools/call'])
    expect(params.name).toBe('llmwiki_agent_run')
    expect(params.arguments).toMatchObject({
      query: 'What is ready?',
      message: {
        kind: 'message',
        messageId: 'message-mcp-test',
        contextId: 'thread-mcp-test',
        role: 'user',
        parts: [{ kind: 'text', text: 'What is ready?' }],
        metadata: {
          llmwiki: {
            schemaVersion: 'llmwiki-chat.conversation.v1',
            threadId: 'thread-mcp-test',
            sessionId: 'session-mcp-test',
            turnId: 'turn-mcp-test',
          },
        },
      },
      messages,
      threadId: 'thread-mcp-test',
      sessionId: 'session-mcp-test',
      turnId: 'turn-mcp-test',
      runtimeContext: {
        conversation: {
          schemaVersion: 'llmwiki-chat.conversation.v1',
          threadId: 'thread-mcp-test',
          sessionId: 'session-mcp-test',
          turnId: 'turn-mcp-test',
          historyLength: 2,
          messagesIncluded: 3,
          latestRole: 'user',
        },
        selectedRuntime: {
          id: 'bridge-mcp',
          name: 'Local Agent Bridge (MCP)',
          protocol: 'bridge-mcp',
        },
        selectedKnowledgeSourceCount: 1,
      },
      knowledgeSources: [
        {
          id: 'wiki',
          title: 'Serve Wiki',
          protocol: 'llmwiki-http',
          status: 'ready',
        },
      ],
    })
    expect(params.arguments.tools).toEqual([
      expect.objectContaining({
        name: 'llmwiki_context__wiki',
        knowledgeSourceId: 'wiki',
      }),
    ])
    expect(result).toMatchObject({
      answer: 'Bridge MCP grounded answer.',
      citations: [{ id: 'wiki:cite-1', title: 'Release', connectionId: 'wiki' }],
      graph: { nodes: [{ id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md' }] },
    })
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'bridge-tool-wiki',
        citationIds: ['wiki:cite-1'],
      }),
    ]))
  })
})

describe('ExternalA2aAgentRuntimeClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('discovers a configured A2A runtime from its agent card', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://127.0.0.1:8770/agents/wiki/.well-known/agent-card.json')
      return Response.json({
        name: 'External Runtime',
        description: 'Remote runtime card',
        url: 'message:send',
        capabilities: { streaming: true, pushNotifications: false },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const discovered = await discoverAgentRuntime({ ...runtime, status: 'unknown' })

    expect(discovered).toMatchObject({
      name: 'Custom A2A',
      description: 'Remote runtime card',
      status: 'ready',
      capabilities: ['a2a-message', 'streaming'],
      error: '',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('attaches a configured bearer token to runtime discovery and message send', async () => {
    const authRuntime = {
      ...runtime,
      bearerToken: 'Bearer runtime-secret',
    }
    const observedAuthHeaders: Array<string | null> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      observedAuthHeaders.push(requestHeader(init, 'authorization'))
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: 'message:send' })
      }
      expect(url).toBe('http://127.0.0.1:8770/agents/wiki/message:send')
      expect(init?.method).toBe('POST')
      return Response.json({
        status: { state: 'completed' },
        message: { parts: [{ kind: 'text', text: 'Authorized runtime answer.' }] },
        artifacts: [],
      })
    }))

    const result = await new ExternalA2aAgentRuntimeClient(authRuntime).run({
      agent: authRuntime,
      knowledgeSources: [knowledgeSource],
      query: 'Can an authenticated runtime answer?',
    })

    expect(result.answer).toBe('Authorized runtime answer.')
    expect(observedAuthHeaders).toEqual([
      'Bearer runtime-secret',
      'Bearer runtime-secret',
    ])
  })

  it('does not mark a named runtime ready from a generic A2A card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      name: 'External Runtime',
      description: 'Generic A2A runtime card',
      url: 'message:send',
    })))

    await expect(discoverAgentRuntime({
      id: 'hermes',
      name: 'Hermes',
      protocol: 'hermes',
      url: 'https://runtime.example.test',
      selected: false,
      status: 'unknown',
    })).rejects.toThrow('does not identify a Hermes runtime')
  })

  it('keeps runtime card discovery at 10s but gives message:send 120s', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Promise.resolve(Response.json({ name: 'External Runtime', url: 'message:send' }))
      }
      expect(url).toBe('http://127.0.0.1:8770/agents/wiki/message:send')
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const run = new ExternalA2aAgentRuntimeClient(runtime).run({
      agent: runtime,
      knowledgeSources: [knowledgeSource],
      query: 'Can a slower runtime answer?',
    })
    let rejection: Error | undefined
    run.catch((error: unknown) => {
      rejection = error instanceof Error ? error : new Error(String(error))
    })
    const assertion = expect(run).rejects.toThrow('Custom A2A message:send timed out after 120s')

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(rejection).toBeUndefined()
    await vi.advanceTimersByTimeAsync(110_000)
    await assertion
  })

  it('times out stalled runtime card discovery', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    const discovery = discoverAgentRuntime({ ...runtime, status: 'unknown' })
    const assertion = expect(discovery).rejects.toThrow('Custom A2A agent card timed out after 10s')

    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('keeps Copilot as an external named runtime candidate instead of a generic built-in adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      name: 'External Runtime',
      description: 'Generic A2A runtime card',
      url: 'message:send',
    })))

    await expect(discoverAgentRuntime({
      id: 'copilot',
      name: 'Copilot',
      protocol: 'copilot',
      url: 'https://runtime.example.test',
      selected: false,
      status: 'unknown',
    })).rejects.toThrow('does not identify a Copilot runtime')
  })

  it('streams a structured llmwiki_agent_result artifact from message:send', async () => {
    let requestBody: Record<string, unknown> | undefined
    const messages = [
      { role: 'user' as const, content: 'Earlier A2A question?' },
      { role: 'assistant' as const, content: 'Earlier A2A answer.' },
      { role: 'user' as const, content: 'What is ready?' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: 'message:send' })
      }
      expect(url).toBe('http://127.0.0.1:8770/agents/wiki/message:send')
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return Response.json({
        status: { state: 'completed' },
        artifacts: [
          {
            name: 'llmwiki_agent_result',
            parts: [
              {
                kind: 'data',
                data: {
                  answer: 'Runtime grounded answer.',
                  citations: [
                    {
                      id: 'wiki:cite-1',
                      title: 'Release',
                      path: 'release.md',
                      snippet: 'Release evidence.',
                      connectionId: 'wiki',
                      sourceRefs: ['SRC-1'],
                    },
                  ],
                  graph: {
                    nodes: [{ id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md' }],
                    edges: [],
                  },
                  steps: [
                    {
                      id: 'runtime-tool-wiki',
                      label: 'Call LLMWiki tool',
                      status: 'completed',
                      connection_id: 'wiki',
                      tool_name: 'llmwiki_context__wiki',
                      citation_ids: ['wiki:cite-1'],
                      detail: 'Read selected source.',
                      latency_ms: 12,
                      request_id: 'req-runtime-step',
                      trace_id: 'trace-runtime-step-direct',
                      diagnostic: {
                        observations: ['The runtime used one selected source.'],
                        remediation: ['Keep the source selected for follow-up questions.'],
                        requestId: 'req-runtime-diagnostic',
                        traceId: 'trace-runtime-step',
                      },
                    },
                  ],
                  requestId: 'req-runtime-payload',
                  traceId: 'trace-runtime-payload',
                },
              },
            ],
          },
        ],
      })
    }))

    const events = []
    for await (const event of new ExternalA2aAgentRuntimeClient(runtime).stream({
      agent: runtime,
      knowledgeSources: [knowledgeSource, unreadyKnowledgeSource],
      query: 'What is ready?',
      messages,
      messageId: 'message-a2a-test',
      threadId: 'thread-a2a-test',
      sessionId: 'session-a2a-test',
      turnId: 'turn-a2a-test',
    })) {
      events.push(event)
    }
    const completed = events.find((event) => event.type === 'run_completed')
    const data = requestBody?.data as {
      runtimeContext: Record<string, unknown>
      knowledgeSources: Array<Record<string, unknown>>
      tools: Array<Record<string, unknown>>
    }

    expect(requestBody).toMatchObject({
      data: {
        query: 'What is ready?',
        message: {
          kind: 'message',
          messageId: 'message-a2a-test',
          contextId: 'thread-a2a-test',
          role: 'user',
          parts: [{ kind: 'text', text: 'What is ready?' }],
          metadata: {
            llmwiki: {
              schemaVersion: 'llmwiki-chat.conversation.v1',
              threadId: 'thread-a2a-test',
              sessionId: 'session-a2a-test',
              turnId: 'turn-a2a-test',
            },
          },
        },
        messages,
        threadId: 'thread-a2a-test',
        sessionId: 'session-a2a-test',
        turnId: 'turn-a2a-test',
        runtimeContext: {
          application: 'llmwiki-chat',
          clientRole: 'ui-session-connection-trace-console',
          runtimeRole: 'external-agent-runtime',
          conversation: {
            schemaVersion: 'llmwiki-chat.conversation.v1',
            threadId: 'thread-a2a-test',
            sessionId: 'session-a2a-test',
            turnId: 'turn-a2a-test',
            historyLength: 2,
            messagesIncluded: 3,
            latestRole: 'user',
          },
          selectedRuntime: {
            id: 'custom-a2a',
            name: 'Custom A2A',
            protocol: 'custom-a2a',
          },
          selectedKnowledgeSourceCount: 1,
          selectedKnowledgeSources: [
            {
              id: 'wiki',
              title: 'Serve Wiki',
              description: 'Serve wiki description',
              protocol: 'llmwiki-http',
              status: 'ready',
            },
          ],
        },
      },
    })
    expect(data.runtimeContext.toolSelection).toContain('does not classify intent by keyword')
    expect(data.knowledgeSources).toEqual([
      {
        id: 'wiki',
        title: 'Serve Wiki',
        name: 'Serve Wiki',
        description: 'Serve wiki description',
        protocol: 'llmwiki-http',
        status: 'ready',
        url: 'http://serve.test',
        capabilities: ['llmwiki_context', 'llmwiki_graph'],
        adapter: 'llmwiki-markdown',
        implementation: 'atomicstrata/llm-wiki-compiler',
      },
    ])
    expect(data.tools).toEqual([
      expect.objectContaining({
        name: 'llmwiki_context__wiki',
        knowledgeSourceId: 'wiki',
        protocol: 'llmwiki-http',
        outputDescription: expect.stringContaining('LLMWiki context shape'),
      }),
    ])
    expect(data.tools[0].description).toContain('Read-only LLMWiki context tool for Serve Wiki')
    expect(data.tools[0].description).toContain('title "Serve Wiki", status "ready"')
    expect(data.tools[0].description).toContain('description "Serve wiki description"')
    expect(data.tools[0].inputSchema).toMatchObject({
      type: 'object',
      properties: {
        query: {
          type: 'string',
        },
        limit: {
          type: 'integer',
          default: 8,
        },
      },
      required: ['query'],
    })
    expect(data.knowledgeSources[0]).not.toHaveProperty('graph')
    expect(data.tools[0]).not.toHaveProperty('graph')
    expect(events.some((event) => event.type === 'citation')).toBe(true)
    expect(completed).toMatchObject({
      result: {
        answer: 'Runtime grounded answer.',
        citations: [{ id: 'wiki:cite-1', title: 'Release', connectionId: 'wiki' }],
        graph: { nodes: [{ id: 'page:release', label: 'Release', kind: 'topic', path: 'release.md' }] },
      },
    })
    expect(completed?.result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'runtime-tool-wiki',
        requestId: 'req-runtime-step',
        traceId: 'trace-runtime-step-direct',
        citationIds: ['wiki:cite-1'],
        diagnostic: expect.objectContaining({
          requestId: 'req-runtime-diagnostic',
          traceId: 'trace-runtime-step',
          observations: ['The runtime used one selected source.'],
          remediation: ['Keep the source selected for follow-up questions.'],
        }),
      }),
      expect.objectContaining({
        id: 'runtime-diagnostic',
        diagnostic: expect.objectContaining({
          requestId: 'req-runtime-payload',
          traceId: 'trace-runtime-payload',
        }),
      }),
    ]))
  })

  it('passes all selected ready sources for federated questions without client-side routing', async () => {
    let requestBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: '/message:send' })
      }
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return Response.json({
        status: { state: 'completed' },
        artifacts: [
          {
            name: 'llmwiki_agent_result',
            parts: [
              {
                kind: 'data',
                data: {
                  answer: 'Federated runtime answer.',
                  citations: [],
                  graph: { nodes: [], edges: [] },
                  steps: [],
                },
              },
            ],
          },
        ],
      })
    }))

    const result = await new ExternalA2aAgentRuntimeClient(runtime).run({
      agent: runtime,
      knowledgeSources: [knowledgeSource, teamKnowledgeSource, unreadyKnowledgeSource],
      query: 'Which selected connection covers release readiness?',
    })
    const data = requestBody?.data as {
      runtimeContext: { selectedKnowledgeSources: Array<Record<string, unknown>> }
      knowledgeSources: Array<Record<string, unknown>>
      tools: Array<Record<string, unknown>>
    }

    expect(result.answer).toBe('Federated runtime answer.')
    expect(data.knowledgeSources.map((source) => source.id)).toEqual(['wiki', 'team-wiki'])
    expect(data.knowledgeSources).toEqual([
      expect.objectContaining({
        id: 'wiki',
        title: 'Serve Wiki',
        description: 'Serve wiki description',
        protocol: 'llmwiki-http',
        status: 'ready',
      }),
      expect.objectContaining({
        id: 'team-wiki',
        title: 'Team Wiki',
        description: 'Team process wiki description',
        protocol: 'mcp',
        status: 'ready',
      }),
    ])
    expect(data.runtimeContext.selectedKnowledgeSources.map((source) => source.id)).toEqual(['wiki', 'team-wiki'])
    expect(data.tools.map((tool) => tool.knowledgeSourceId)).toEqual(['wiki', 'team-wiki'])
    expect(data.tools[1].description).toContain('Team Wiki')
    expect(data.tools[1].description).toContain('status "ready"')
  })

  it('calls the selected LLMWiki query tool for global and local questions', async () => {
    const localRuntime: AgentConnection = {
      id: 'mock-agent',
      name: 'Local Development Runtime',
      protocol: 'mock-agent',
      selected: true,
      status: 'ready',
    }
    const queryBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      queryBodies.push(body)
      return Response.json({
        wiki_title: 'Serve Wiki',
        orientation: [
          { title: 'Current Focus', role: 'hot', snippet: 'Hot page summary.' },
          { title: 'Serve Wiki', role: 'index', snippet: 'Index summary.' },
        ],
        evidence: [
          {
            page_id: 'release',
            title: 'Release',
            path: 'release.md',
            snippet: `Evidence for ${body.query}. | Step | State | | --- | --- | | lint | ready |`,
            source_refs: ['SRC-1'],
          },
        ],
        limitations: ['1 draft or unapproved page(s) were withheld.'],
        graph: { nodes: [], edges: [] },
      })
    }))

    const globalResult = await agentClientFor(localRuntime).run({
      agent: localRuntime,
      knowledgeSources: [knowledgeSource],
      query: 'What is in this wiki?',
    })
    const localResult = await agentClientFor(localRuntime).run({
      agent: localRuntime,
      knowledgeSources: [knowledgeSource],
      query: 'Show current focus',
    })

    expect(queryBodies).toEqual([
      { query: 'What is in this wiki?', limit: 8 },
      { query: 'Show current focus', limit: 8 },
    ])
    expect(globalResult.answer).toContain('**Source orientation**')
    expect(globalResult.answer).toContain('Hot page summary.')
    expect(globalResult.answer).toContain('**Source notes**')
    expect(localResult.answer).toContain('Evidence for Show current focus.\n\n| Step | State |')
    expect(localResult.answer).toContain('| lint | ready |')
  })

  it('rehydrates flattened source tables in local runtime markdown answers', async () => {
    const localRuntime: AgentConnection = {
      id: 'mock-agent',
      name: 'Local Development Runtime',
      protocol: 'mock-agent',
      selected: true,
      status: 'ready',
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      wiki_title: 'Serve Wiki',
      orientation: [
        {
          title: 'Data Quality',
          role: 'topic',
          snippet: 'Any analysis should account for missing fields. | Field | Missing rows | | --- | --- | | species | 0 | | bill_length_mm | 2 |',
        },
      ],
      evidence: [],
      limitations: [],
      graph: { nodes: [], edges: [] },
    })))

    const result = await agentClientFor(localRuntime).run({
      agent: localRuntime,
      knowledgeSources: [knowledgeSource],
      query: 'What is in this wiki?',
    })

    expect(result.answer).toContain('Any analysis should account for missing fields.\n\n| Field | Missing rows |')
    expect(result.answer).toContain('| --- | --- |')
    expect(result.answer).toContain('| species | 0 |')
    expect(result.answer).toContain('| bill_length_mm | 2 |')
  })

  it('falls back to message text when the runtime omits the structured artifact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: '/message:send' })
      }
      return Response.json({
        status: { state: 'completed' },
        message: { parts: [{ kind: 'text', text: 'Plain runtime answer.' }] },
        artifacts: [],
      })
    }))

    const result = await new ExternalA2aAgentRuntimeClient(runtime).run({
      agent: runtime,
      knowledgeSources: [knowledgeSource],
      query: 'Fallback?',
    })

    expect(result.answer).toBe('Plain runtime answer.')
    expect(result.citations).toEqual([])
    expect(result.steps.some((item) => item.id === 'runtime-unstructured-response')).toBe(true)
  })

  it.each([
    'http://runtime.example.test',
    'http://10.1.2.3:8770',
    'https://10.1.2.3:8770',
    'https://100.64.0.1:8770',
    'https://100.127.255.255:8770',
    'https://192.0.0.1:8770',
    'https://192.0.2.1:8770',
    'https://198.18.0.1:8770',
    'https://198.19.255.255:8770',
    'https://198.51.100.1:8770',
    'https://203.0.113.1:8770',
    'https://224.0.0.1:8770',
    'https://239.255.255.255:8770',
    'https://240.0.0.1:8770',
    'https://255.255.255.255:8770',
    'https://[::]:8770',
    'https://[ff00::1]:8770',
    'https://[2001:db8::1]:8770',
    'https://[::ffff:100.64.0.1]:8770',
    'https://[::ffff:198.18.0.1]:8770',
    'https://runtime.internal',
  ])('rejects unsafe runtime URL %s before discovery', async (url) => {
    expect(isAllowedAgentRuntimeUrl(url)).toBe(false)

    await expect(discoverAgentRuntime({
      ...runtime,
      url,
      status: 'unknown',
    })).rejects.toThrow(agentRuntimeUrlPolicyMessage)
  })

  it.each([
    'http://127.0.0.1:8770',
    'http://localhost:8770',
    'https://runtime.example.test',
  ])('allows runtime URL %s before runtime validation', (url) => {
    expect(isAllowedAgentRuntimeUrl(url)).toBe(true)
  })

  it('allows private and tailnet runtime URLs only when the local dev override is enabled', () => {
    const env = import.meta.env as Record<string, string | boolean | undefined>
    const previous = env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
    try {
      env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = 'true'

      expect(isAllowedAgentRuntimeUrl('http://10.1.2.3:8770')).toBe(true)
      expect(isAllowedAgentRuntimeUrl('http://100.64.0.1:8770')).toBe(true)
      expect(isAllowedAgentRuntimeUrl('https://100.64.0.1:8770')).toBe(true)
      expect(isAllowedAgentRuntimeUrl('https://172.16.0.1:8770')).toBe(true)
      expect(isAllowedAgentRuntimeUrl('https://192.168.0.2:8770')).toBe(true)
      expect(isAllowedAgentRuntimeUrl('https://[fc00::1]:8770')).toBe(true)
    } finally {
      if (previous === undefined) {
        delete env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
      } else {
        env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = previous
      }
    }
  })

  it.each([
    'https://192.0.2.1:8770',
    'https://198.18.0.1:8770',
    'https://203.0.113.1:8770',
    'https://224.0.0.1:8770',
    'https://[2001:db8::1]:8770',
    'https://[ff00::1]:8770',
    'https://runtime.internal',
  ])('keeps non-private special-use runtime URL %s blocked even with the local dev override', (url) => {
    const env = import.meta.env as Record<string, string | boolean | undefined>
    const previous = env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
    try {
      env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = 'true'

      expect(isAllowedAgentRuntimeUrl(url)).toBe(false)
    } finally {
      if (previous === undefined) {
        delete env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
      } else {
        env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = previous
      }
    }
  })

  it('keeps private tailnet runtime URLs blocked outside dev even when the override is set', () => {
    const env = import.meta.env as Record<string, string | boolean | undefined>
    const previousDev = env.DEV
    const previousOverride = env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
    try {
      env.DEV = false
      env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = 'true'

      expect(isAllowedAgentRuntimeUrl('http://100.64.0.1:8770')).toBe(false)
      expect(isAllowedAgentRuntimeUrl('https://100.64.0.1:8770')).toBe(false)
    } finally {
      env.DEV = previousDev
      if (previousOverride === undefined) {
        delete env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS
      } else {
        env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS = previousOverride
      }
    }
  })

  it.each([
    'http://10.0.0.5/message:send',
    'https://runtime.internal/message:send',
    'http://runtime.example.com/message:send',
  ])('rejects unsafe A2A card message URL %s', async (cardMessageUrl) => {
    const fetchMock = vi.fn(async () => Response.json({
      name: 'External Runtime',
      url: cardMessageUrl,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(discoverAgentRuntime({
      ...runtime,
      url: 'https://runtime.example.com/agents/wiki',
      status: 'unknown',
    })).rejects.toThrow(`A2A agent card message URL is not allowed. ${agentRuntimeUrlPolicyMessage}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: 'root-relative message URL on a loopback configured URL',
      configuredUrl: 'http://127.0.0.1:8770/agents/wiki',
      cardMessageUrl: '/message:send',
      expectedMessageUrl: 'http://127.0.0.1:8770/message:send',
    },
    {
      label: 'relative message URL on a public HTTPS configured URL',
      configuredUrl: 'https://runtime.example.com/agents/wiki',
      cardMessageUrl: 'message:send',
      expectedMessageUrl: 'https://runtime.example.com/agents/wiki/message:send',
    },
    {
      label: 'absolute public HTTPS message URL',
      configuredUrl: 'https://runtime.example.com/agents/wiki',
      cardMessageUrl: 'https://messages.example.com/message:send',
      expectedMessageUrl: 'https://messages.example.com/message:send',
    },
  ])('allows $label', async ({ configuredUrl, cardMessageUrl, expectedMessageUrl }) => {
    const agent = { ...runtime, url: configuredUrl }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: cardMessageUrl })
      }
      expect(url).toBe(expectedMessageUrl)
      expect(init?.method).toBe('POST')
      return Response.json({
        status: { state: 'completed' },
        message: { parts: [{ kind: 'text', text: 'Allowed runtime answer.' }] },
        artifacts: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ExternalA2aAgentRuntimeClient(agent).run({
      agent,
      knowledgeSources: [knowledgeSource],
      query: 'Allowed?',
    })

    expect(result.answer).toBe('Allowed runtime answer.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects failed A2A runtime statuses as clean errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/agent-card.json')) {
        return Response.json({ name: 'External Runtime', url: '/message:send' })
      }
      return Response.json({
        status: {
          state: 'failed',
          message: { parts: [{ kind: 'text', text: 'model unavailable' }] },
        },
      })
    }))

    await expect(new ExternalA2aAgentRuntimeClient(runtime).run({
      agent: runtime,
      knowledgeSources: [knowledgeSource],
      query: 'Will this work?',
    })).rejects.toThrow('a2a runtime failed: model unavailable')
  })
})
