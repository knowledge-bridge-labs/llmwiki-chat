import {
  clientFor,
  diagnosticFromError,
  errorWithDiagnostic,
  fetchJson,
  normalizeDiagnosticEnvelope,
  normalizeGraphPayload,
} from './serveClient'
import type {
  AgentConnection,
  AgentProtocol,
  AgentRuntimeA2aTextMessage,
  AgentRuntimeMessage,
  AgentStep,
  Citation,
  Connection,
  Diagnostic,
  KnowledgeGraph,
  KnowledgeQueryResult,
  Protocol,
} from './domain'
import { emptyGraph, mergeGraphs, namespaceGraph } from './graph'
import { agentRuntimeUrlPolicyMessage, isAllowedAgentRuntimeUrl } from './urlPolicy'

const EXTERNAL_A2A_AGENT_CARD_TIMEOUT_MS = 10_000
const EXTERNAL_A2A_RUNTIME_MESSAGE_TIMEOUT_MS = 120_000
const BRIDGE_MCP_DISCOVERY_TIMEOUT_MS = 10_000
const BRIDGE_MCP_RUNTIME_TOOL_TIMEOUT_MS = 120_000
const LOCAL_AGENT_BRIDGE_URL = 'http://127.0.0.1:8788'
const AGENT_RUNTIME_MESSAGE_LIMIT = 16
const CONVERSATION_SCHEMA_VERSION = 'llmwiki-chat.conversation.v1'

export interface AgentRunRequest {
  agent: AgentConnection
  knowledgeSources: Connection[]
  query: string
  messages?: AgentRuntimeMessage[]
  messageId?: string
  threadId?: string
  sessionId?: string
  turnId?: string
  signal?: AbortSignal
}

export interface AgentRunResult {
  answer: string
  citations: Citation[]
  graph: KnowledgeGraph
  steps: AgentStep[]
}

export interface AgentRuntimeRequestLog {
  transport: 'a2a-message:send' | 'mcp-tools/call'
  summary: {
    runtimeId: string
    runtimeName: string
    runtimeProtocol: AgentProtocol
    selectedKnowledgeSourceCount: number
    messagesIncluded: number
    hasA2aMessage: boolean
  }
  body: Record<string, unknown>
}

export type AgentRunEvent =
  | { type: 'run_started'; step: AgentStep }
  | { type: 'status'; step: AgentStep }
  | { type: 'runtime_request'; request: AgentRuntimeRequestLog }
  | { type: 'tool_call_started'; step: AgentStep; connectionId: string; toolName: string }
  | {
      type: 'tool_call_result'
      step: AgentStep
      connectionId: string
      toolName: string
      citations: Citation[]
      graph?: KnowledgeGraph
    }
  | { type: 'citation'; citation: Citation }
  | { type: 'graph_update'; graph: KnowledgeGraph }
  | { type: 'answer_delta'; delta: string }
  | { type: 'run_completed'; result: AgentRunResult }
  | { type: 'error'; step: AgentStep; error: string }

export interface AgentRuntimeClient {
  stream(request: AgentRunRequest): AsyncGenerator<AgentRunEvent>
  run(request: AgentRunRequest): Promise<AgentRunResult>
}

export interface AgentRuntimeDefinition {
  id: string
  name: string
  protocol: AgentProtocol
  status: AgentConnection['status']
  description: string
  url?: string
  selected?: boolean
  bridge?: AgentConnection['bridge']
  createClient: (agent: AgentConnection) => AgentRuntimeClient
}

export interface AgentRuntimeEndpoint {
  card: Record<string, unknown>
  cardUrl: string
  messageUrl: string
}

export interface BridgeKnowledgeSource {
  id: string
  name: string
  description?: string
  protocol: Protocol
  url: string
  selected: boolean
  status: Connection['status']
  capabilities?: string[]
  adapter?: string
  implementation?: string
}

export const agentRuntimeRegistry: AgentRuntimeDefinition[] = [
  {
    id: 'bridge-a2a',
    name: 'Local Agent Bridge (A2A)',
    protocol: 'bridge-a2a',
    status: 'unknown',
    url: LOCAL_AGENT_BRIDGE_URL,
    selected: true,
    bridge: { mode: 'a2a', local: true },
    description: 'Default Agent Bridge connection using the A2A agent-card and message endpoint.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
  {
    id: 'bridge-mcp',
    name: 'Local Agent Bridge (MCP)',
    protocol: 'bridge-mcp',
    status: 'unknown',
    url: LOCAL_AGENT_BRIDGE_URL,
    bridge: { mode: 'mcp', local: true },
    description: 'Agent Bridge connection using MCP JSON-RPC tools/list and tools/call.',
    createClient: (agent) => new BridgeMcpAgentRuntimeClient(agent),
  },
  {
    id: 'custom-bridge-a2a',
    name: 'Custom Agent Bridge (A2A)',
    protocol: 'bridge-a2a',
    status: 'unavailable',
    bridge: { mode: 'a2a' },
    description: 'Additional Agent Bridge connection using an A2A agent-card and message endpoint.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
  {
    id: 'custom-bridge-mcp',
    name: 'Custom Agent Bridge (MCP)',
    protocol: 'bridge-mcp',
    status: 'unavailable',
    bridge: { mode: 'mcp' },
    description: 'Additional Agent Bridge connection using MCP JSON-RPC tools/list and tools/call.',
    createClient: (agent) => new BridgeMcpAgentRuntimeClient(agent),
  },
  {
    id: 'mock-agent',
    name: 'Local Development Runtime',
    protocol: 'mock-agent',
    status: 'ready',
    description: 'Local development runtime for exercising the UI with deterministic fallback answers while still calling selected LLMWiki sources as real tools.',
    createClient: () => new DevelopmentMockAgentRuntimeClient(),
  },
  {
    id: 'hermes',
    name: 'Hermes',
    protocol: 'hermes',
    status: 'unavailable',
    description: 'A2A-compatible Hermes runtime slot. Configure a runtime URL and test it before use.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
  {
    id: 'deepagents',
    name: 'DeepAgents',
    protocol: 'deepagents',
    status: 'unavailable',
    description: 'A2A-compatible DeepAgents runtime slot. Configure a runtime URL and test it before use.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
  {
    id: 'copilot',
    name: 'Copilot',
    protocol: 'copilot',
    status: 'unavailable',
    description: 'External Copilot runtime candidate for agents that consume MCP-style JSON-RPC or A2A-style message tool surfaces. Configure an A2A runtime URL and test it before use.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
  {
    id: 'custom-a2a',
    name: 'Custom A2A',
    protocol: 'custom-a2a',
    status: 'unavailable',
    description: 'Generic A2A-compatible Agent Runtime slot.',
    createClient: (agent) => new ExternalA2aAgentRuntimeClient(agent),
  },
]

export const starterAgentConnections: AgentConnection[] = agentRuntimeRegistry.map(
  (runtime) => ({
    id: runtime.id,
    name: runtime.name,
    protocol: runtime.protocol,
    url: runtime.url,
    bridge: runtime.bridge,
    status: runtime.status,
    description: runtime.description,
    selected: Boolean(runtime.selected),
  }),
)

export function agentClientFor(agent: AgentConnection): AgentRuntimeClient {
  const registration = agentRuntimeRegistry.find((item) => item.id === agent.id || item.protocol === agent.protocol)
  if (!registration || agent.status !== 'ready') return new UnavailableAgentRuntimeClient(agent)
  return registration.createClient(agent)
}

export async function discoverAgentRuntime(agent: AgentConnection, signal?: AbortSignal): Promise<AgentConnection> {
  if (agent.protocol === 'mock-agent') {
    return { ...agent, status: 'ready', error: '' }
  }
  if (agent.protocol === 'bridge-mcp') {
    return discoverBridgeMcpAgentRuntime(agent, signal)
  }
  const started = performance.now()
  const endpoint = await loadExternalA2aRuntimeEndpoint(agent, signal)
  assertRuntimeCardMatchesAgent(agent, endpoint.card)
  return {
    ...agent,
    url: agent.url?.trim(),
    description: readString(endpoint.card, 'description') || agent.description,
    capabilities: uniqueStrings(['a2a-message', ...capabilitiesFromA2aCard(endpoint.card)]),
    settingsUrl: runtimeSettingsUrl(endpoint.card, endpoint.cardUrl),
    status: 'ready',
    latencyMs: Math.round(performance.now() - started),
    error: '',
    diagnostic: undefined,
  }
}

export async function discoverBridgeKnowledgeSources(
  agent: AgentConnection,
  signal?: AbortSignal,
): Promise<BridgeKnowledgeSource[]> {
  const result = await callBridgeMcpMethod(
    agent,
    'tools/call',
    {
      name: 'llmwiki_list_sources',
      arguments: {},
    },
    signal,
    `${agent.name} llmwiki_list_sources`,
    BRIDGE_MCP_DISCOVERY_TIMEOUT_MS,
  )
  return normalizeBridgeKnowledgeSources(result)
}

async function discoverBridgeMcpAgentRuntime(
  agent: AgentConnection,
  signal?: AbortSignal,
): Promise<AgentConnection> {
  const started = performance.now()
  const toolsResult = await callBridgeMcpMethod(
    agent,
    'tools/list',
    undefined,
    signal,
    `${agent.name} tools/list`,
    BRIDGE_MCP_DISCOVERY_TIMEOUT_MS,
  )
  const tools = readRecordArray(toolsResult.tools)
  if (!tools.some((tool) => readString(tool, 'name') === 'llmwiki_agent_run')) {
    throw new Error(`${agent.name} MCP endpoint did not expose llmwiki_agent_run.`)
  }

  return {
    ...agent,
    url: agent.url?.trim(),
    capabilities: uniqueStrings(['mcp-tools/list', 'mcp-tools/call', ...tools.map((tool) => readString(tool, 'name'))]),
    settingsUrl: mcpSettingsUrl(toolsResult, agent.url || ''),
    status: 'ready',
    latencyMs: Math.round(performance.now() - started),
    error: '',
    diagnostic: undefined,
  }
}

class DevelopmentMockAgentRuntimeClient implements AgentRuntimeClient {
  async *stream(request: AgentRunRequest): AsyncGenerator<AgentRunEvent> {
    const usableSources = selectedKnowledgeSources(request)
    const steps: AgentStep[] = []
    const responses: Array<{ source: Connection; response?: KnowledgeQueryResult; error?: string }> = []
    const graphs: KnowledgeGraph[] = []
    const citations: Citation[] = []

    const planStep = step({
      id: 'planning',
      label: 'Planning',
      status: 'done',
      runtimeId: request.agent.id,
      detail: `Prepared ${usableSources.length} selected LLMWiki connection(s) as callable tools${sourceContextSuffix(usableSources)}.`,
    })
    steps.push(planStep)
    yield { type: 'run_started', step: planStep }

    if (!usableSources.length) {
      const errorStep = step({
        id: 'no-source',
        label: 'Check selected sources',
        status: 'error',
        runtimeId: request.agent.id,
        detail: 'No ready LLMWiki knowledge source is selected.',
        error: 'No ready selected knowledge source',
        parentId: planStep.id,
      })
      steps.push(errorStep)
      const result = {
        answer: renderAgentAnswer(request.agent, request.query, responses, citations),
        citations,
        graph: emptyGraph(),
        steps,
      }
      yield { type: 'error', step: errorStep, error: errorStep.error || errorStep.detail || 'No selected source' }
      yield { type: 'run_completed', result }
      return
    }

    for (const source of usableSources) {
      const toolName = toolNameFor(source)
      const started = performance.now()
      const callStep = step({
        id: `tool-${source.id}`,
        label: `Tool call: ${source.name}`,
        status: 'running',
        runtimeId: request.agent.id,
        toolName,
        connectionId: source.id,
        detail: `Calling ${toolName} against ${source.url}.`,
        parentId: planStep.id,
      })
      steps.push(callStep)
      yield { type: 'tool_call_started', step: callStep, connectionId: source.id, toolName }

      try {
        const response = await clientFor(source).query(source, request.query, request.signal)
        const latencyMs = Math.round(performance.now() - started)
        const namespacedGraph = response.graph ? namespaceGraph(response.graph, source) : undefined
        if (namespacedGraph) graphs.push(namespacedGraph)
        citations.push(...response.citations)
        responses.push({ source, response })

        const doneStep = {
          ...callStep,
          status: 'done' as const,
          detail: `Tool returned ${response.citations.length} citation(s) from ${response.wikiTitle}.`,
          latencyMs,
        }
        replaceStep(steps, doneStep)
        yield {
          type: 'tool_call_result',
          step: doneStep,
          connectionId: source.id,
          toolName,
          citations: response.citations,
          graph: namespacedGraph,
        }
        for (const citation of response.citations) yield { type: 'citation', citation }
        if (namespacedGraph) yield { type: 'graph_update', graph: mergeGraphs(graphs) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isCanceledRequestError(error)) {
          throw new Error(message)
        }
        responses.push({ source, error: message })
        const failedStep = {
          ...callStep,
          status: 'error' as const,
          detail: `Tool failed for ${source.name}.`,
          latencyMs: Math.round(performance.now() - started),
          error: message,
        }
        replaceStep(steps, failedStep)
        yield { type: 'error', step: failedStep, error: message }
      }
    }

    const readStep = step({
      id: 'evidence-read',
      label: 'Evidence read',
      status: 'done',
      runtimeId: request.agent.id,
      detail: `Read ${citations.length} citation(s) across ${responses.length} tool result(s).`,
    })
    steps.push(readStep)
    yield { type: 'status', step: readStep }

    const answer = renderAgentAnswer(request.agent, request.query, responses, citations)
    const finalStep = step({
      id: 'final-answer',
      label: 'Final answer',
      status: 'done',
      runtimeId: request.agent.id,
      detail: 'Rendered a markdown answer from tool results and citation metadata.',
    })
    steps.push(finalStep)
    yield { type: 'status', step: finalStep }
    yield { type: 'answer_delta', delta: answer }

    const result = {
      answer,
      citations,
      graph: mergeGraphs(graphs),
      steps,
    }
    yield { type: 'run_completed', result }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    let result: AgentRunResult | null = null
    for await (const event of this.stream(request)) {
      if (event.type === 'run_completed') result = event.result
    }
    if (!result) {
      throw new Error(`${request.agent.name} did not complete`)
    }
    return result
  }
}

export class ExternalA2aAgentRuntimeClient implements AgentRuntimeClient {
  constructor(private readonly agent: AgentConnection) {}

  async *stream(request: AgentRunRequest): AsyncGenerator<AgentRunEvent> {
    const steps: AgentStep[] = []
    const discoverStep = step({
      id: 'runtime-discovery',
      label: `Discover ${request.agent.name}`,
      status: 'running',
      runtimeId: request.agent.id,
      detail: `Loading the A2A agent card for ${request.agent.name}.`,
    })
    steps.push(discoverStep)
    yield { type: 'run_started', step: discoverStep }

    try {
      const endpoint = await loadExternalA2aRuntimeEndpoint(request.agent, request.signal)
      const discoveredStep = {
        ...discoverStep,
        status: 'done' as const,
        detail: `Discovered A2A message endpoint ${endpoint.messageUrl}.`,
      }
      replaceStep(steps, discoveredStep)
      yield { type: 'status', step: discoveredStep }

      const callStep = step({
        id: 'runtime-message',
        label: `Run ${request.agent.name}`,
        status: 'running',
        runtimeId: request.agent.id,
        detail: `Sending the query and ${selectedKnowledgeSources(request).length} selected knowledge source descriptor(s).`,
        parentId: discoverStep.id,
      })
      steps.push(callStep)
      yield { type: 'status', step: callStep }

      const usableSources = selectedKnowledgeSources(request)
      const requestBody = { data: agentRunArguments(request, usableSources) }
      yield {
        type: 'runtime_request',
        request: agentRuntimeRequestLog('a2a-message:send', request, usableSources, requestBody),
      }

      const response = await postExternalA2aRuntimeMessage(endpoint.messageUrl, request, requestBody, request.signal)
      const parsed = parseA2aAgentRunResult(request, response)
      const doneCallStep = {
        ...callStep,
        status: 'done' as const,
        detail: parsed.structured
          ? `Runtime returned a structured llmwiki_agent_result artifact with ${parsed.result.citations.length} citation(s).`
          : 'Runtime returned an unstructured A2A message.',
      }
      replaceStep(steps, doneCallStep)
      yield { type: 'status', step: doneCallStep }

      const result = {
        ...parsed.result,
        steps: [...steps, ...parsed.result.steps],
      }
      for (const citation of result.citations) yield { type: 'citation', citation }
      if (result.graph.nodes.length || result.graph.edges.length) yield { type: 'graph_update', graph: result.graph }
      if (result.answer) yield { type: 'answer_delta', delta: result.answer }
      yield { type: 'run_completed', result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const diagnostic = diagnosticFromError(error)
      const runningStep = [...steps].reverse().find((item) => item.status === 'running')
      const errorStep = {
        ...(runningStep || discoverStep),
        status: 'error' as const,
        detail: `Runtime call failed for ${request.agent.name}.`,
        error: message,
        diagnostic,
      }
      replaceStep(steps, errorStep)
      yield { type: 'error', step: errorStep, error: message }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    let result: AgentRunResult | null = null
    for await (const event of this.stream(request)) {
      if (event.type === 'run_completed') result = event.result
    }
    if (!result) throw new Error(`${this.agent.name} did not complete`)
    return result
  }
}

export class BridgeMcpAgentRuntimeClient implements AgentRuntimeClient {
  constructor(private readonly agent: AgentConnection) {}

  async *stream(request: AgentRunRequest): AsyncGenerator<AgentRunEvent> {
    const steps: AgentStep[] = []
    const discoverStep = step({
      id: 'runtime-discovery',
      label: `Discover ${request.agent.name}`,
      status: 'running',
      runtimeId: request.agent.id,
      detail: `Loading MCP tools from ${request.agent.name}.`,
    })
    steps.push(discoverStep)
    yield { type: 'run_started', step: discoverStep }

    try {
      const toolsResult = await callBridgeMcpMethod(
        request.agent,
        'tools/list',
        undefined,
        request.signal,
        `${request.agent.name} tools/list`,
        BRIDGE_MCP_DISCOVERY_TIMEOUT_MS,
      )
      const tools = readRecordArray(toolsResult.tools)
      if (!tools.some((tool) => readString(tool, 'name') === 'llmwiki_agent_run')) {
        throw new Error(`${request.agent.name} MCP endpoint did not expose llmwiki_agent_run.`)
      }
      const discoveredStep = {
        ...discoverStep,
        status: 'done' as const,
        detail: 'Discovered MCP tool llmwiki_agent_run.',
      }
      replaceStep(steps, discoveredStep)
      yield { type: 'status', step: discoveredStep }

      const usableSources = selectedKnowledgeSources(request)
      const callStep = step({
        id: 'runtime-tool-call',
        label: `Run ${request.agent.name}`,
        status: 'running',
        runtimeId: request.agent.id,
        toolName: 'llmwiki_agent_run',
        detail: `Sending the query and ${usableSources.length} selected knowledge source descriptor(s).`,
        parentId: discoverStep.id,
      })
      steps.push(callStep)
      yield { type: 'status', step: callStep }

      const params = {
        name: 'llmwiki_agent_run',
        arguments: agentRunArguments(request, usableSources),
      }
      const requestBody = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params,
      }
      yield {
        type: 'runtime_request',
        request: agentRuntimeRequestLog('mcp-tools/call', request, usableSources, requestBody),
      }

      const response = await callBridgeMcpMethod(
        request.agent,
        'tools/call',
        params,
        request.signal,
        `${request.agent.name} llmwiki_agent_run`,
        BRIDGE_MCP_RUNTIME_TOOL_TIMEOUT_MS,
      )
      const parsed = parseMcpAgentRunResult(request, response)
      const doneCallStep = {
        ...callStep,
        status: 'done' as const,
        detail: parsed.structured
          ? `Bridge returned a structured llmwiki_agent_run result with ${parsed.result.citations.length} citation(s).`
          : 'Bridge returned unstructured MCP tool content.',
      }
      replaceStep(steps, doneCallStep)
      yield { type: 'status', step: doneCallStep }

      const result = {
        ...parsed.result,
        steps: [...steps, ...parsed.result.steps],
      }
      for (const citation of result.citations) yield { type: 'citation', citation }
      if (result.graph.nodes.length || result.graph.edges.length) yield { type: 'graph_update', graph: result.graph }
      if (result.answer) yield { type: 'answer_delta', delta: result.answer }
      yield { type: 'run_completed', result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const diagnostic = diagnosticFromError(error)
      const runningStep = [...steps].reverse().find((item) => item.status === 'running')
      const errorStep = {
        ...(runningStep || discoverStep),
        status: 'error' as const,
        detail: `Bridge call failed for ${request.agent.name}.`,
        error: message,
        diagnostic,
      }
      replaceStep(steps, errorStep)
      yield { type: 'error', step: errorStep, error: message }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    let result: AgentRunResult | null = null
    for await (const event of this.stream(request)) {
      if (event.type === 'run_completed') result = event.result
    }
    if (!result) throw new Error(`${this.agent.name} did not complete`)
    return result
  }
}

class UnavailableAgentRuntimeClient implements AgentRuntimeClient {
  constructor(private readonly agent: AgentConnection) {}

  async *stream(request: AgentRunRequest): AsyncGenerator<AgentRunEvent> {
    const errorStep = step({
      id: 'runtime-unavailable',
      label: `Connect ${this.agent.name}`,
      status: 'error',
      runtimeId: this.agent.id,
      detail: `${this.agent.name} is registered as an Agent Runtime option, but its adapter is not available yet.`,
      error: 'Agent Runtime adapter unavailable',
    })
    const result = {
      answer: `**${this.agent.name}** is unavailable. Select a ready Agent Runtime before asking again.`,
      citations: [],
      graph: emptyGraph(),
      steps: [errorStep],
    }
    void request
    yield { type: 'error', step: errorStep, error: errorStep.error || errorStep.detail || 'Runtime unavailable' }
    yield { type: 'run_completed', result }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    let result: AgentRunResult | null = null
    for await (const event of this.stream(request)) {
      if (event.type === 'run_completed') result = event.result
    }
    if (!result) throw new Error(`${this.agent.name} did not complete`)
    return result
  }
}

function renderAgentAnswer(
  agent: AgentConnection,
  query: string,
  responses: Array<{ source: Connection; response?: KnowledgeQueryResult; error?: string }>,
  citations: Citation[],
): string {
  if (!responses.length) {
    return [
      `**${agent.name}** could not run because no ready knowledge source is selected.`,
      '',
      'Select at least one ready LLMWiki knowledge source, then ask again.',
    ].join('\n')
  }

  const sourceNames = responses.map((item) => item.source.name).join(', ')
  const failed = responses.filter((item) => item.error)
  const orientationLines = sourceOrientationLines(responses)
  const limitationLines = sourceLimitationLines(responses)
  if (!citations.length) {
    const lines = [
      `**${agent.name}** used ${responses.length} knowledge source(s): ${sourceNames}.`,
      '',
      `The selected tools did not return citation-grade evidence for "${query}".`,
    ]
    if (orientationLines.length) {
      lines.push('', '**Source orientation**', ...orientationLines)
    }
    if (limitationLines.length) {
      lines.push('', '**Source notes**', ...limitationLines)
    }
    if (failed.length) {
      lines.push('', '**Tool issues**')
      failed.forEach((item) => lines.push('', `- ${item.source.name}: ${item.error}`))
    }
    return lines.join('\n')
  }

  const topCitations = citations.slice(0, 5)
  const focus = [...new Set(topCitations.map((citation) => citation.title))]
  const lines = [
    `**${agent.name}** used ${responses.length} knowledge source(s): ${sourceNames}.`,
    '',
    `For "${query}", the available evidence points to ${focus.join(', ')}.`,
    '',
  ]
  if (orientationLines.length) {
    lines.push('', '**Source orientation**', ...orientationLines)
  }
  lines.push('', '**Grounded answer**')
  topCitations.forEach((citation, index) => {
    const snippet = formatSourceSnippetMarkdown(citation.snippet || citation.title)
    lines.push(
      '',
      `**${index + 1}. ${citation.title || citation.path || 'Evidence'} [${index + 1}](#citation-${index + 1})**`,
      '',
      snippet,
    )
  })
  if (limitationLines.length) {
    lines.push('', '**Source notes**', ...limitationLines)
  }
  lines.push('', '**Next inspection path**')
  topCitations.slice(0, 3).forEach((citation, index) => {
    lines.push('', `- Open [${citation.title}](#citation-${index + 1})${citation.path ? ` (${citation.path})` : ''}`)
  })
  if (failed.length) {
    lines.push('', '**Tool issues**')
    failed.forEach((item) => lines.push('', `- ${item.source.name}: ${item.error}`))
  }
  return lines.join('\n')
}

function sourceContextSuffix(sources: Connection[]): string {
  const context = sources.slice(0, 3).map(sourceDescriptorSummary)
  const remaining = Math.max(sources.length - context.length, 0)
  if (!context.length) return ''
  return `: ${context.join('; ')}${remaining ? `; +${remaining} more` : ''}`
}

function sourceDescriptorSummary(source: Connection): string {
  const description = source.description ? ` - ${source.description}` : ''
  return `${source.name} (${source.protocol}, ${source.status})${description}`
}

function sourceOrientationLines(
  responses: Array<{ source: Connection; response?: KnowledgeQueryResult; error?: string }>,
): string[] {
  return responses.flatMap((item) => (
    item.response?.orientation || []
  ).slice(0, 3).map((orientation) => {
    const role = orientation.role ? `, ${orientation.role}` : ''
    const snippet = formatSourceSnippetMarkdown(orientation.snippet || 'No snippet returned.')
    return [
      `**${item.source.name}: ${orientation.title}${role}**`,
      '',
      snippet,
    ].join('\n')
  })).slice(0, 8)
}

function formatSourceSnippetMarkdown(snippet: string): string {
  let text = snippet.trim()
  if (!text) return 'No snippet returned.'

  text = breakBeforeInlineHeadings(text)
  text = breakFlattenedTableRows(text)
  text = separateInlineTablesAndHeadings(text)

  return text
}

function breakBeforeInlineHeadings(value: string): string {
  let output = ''
  let index = 0
  while (index < value.length) {
    if (isWhitespace(value[index])) {
      const markerStart = skipWhitespace(value, index)
      if (markdownHeadingMarkerLength(value, markerStart)) {
        output = `${output.trimEnd()}\n\n`
        index = markerStart
        continue
      }
    }
    output += value[index]
    index += 1
  }
  return output
}

function breakFlattenedTableRows(value: string): string {
  let output = ''
  let index = 0
  while (index < value.length) {
    if (value[index] === '|' && index > 0 && isInlineWhitespace(value[index - 1])) {
      const nextPipe = skipInlineWhitespace(value, index + 1)
      const nextValue = skipInlineWhitespace(value, nextPipe + 1)
      if (value[nextPipe] === '|' && nextPipe > index + 1 && nextValue > nextPipe + 1) {
        output += '|\n| '
        index = nextValue
        continue
      }
    }
    output += value[index]
    index += 1
  }
  return output
}

function separateInlineTablesAndHeadings(value: string): string {
  const lines = value.split('\n')
  const formatted: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (index + 1 < lines.length && isMarkdownTableSeparatorLine(lines[index + 1])) {
      const tableStart = inlineTableStartIndex(line)
      if (tableStart > 0) {
        formatted.push(line.slice(0, tableStart).trimEnd(), '', line.slice(tableStart).trimStart())
        continue
      }
    }

    const headingStart = followingHeadingStartIndex(line)
    if (headingStart > 0 && looksLikeMarkdownTableRow(line.slice(0, headingStart))) {
      formatted.push(line.slice(0, headingStart).trimEnd(), '', line.slice(headingStart).trimStart())
      continue
    }

    formatted.push(line)
  }
  return formatted.join('\n')
}

function inlineTableStartIndex(line: string): number {
  let pipeIndex = line.indexOf('|')
  while (pipeIndex >= 0) {
    const prefix = line.slice(0, pipeIndex).trimEnd()
    const tableRow = line.slice(pipeIndex).trimStart()
    if (
      looksLikeMarkdownTableRow(tableRow)
      && (isMarkdownHeadingLine(prefix) || endsWithSentencePunctuation(prefix))
    ) {
      return pipeIndex
    }
    pipeIndex = line.indexOf('|', pipeIndex + 1)
  }
  return -1
}

function followingHeadingStartIndex(line: string): number {
  let index = 0
  while (index < line.length) {
    if (isWhitespace(line[index])) {
      const markerStart = skipWhitespace(line, index)
      if (markdownHeadingMarkerLength(line, markerStart)) return markerStart
      index = markerStart
      continue
    }
    index += 1
  }
  return -1
}

function isMarkdownHeadingLine(value: string): boolean {
  return markdownHeadingMarkerLength(value.trimStart(), 0) > 0
}

function markdownHeadingMarkerLength(value: string, start: number): number {
  let count = 0
  while (start + count < value.length && value[start + count] === '#' && count < 6) count += 1
  if (!count || value[start + count] === '#') return 0
  return isWhitespace(value[start + count]) ? count : 0
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  const value = line.trimStart()
  if (!value.startsWith('|')) return false
  let index = skipInlineWhitespace(value, 1)
  let dashCount = 0
  while (value[index] === '-') {
    dashCount += 1
    index += 1
  }
  return dashCount >= 3
}

function looksLikeMarkdownTableRow(value: string): boolean {
  const clean = value.trim()
  if (!clean.startsWith('|') || !clean.endsWith('|')) return false
  let pipeCount = 0
  for (const char of clean) {
    if (char === '|') pipeCount += 1
  }
  return pipeCount >= 3
}

function endsWithSentencePunctuation(value: string): boolean {
  const clean = value.trimEnd()
  if (!clean) return false
  return ['.', '!', '?'].includes(clean[clean.length - 1])
}

function skipWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && isWhitespace(value[index])) index += 1
  return index
}

function skipInlineWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && isInlineWhitespace(value[index])) index += 1
  return index
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f'
}

function isInlineWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t'
}

function sourceLimitationLines(
  responses: Array<{ source: Connection; response?: KnowledgeQueryResult; error?: string }>,
): string[] {
  return responses.flatMap((item) => (item.response?.limitations || []).map(
    (limitation) => `- ${item.source.name}: ${limitation}`,
  )).slice(0, 8)
}

function step(input: Omit<AgentStep, 'timestamp'> & { timestamp?: string }): AgentStep {
  return { ...input, timestamp: input.timestamp || new Date().toISOString() }
}

function replaceStep(steps: AgentStep[], next: AgentStep): void {
  const index = steps.findIndex((item) => item.id === next.id)
  if (index >= 0) steps[index] = next
}

function toolNameFor(source: Connection): string {
  return `llmwiki_context__${source.id.replace(/[^a-zA-Z0-9]+/g, '_')}`
}

async function loadExternalA2aRuntimeEndpoint(
  agent: AgentConnection,
  signal?: AbortSignal,
): Promise<AgentRuntimeEndpoint> {
  const configuredUrl = agent.url?.trim()
  if (!configuredUrl) throw new Error(`${agent.name} runtime URL is required.`)
  if (!isAllowedAgentRuntimeUrl(configuredUrl)) {
    throw new Error(agentRuntimeUrlPolicyMessage)
  }
  const cardUrl = externalA2aAgentCardUrl(configuredUrl)
  const card = await fetchJson<Record<string, unknown>>(
    cardUrl,
    { signal, headers: agentRuntimeAuthHeaders(agent) },
    `${agent.name} agent card`,
    EXTERNAL_A2A_AGENT_CARD_TIMEOUT_MS,
  )
  const messageUrl = resolveExternalA2aMessageUrl(card, cardUrl)
  if (!isAllowedAgentRuntimeUrl(messageUrl)) {
    throw new Error(`A2A agent card message URL is not allowed. ${agentRuntimeUrlPolicyMessage}`)
  }
  return { card, cardUrl, messageUrl }
}

async function postExternalA2aRuntimeMessage(
  messageUrl: string,
  request: AgentRunRequest,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const payload = await fetchJson<Record<string, unknown>>(messageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...agentRuntimeAuthHeaders(request.agent),
    },
    body: JSON.stringify(body),
    signal,
  }, `${request.agent.name} message:send`, EXTERNAL_A2A_RUNTIME_MESSAGE_TIMEOUT_MS)
  assertNoA2aRuntimeError(payload)
  return payload
}

function agentRunArguments(request: AgentRunRequest, usableSources: Connection[]): Record<string, unknown> {
  const messages = agentRuntimeMessages(request)
  const conversation = runtimeConversationDescriptor(request, messages)
  const message = agentRuntimeA2aMessage(request)
  return {
    query: request.query,
    ...(message ? { message } : {}),
    messages,
    ...(request.threadId ? { threadId: request.threadId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.turnId ? { turnId: request.turnId } : {}),
    runtimeContext: runtimeContextDescriptor(request, usableSources, conversation),
    knowledgeSources: usableSources.map(knowledgeSourceDescriptor),
    tools: usableSources.map(runtimeToolDescriptor),
  }
}

function agentRuntimeRequestLog(
  transport: AgentRuntimeRequestLog['transport'],
  request: AgentRunRequest,
  usableSources: Connection[],
  body: Record<string, unknown>,
): AgentRuntimeRequestLog {
  const data = asRecord(body.data)
    || asRecord(asRecord(body.params)?.arguments)
    || {}
  const messages = Array.isArray(data.messages) ? data.messages : []
  return {
    transport,
    summary: {
      runtimeId: request.agent.id,
      runtimeName: request.agent.name,
      runtimeProtocol: request.agent.protocol,
      selectedKnowledgeSourceCount: usableSources.length,
      messagesIncluded: messages.length,
      hasA2aMessage: Boolean(asRecord(data.message)),
    },
    body,
  }
}

function agentRuntimeA2aMessage(request: AgentRunRequest): AgentRuntimeA2aTextMessage | null {
  const text = request.query.trim()
  const messageId = safeRuntimeIdentifier(request.messageId || request.turnId || '')
  if (!text || !messageId) return null
  const threadId = safeRuntimeIdentifier(request.threadId || '')
  const sessionId = safeRuntimeIdentifier(request.sessionId || '')
  const turnId = safeRuntimeIdentifier(request.turnId || '')
  const llmwiki = compactRuntimeRecord({
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    ...(threadId ? { threadId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
  })
  return compactRuntimeRecord({
    kind: 'message',
    messageId,
    ...(threadId ? { contextId: threadId } : {}),
    role: 'user',
    parts: [{ kind: 'text', text }],
    metadata: { llmwiki },
  }) as unknown as AgentRuntimeA2aTextMessage
}

function agentRuntimeMessages(request: AgentRunRequest): AgentRuntimeMessage[] {
  const messages = (request.messages || [])
    .map(normalizeAgentRuntimeMessage)
    .filter((message): message is AgentRuntimeMessage => Boolean(message))
  const query = request.query.trim()
  const latest = messages[messages.length - 1]
  if (query && (!latest || latest.role !== 'user' || latest.content !== query)) {
    messages.push({ role: 'user', content: query })
  }
  return messages.slice(-AGENT_RUNTIME_MESSAGE_LIMIT)
}

function normalizeAgentRuntimeMessage(message: AgentRuntimeMessage): AgentRuntimeMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const content = message.content.trim()
  return content ? { role: message.role, content } : null
}

function runtimeConversationDescriptor(
  request: AgentRunRequest,
  messages: AgentRuntimeMessage[],
): Record<string, unknown> {
  const latestRole = messages[messages.length - 1]?.role
  return {
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    ...(request.threadId ? { threadId: request.threadId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.turnId ? { turnId: request.turnId } : {}),
    historyLength: Math.max(0, messages.length - (latestRole ? 1 : 0)),
    messagesIncluded: messages.length,
    ...(latestRole ? { latestRole } : {}),
  }
}

function safeRuntimeIdentifier(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128)
}

function compactRuntimeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  )
}

function agentRuntimeAuthHeaders(agent: AgentConnection): Record<string, string> {
  const token = normalizeBearerToken(agent.bearerToken)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function normalizeBearerToken(value: string | undefined): string {
  const clean = value?.trim() || ''
  return clean.replace(/^Bearer\s+/i, '').trim()
}

let bridgeMcpRequestId = 0

async function callBridgeMcpMethod(
  agent: AgentConnection,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
  label: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const configuredUrl = agent.url?.trim()
  if (!configuredUrl) throw new Error(`${agent.name} bridge URL is required.`)
  if (!isAllowedAgentRuntimeUrl(configuredUrl)) {
    throw new Error(agentRuntimeUrlPolicyMessage)
  }
  const endpointUrl = bridgeMcpEndpointUrl(configuredUrl)
  const envelope = await fetchJson<Record<string, unknown>>(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...agentRuntimeAuthHeaders(agent),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++bridgeMcpRequestId,
      method,
      ...(params ? { params } : {}),
    }),
    signal,
  }, label, timeoutMs)
  const error = asRecord(envelope.error)
  if (error) throw errorWithDiagnostic(`${label} returned JSON-RPC error: ${jsonRpcErrorMessage(error)}`, error)
  if (!Object.hasOwn(envelope, 'result')) throw new Error(`${label} returned no JSON-RPC result`)
  const result = asRecord(envelope.result)
  if (!result) throw new Error(`${label} returned a non-object JSON-RPC result`)
  return result
}

function parseA2aAgentRunResult(
  request: AgentRunRequest,
  response: Record<string, unknown>,
): { structured: boolean; result: AgentRunResult } {
  const payload = extractA2aAgentResultPayload(response)
  if (!payload) return { structured: false, result: fallbackA2aAgentRunResult(request, response) }

  const answer = readString(payload, 'answer')
    || extractA2aRuntimeMessageText(response)
    || 'The runtime returned a structured llmwiki_agent_result artifact without an answer.'
  const graphPayload = asRecord(payload.graph)
  const runtimeSteps = normalizeRuntimeSteps(payload.steps, request.agent.id)
  appendRuntimeDiagnosticStep(runtimeSteps, payload, request.agent.id, 'Runtime diagnostic')
  if (!runtimeSteps.length) {
    runtimeSteps.push(step({
      id: 'runtime-result',
      label: 'Runtime result',
      status: 'done',
      runtimeId: request.agent.id,
      detail: 'Parsed the structured llmwiki_agent_result artifact.',
    }))
  }

  return {
    structured: true,
    result: {
      answer,
      citations: normalizeRuntimeCitations(payload.citations, selectedKnowledgeSources(request)),
      graph: graphPayload ? normalizeGraphPayload(graphPayload) : emptyGraph(),
      steps: runtimeSteps,
    },
  }
}

function parseMcpAgentRunResult(
  request: AgentRunRequest,
  response: Record<string, unknown>,
): { structured: boolean; result: AgentRunResult } {
  if (response.isError === true) {
    throw errorWithDiagnostic(
      `${request.agent.name} llmwiki_agent_run returned tool error: ${extractMcpToolText(response) || 'unknown tool error'}`,
      response,
    )
  }
  const payload = extractMcpAgentResultPayload(response)
  if (!payload) return { structured: false, result: fallbackMcpAgentRunResult(request, response) }

  const answer = readString(payload, 'answer')
    || extractMcpToolText(response)
    || 'The bridge returned a structured llmwiki_agent_run result without an answer.'
  const graphPayload = asRecord(payload.graph)
  const runtimeSteps = normalizeRuntimeSteps(payload.steps, request.agent.id)
  appendRuntimeDiagnosticStep(runtimeSteps, payload, request.agent.id, 'Bridge diagnostic')
  if (!runtimeSteps.length) {
    runtimeSteps.push(step({
      id: 'runtime-result',
      label: 'Bridge result',
      status: 'done',
      runtimeId: request.agent.id,
      detail: 'Parsed the structured llmwiki_agent_run result.',
    }))
  }

  return {
    structured: true,
    result: {
      answer,
      citations: normalizeRuntimeCitations(payload.citations, selectedKnowledgeSources(request)),
      graph: graphPayload ? normalizeGraphPayload(graphPayload) : emptyGraph(),
      steps: runtimeSteps,
    },
  }
}

function fallbackA2aAgentRunResult(
  request: AgentRunRequest,
  response: Record<string, unknown>,
): AgentRunResult {
  const messageText = extractA2aRuntimeMessageText(response)
  const detail = 'A2A response did not include a llmwiki_agent_result data artifact.'
  return {
    answer: messageText || `${request.agent.name} completed without a structured result artifact.`,
    citations: [],
    graph: emptyGraph(),
    steps: [
      step({
        id: 'runtime-unstructured-response',
        label: 'Unstructured runtime response',
        status: 'done',
        runtimeId: request.agent.id,
        detail: messageText ? `${detail} Used the runtime message text as the answer.` : detail,
      }),
    ],
  }
}

function fallbackMcpAgentRunResult(
  request: AgentRunRequest,
  response: Record<string, unknown>,
): AgentRunResult {
  const messageText = extractMcpToolText(response)
  const detail = 'MCP tool response did not include a structured llmwiki_agent_run result.'
  return {
    answer: messageText || `${request.agent.name} completed without a structured result.`,
    citations: [],
    graph: emptyGraph(),
    steps: [
      step({
        id: 'runtime-unstructured-response',
        label: 'Unstructured bridge response',
        status: 'done',
        runtimeId: request.agent.id,
        detail: messageText ? `${detail} Used the MCP text content as the answer.` : detail,
      }),
    ],
  }
}

function extractMcpAgentResultPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const directCandidates = [
    asRecord(payload.structuredContent ?? payload.structured_content),
    asRecord(payload.data),
    asRecord(payload.llmwiki_agent_result),
  ]
  for (const candidate of directCandidates) {
    const result = unwrapAgentResultPayload(candidate)
    if (result) return result
  }

  for (const part of readRecordArray(payload.content)) {
    const data = unwrapAgentResultPayload(asRecord(part.data))
    if (data) return data
    const parsedText = unwrapAgentResultPayload(parseRecord(readString(part, 'text')))
    if (parsedText) return parsedText
  }

  return unwrapAgentResultPayload(payload)
}

function unwrapAgentResultPayload(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null
  const nested = asRecord(payload.llmwiki_agent_result)
    || asRecord(payload.result)
    || asRecord(payload.data)
  if (nested && isAgentRunPayload(nested)) return nested
  return isAgentRunPayload(payload) ? payload : null
}

function isAgentRunPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.answer === 'string'
    || Array.isArray(payload.citations)
    || Boolean(asRecord(payload.graph))
    || Array.isArray(payload.steps)
}

function selectedKnowledgeSources(request: AgentRunRequest): Connection[] {
  return request.knowledgeSources.filter((source) => source.selected && source.status === 'ready')
}

function isCanceledRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /request was canceled|aborted|aborterror/i.test(message)
}

function assertRuntimeCardMatchesAgent(agent: AgentConnection, card: Record<string, unknown>): void {
  if (agent.protocol === 'custom-a2a' || agent.protocol === 'bridge-a2a') return

  const expectedNames: Record<string, string[]> = {
    hermes: ['hermes'],
    deepagents: ['deepagents', 'deep agents'],
    copilot: ['copilot'],
  }
  const expected = expectedNames[agent.protocol]
  if (!expected) return

  const identity = runtimeCardIdentity(card)
  if (expected.some((name) => identity.includes(normalizeRuntimeIdentity(name)))) return

  throw new Error(
    `${agent.name} runtime URL returned an A2A agent card that does not identify a ${agent.name} runtime. Use Custom A2A for generic A2A runtimes.`,
  )
}

function runtimeCardIdentity(card: Record<string, unknown>): string {
  return [
    readString(card, 'id'),
    readString(card, 'name'),
    readString(card, 'protocol'),
    readString(card, 'runtime'),
    readString(card, 'agentRuntime'),
    readString(asRecord(card.provider) || {}, 'organization'),
  ].map(normalizeRuntimeIdentity).filter(Boolean).join(' ')
}

function normalizeRuntimeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function knowledgeSourceDescriptor(source: Connection): Record<string, unknown> {
  return {
    id: source.id,
    title: source.name,
    name: source.name,
    description: source.description || '',
    protocol: source.protocol,
    status: source.status,
    url: source.url,
    capabilities: source.capabilities || [],
    ...(source.adapter ? { adapter: source.adapter } : {}),
    ...(source.implementation ? { implementation: source.implementation } : {}),
  }
}

function runtimeContextDescriptor(
  request: AgentRunRequest,
  sources: Connection[],
  conversation: Record<string, unknown>,
): Record<string, unknown> {
  return {
    application: 'llmwiki-chat',
    clientRole: 'ui-session-connection-trace-console',
    runtimeRole: 'external-agent-runtime',
    conversation,
    selectedRuntime: {
      id: request.agent.id,
      name: request.agent.name,
      protocol: request.agent.protocol,
    },
    selectedKnowledgeSourceCount: sources.length,
    selectedKnowledgeSources: sources.map(sourceContextDescriptor),
    toolSelection:
      'The runtime receives the query, source descriptors, and tool descriptions; llmwiki-chat does not classify intent by keyword or preselect tools beyond the user-selected ready sources.',
    clientResponsibilities: [
      'Maintain UI state, chat session flow, knowledge-source connections, and trace display.',
      'Pass only selected ready Knowledge Source descriptors and callable tool descriptions to the runtime.',
    ],
    runtimeResponsibilities: [
      'Decide which provided tools to call from the query, context, and tool descriptions.',
      'Perform reasoning, tool-use planning, answer composition, and citation selection.',
    ],
  }
}

function sourceContextDescriptor(source: Connection): Record<string, unknown> {
  return {
    id: source.id,
    title: source.name,
    description: source.description || '',
    protocol: source.protocol,
    status: source.status,
  }
}

function runtimeToolDescriptor(source: Connection): Record<string, unknown> {
  return {
    name: toolNameFor(source),
    description: [
      `Read-only LLMWiki context tool for ${source.name}.`,
      `The source is available through the ${source.protocol} Knowledge Source endpoint protocol.`,
      sourceToolMetadataSentence(source),
      'Use this tool when the query may need orientation, citation-grade evidence, limitations, or graph context from this source.',
    ].join(' '),
    knowledgeSourceId: source.id,
    protocol: source.protocol,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The user question or runtime-refined subquestion to ask this LLMWiki Knowledge Source.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 8,
          description: 'Maximum context items or citations to request from the Knowledge Source.',
        },
      },
      required: ['query'],
    },
    outputDescription:
      'Returns orientation, citations with source refs, limitations, and optional graph context in the LLMWiki context shape.',
  }
}

function sourceToolMetadataSentence(source: Connection): string {
  const description = source.description ? `, description "${source.description}"` : ''
  return `Selected source metadata: title "${source.name}", status "${source.status}"${description}.`
}

function externalA2aAgentCardUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '')
  return pathName(clean).endsWith('/.well-known/agent-card.json')
    ? clean
    : joinUrl(clean, '/.well-known/agent-card.json')
}

function resolveExternalA2aMessageUrl(card: Record<string, unknown>, cardUrl: string): string {
  const rawUrl = readString(card, 'url') || 'message:send'
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const serviceBase = cardUrl.replace(/\/\.well-known\/agent-card\.json(?:[?#].*)?$/, '/')
  const relativeUrl = rawUrl.startsWith('/') ? rawUrl : `./${rawUrl}`
  try {
    return new URL(relativeUrl, serviceBase).toString()
  } catch {
    return rawUrl.startsWith('/') ? rawUrl : joinUrl(serviceBase, rawUrl)
  }
}

function assertNoA2aRuntimeError(payload: Record<string, unknown>): void {
  const directError = readStringValue(payload.error)
  const error = asRecord(payload.error)
  if (directError || error) {
    throw errorWithDiagnostic(`a2a runtime returned error: ${error ? a2aRuntimeErrorMessage(error) : directError}`, error || payload)
  }

  const status = asRecord(payload.status)
  const state = readString(status || {}, 'state').toLowerCase()
  if (['failed', 'canceled', 'cancelled', 'rejected'].includes(state)) {
    throw errorWithDiagnostic(`a2a runtime failed: ${extractA2aRuntimeMessageText(payload) || state}`, payload)
  }
}

function a2aRuntimeErrorMessage(error: Record<string, unknown>): string {
  return readString(error, 'message') || readString(error, 'detail') || readString(error, 'code') || 'unknown error'
}

function extractA2aAgentResultPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const artifacts = [
    ...readRecordArray(payload.artifacts),
    ...readRecordArray(asRecord(payload.result)?.artifacts),
    ...readRecordArray(asRecord(payload.task)?.artifacts),
  ]
  for (const artifact of artifacts) {
    if (readString(artifact, 'name') !== 'llmwiki_agent_result') continue
    const directData = asRecord(artifact.data)
    if (directData) return directData
    const partsPayload = extractRecordFromParts(artifact.parts)
    if (partsPayload) return partsPayload
  }
  return null
}

function normalizeRuntimeCitations(value: unknown, sources: Connection[]): Citation[] {
  const fallbackConnectionId = sources.length === 1 ? sources[0].id : ''
  return readRecordArray(value).map((item, index): Citation => {
    const connectionId = readString(item, 'connectionId')
      || readString(item, 'connection_id')
      || readString(item, 'sourceId')
      || readString(item, 'source_id')
      || fallbackConnectionId
    const rawId = readString(item, 'id') || readString(item, 'page_id') || readString(item, 'path') || String(index)
    return {
      id: rawId.includes(':') ? rawId : `${connectionId || 'runtime'}:${rawId}`,
      title: readString(item, 'title') || 'Untitled',
      path: readString(item, 'path'),
      snippet: readString(item, 'snippet'),
      connectionId,
      sourceRefs: readStringArray(item.sourceRefs ?? item.source_refs),
    }
  })
}

function normalizeRuntimeSteps(value: unknown, runtimeId: string): AgentStep[] {
  return readRecordArray(value).map((item, index) => {
    const error = runtimeStepError(item)
    return step({
      id: readString(item, 'id') || `runtime-step-${index + 1}`,
      label: readString(item, 'label') || readString(item, 'name') || `Runtime step ${index + 1}`,
      status: normalizeStepStatus(readString(item, 'status')),
      detail: readString(item, 'detail') || readString(item, 'description') || readString(item, 'message'),
      timestamp: readString(item, 'timestamp') || undefined,
      runtimeId: readString(item, 'runtimeId') || readString(item, 'runtime_id') || runtimeId,
      toolName: readString(item, 'toolName') || readString(item, 'tool_name'),
      connectionId: readString(item, 'connectionId') || readString(item, 'connection_id'),
      citationIds: readStringArray(item.citationIds ?? item.citation_ids),
      latencyMs: readNumber(item, 'latencyMs') ?? readNumber(item, 'latency_ms'),
      requestId: readString(item, 'requestId') || readString(item, 'request_id'),
      traceId: readString(item, 'traceId') || readString(item, 'trace_id'),
      error,
      diagnostic: runtimeStepDiagnostic(item),
      parentId: readString(item, 'parentId') || readString(item, 'parent_id'),
    })
  })
}

function appendRuntimeDiagnosticStep(
  steps: AgentStep[],
  payload: Record<string, unknown>,
  runtimeId: string,
  label: string,
): void {
  const diagnostic = runtimePayloadDiagnostic(payload)
  if (!diagnostic) return
  steps.push(step({
    id: 'runtime-diagnostic',
    label,
    status: steps.some((item) => item.status === 'error') ? 'error' : 'done',
    runtimeId,
    detail: diagnostic.title || diagnostic.detail || 'Runtime returned diagnostic metadata.',
    diagnostic,
  }))
}

function runtimeStepError(item: Record<string, unknown>): string {
  const direct = readStringValue(item.error)
  if (direct) return direct
  const error = asRecord(item.error)
  if (!error) return ''
  return readString(error, 'message') || readString(error, 'detail') || readString(error, 'title') || readString(error, 'code')
}

function runtimeStepDiagnostic(item: Record<string, unknown>): Diagnostic | undefined {
  const diagnostic = normalizeDiagnosticEnvelope(item.diagnostic)
    || normalizeDiagnosticEnvelope(asRecord(item.error)?.diagnostic)
    || normalizeDiagnosticEnvelope({
      observations: item.observations ?? item.observation,
      remediation: item.remediation ?? item.remediations,
      requestId: item.requestId ?? item.request_id,
      traceId: item.traceId ?? item.trace_id,
      partial: item.partial,
    })
  return diagnostic
}

function runtimePayloadDiagnostic(payload: Record<string, unknown>): Diagnostic | undefined {
  return normalizeDiagnosticEnvelope(payload.diagnostic)
    || normalizeDiagnosticEnvelope({
      observations: payload.observations ?? payload.observation,
      remediation: payload.remediation ?? payload.remediations,
      requestId: payload.requestId ?? payload.request_id,
      traceId: payload.traceId ?? payload.trace_id,
      partial: payload.partial,
    })
}

function normalizeStepStatus(value: string): AgentStep['status'] {
  const clean = value.toLowerCase()
  if (clean === 'running' || clean === 'pending' || clean === 'done' || clean === 'error') return clean
  if (clean === 'completed' || clean === 'complete' || clean === 'success') return 'done'
  if (clean === 'failed' || clean === 'failure') return 'error'
  if (clean === 'in_progress' || clean === 'started') return 'running'
  return 'done'
}

function extractA2aRuntimeMessageText(payload: Record<string, unknown>): string {
  const direct = readStringValue(payload.message) || readStringValue(payload.text)
  if (direct) return direct

  const message = asRecord(payload.message)
  const status = asRecord(payload.status)
  const statusMessage = asRecord(status?.message)
  const result = asRecord(payload.result)
  return [
    extractTextFromParts(payload.parts),
    extractTextFromParts(message?.parts),
    extractTextFromParts(statusMessage?.parts),
    extractTextFromParts(result?.parts),
    readStringValue(statusMessage?.text),
    readStringValue(result?.message),
  ].find(Boolean) || ''
}

function extractMcpToolText(payload: Record<string, unknown>): string {
  return readRecordArray(payload.content)
    .map((part) => readStringValue(part.text) || readStringValue(part.data))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function extractRecordFromParts(value: unknown): Record<string, unknown> | null {
  for (const part of readRecordArray(value)) {
    const data = asRecord(part.data)
    if (data) return data
    const parsedText = parseRecord(readString(part, 'text'))
    if (parsedText) return parsedText
  }
  return null
}

function extractTextFromParts(value: unknown): string {
  return readRecordArray(value)
    .map((part) => readStringValue(part.text) || readStringValue(part.data))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function capabilitiesFromA2aCard(card: Record<string, unknown>): string[] {
  const capabilities = readStringArray(card.capabilities)
  const capabilityRecord = asRecord(card.capabilities)
  if (!capabilityRecord) return capabilities
  return uniqueStrings([...capabilities, ...Object.keys(capabilityRecord).filter((key) => Boolean(capabilityRecord[key]))])
}

function runtimeSettingsUrl(card: Record<string, unknown>, cardUrl: string): string {
  const direct = readString(card, 'settingsUrl') || readString(card, 'settings_url')
  const metadata = asRecord(card.metadata)
  const bridge = asRecord(card.bridge)
  const nested = metadata
    ? readString(metadata, 'settingsUrl') || readString(metadata, 'settings_url')
    : ''
  const bridgeNested = bridge
    ? readString(bridge, 'settingsUrl') || readString(bridge, 'settings_url')
    : ''
  return resolveHttpUrl(direct || nested || bridgeNested, cardUrl)
}

function mcpSettingsUrl(result: Record<string, unknown>, configuredUrl: string): string {
  const direct = readString(result, 'settingsUrl') || readString(result, 'settings_url')
  const serverInfo = asRecord(result.serverInfo ?? result.server_info)
  const nested = serverInfo
    ? readString(serverInfo, 'settingsUrl') || readString(serverInfo, 'settings_url')
    : ''
  return resolveHttpUrl(direct || nested, configuredUrl)
}

function normalizeBridgeKnowledgeSources(result: Record<string, unknown>): BridgeKnowledgeSource[] {
  const structured = asRecord(result.structuredContent ?? result.structured_content)
  const nested = asRecord(structured?.llmwiki_sources)
    || asRecord(structured?.knowledgeSources)
    || asRecord(structured?.knowledge_sources)
    || asRecord(result.llmwiki_sources)
    || asRecord(result.knowledgeSources)
    || asRecord(result.knowledge_sources)
    || result
  return readRecordArray(nested.sources)
    .map(normalizeBridgeKnowledgeSource)
    .filter((source): source is BridgeKnowledgeSource => Boolean(source))
}

function normalizeBridgeKnowledgeSource(source: Record<string, unknown>): BridgeKnowledgeSource | null {
  const protocol = readString(source, 'protocol')
  if (!isKnowledgeSourceProtocol(protocol)) return null
  const url = readString(source, 'url')
  if (!url.trim()) return null
  const id = readString(source, 'id') || readString(source, 'sourceId') || readString(source, 'source_id') || url
  const name = readString(source, 'name') || readString(source, 'title') || id
  return {
    id,
    name,
    description: readString(source, 'description'),
    protocol,
    url,
    selected: source.selected !== false,
    status: normalizeConnectionStatus(readString(source, 'status')),
    capabilities: readStringArray(source.capabilities),
    adapter: readString(source, 'adapter'),
    implementation: readString(source, 'implementation'),
  }
}

function isKnowledgeSourceProtocol(value: string): value is Protocol {
  return value === 'llmwiki-http' || value === 'mcp' || value === 'a2a'
}

function normalizeConnectionStatus(value: string): Connection['status'] {
  const clean = value.toLowerCase()
  if (clean === 'ready' || clean === 'checking' || clean === 'error') return clean
  return 'unknown'
}

function bridgeMcpEndpointUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '')
  return pathName(clean).endsWith('/mcp') ? clean : joinUrl(clean, '/mcp')
}

function resolveHttpUrl(rawUrl: string, baseUrl: string): string {
  if (!rawUrl.trim()) return ''
  try {
    const resolved = new URL(rawUrl, baseUrl).toString()
    return /^https?:\/\//i.test(resolved) ? resolved : ''
  } catch {
    return ''
  }
}

function jsonRpcErrorMessage(error: Record<string, unknown>): string {
  const code = readString(error, 'code')
  const message = readString(error, 'message') || 'unknown error'
  return code ? `${code} ${message}` : message
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function pathName(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '')
  } catch {
    return url.split(/[?#]/)[0].replace(/\/+$/, '')
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  return readStringValue(record[key])
}

function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseRecord(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
