import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import {
  agentClientFor,
  discoverAgentRuntime,
  discoverBridgeKnowledgeSources,
  starterAgentConnections,
  type AgentRuntimeRequestLog,
} from './agents'
import { clientFor, diagnosticFromError } from './serveClient'
import type {
  AgentConnection,
  AgentProtocol,
  AgentRuntimeMessage,
  AgentStep,
  ChatMessage,
  Citation,
  Connection,
  Diagnostic,
  KnowledgeGraph,
  KnowledgePage,
  Protocol,
} from './domain'
import { emptyGraph, mergeGraphs, namespaceGraph } from './graph'
import {
  clearLocalIoLogEntries,
  loadLocalIoLogEntries,
  loadLocalIoLoggingEnabled,
  localIoLogJsonl,
  localIoLogSchemaVersion,
  persistLocalIoLoggingEnabled,
  storeLocalIoLogEntries,
  type LocalIoLogEntry,
} from './localIoLog'
import { isReachablePublicHttpsSourceUrl } from './urlPolicy'
import './styles.css'

const pageNodeKinds = new Set(['hot', 'index', 'overview', 'topic'])
const graphMapEdgeLimit = 160
const pageNodeKindRank = new Map([
  ['hot', 0],
  ['index', 1],
  ['overview', 2],
  ['topic', 3],
])
const externalRuntimeSourceUrlAdvisoryMessage = 'Warning: selected ready Knowledge Source URLs include HTTP, private, or non-public hosts. External runtimes may not be able to reach them; public or strict deployments should use public HTTPS sources or enforce runtime/proxy allowlists.'
const suggestedPrompts = ['What is in this wiki?', 'Show current focus', 'What needs review?'] as const
const markdownBlockedMediaTags = new Set(['img', 'picture', 'source'])
const wikiLinkHrefPrefix = '#llmwiki-wikilink/'
const wikiLinkMarkdownPattern = String.raw`\[\[[^[\]\n]+?\]\]`
const wikiLinkNavigationLinePattern = new RegExp(
  String.raw`^\s*${wikiLinkMarkdownPattern}(?:\s*\|\s*${wikiLinkMarkdownPattern})+\s*$`,
)
const wikiLinkSeparatorPattern = /^[\s|]+$/
const markdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((tagName) => !markdownBlockedMediaTags.has(tagName)),
  attributes: Object.fromEntries(
    Object.entries(defaultSchema.attributes || {}).filter(([tagName]) => !markdownBlockedMediaTags.has(tagName)),
  ),
}

const starterConnections: Connection[] = [
  {
    id: 'local-demo',
    name: 'Local sample LLMWiki',
    protocol: 'llmwiki-http',
    url: defaultServeUrl(),
    selected: true,
    status: 'unknown',
    description: 'Local llmwiki-serve sample endpoint.',
  },
]

const quickstartServeCommand = [
  'uvx --from llmwiki-serve==0.2.0 llmwiki-serve serve /path/to/wiki --host 127.0.0.1 --port 8765',
]
const quickstartSampleServeCommand = [
  'git clone https://github.com/knowledge-bridge-labs/llmwiki-serve.git',
  'cd llmwiki-serve',
  'uv sync --extra dev',
  'uv run llmwiki-serve serve ./examples/sample-wiki --host 127.0.0.1 --port 8765',
]
const quickstartBridgeCommand = [
  'npm exec --package llmwiki-agent-bridge@0.1.0 -- llmwiki-agent-bridge',
]
const quickstartDocsUrl = 'https://knowledge-bridge-labs.github.io/llmwiki-docs/quickstart'
const runtimeAdapterDocsUrl = 'https://knowledge-bridge-labs.github.io/llmwiki-docs/runtime-adapters'
const agentBridgeDocsUrl = 'https://github.com/knowledge-bridge-labs/llmwiki-agent-bridge#readme'

const knowledgeSourceStorageKey = 'llmwiki-chat:knowledge-source-connections:v1'
const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'
const runtimeConversationMessageLimit = 12

type RuntimeStatus = AgentConnection['status'] | 'running'
type BridgeKnowledgeSourceSnapshot = Awaited<ReturnType<typeof discoverBridgeKnowledgeSources>>[number]

interface PersistedConnectionConfig {
  id: string
  name: string
  nameOverride?: boolean
  protocol: Protocol
  url: string
  selected: boolean
}

interface PersistedAgentConfig {
  id: string
  name: string
  protocol: AgentProtocol
  added?: boolean
  url: string
  selected: boolean
  settingsUrl?: string
}

interface AgentToolCallTrace {
  id: string
  sourceName: string
  sourceProtocol: Protocol
  status: AgentStep['status']
  detail: string
}

interface ScopeSourceSnapshot {
  id: string
  name: string
  protocol: Protocol
  url: string
  status: Connection['status']
}

interface AnswerScopeSnapshot {
  runtime: {
    name: string
    status: RuntimeStatus
    mode: string
    protocol: AgentConnection['protocol']
    deterministicMock: boolean
  }
  selectedSourceCount: number
  usedSourceCount: number
  sources: ScopeSourceSnapshot[]
}

interface TurnAuditMetadata {
  turnId: string
  runtimeMode: string
  runtimeProtocol: AgentConnection['protocol']
  selectedSourceCount: number
  readySourceCount: number
  usedSourceCount: number
  startedAt: string
  completedAt?: string
  durationMs?: number
  status: RuntimeStatus
  citationCount: number
  graphNodeCount: number
  graphEdgeCount: number
  stepCount: number
  toolCallCount: number
  requestId?: string
  traceId?: string
}

type UiChatMessage = ChatMessage & {
  agentName?: string
  agentRuntimeStatus?: RuntimeStatus
  answerScope?: AnswerScopeSnapshot
  turnAudit?: TurnAuditMetadata
  citationReferenceIds?: string[]
  evidenceGraph?: RuntimeGraphState
  toolCalls?: AgentToolCallTrace[]
}

interface SourceDiscoveryRequest {
  id: string
  url: string
  protocol: Protocol
  token: string
  controller: AbortController
}

interface RuntimeDiscoveryRequest {
  id: string
  url: string
  protocol: AgentConnection['protocol']
  bearerToken: string
  token: string
  controller: AbortController
}

interface RuntimeGraphState {
  messageId: string
  sourceKey: string
  selectedKey: string
  sources: ScopeSourceSnapshot[]
  graph: KnowledgeGraph
}

type GraphMode = 'answer' | 'selection'

interface CitationReturnTarget {
  messageId: string
  citationId: string
}

interface PageReadCacheEntry {
  status: 'loading' | 'ready' | 'error'
  markdown: string
  title: string
  path: string
  error: string
}

interface PageReadRequest {
  cacheKey: string
  pageId: string
  source: ScopeSourceSnapshot
}

function defaultServeUrl(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8765'
  const hostname = window.location.hostname
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return 'http://127.0.0.1:8765'
  return `${window.location.protocol}//${hostname}:8765`
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint32Array(2)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff)
    bytes[1] = Math.floor(Math.random() * 0xffffffff)
  }
  return `msg-${Date.now().toString(36)}-${[...bytes].map((item) => item.toString(36)).join('-')}`
}

function loadInitialConnections(): Connection[] {
  return mergePersistedConnections(readPersistedConnections())
}

function loadInitialAgents(): AgentConnection[] {
  return mergePersistedAgents(readPersistedAgents())
}

function mergePersistedConnections(persistedConnections: PersistedConnectionConfig[]): Connection[] {
  const persistedById = new Map(persistedConnections.map((connection) => [connection.id, connection]))
  const starterIds = new Set(starterConnections.map((connection) => connection.id))
  const mergedStarters = starterConnections.map((starter) => {
    const persisted = persistedById.get(starter.id)
    if (!persisted) return { ...starter, status: 'unknown' as const }
    return {
      ...starter,
      id: persisted.id,
      name: persisted.nameOverride ? persisted.name : starter.name,
      nameOverride: Boolean(persisted.nameOverride),
      protocol: persisted.protocol,
      url: persisted.url,
      selected: persisted.selected,
      status: 'unknown' as const,
    }
  })
  const userConnections = persistedConnections
    .filter((connection) => !starterIds.has(connection.id))
    .map((connection) => ({
      ...connection,
      nameOverride: connection.nameOverride ?? true,
      status: 'unknown' as const,
    }))

  return [...mergedStarters, ...userConnections]
}

function readPersistedConnections(): PersistedConnectionConfig[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(knowledgeSourceStorageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.connections)
        ? parsed.connections
        : []

    const validConnections = candidates
      .map(toPersistedConnectionConfig)
      .filter((connection): connection is PersistedConnectionConfig => Boolean(connection))
    return [...new Map(validConnections.map((connection) => [connection.id, connection])).values()]
  } catch {
    return []
  }
}

function persistConnections(connections: Connection[]): void {
  if (typeof window === 'undefined') return

  try {
    const persistedConnections = connections.filter((connection) => !isBridgeManagedConnection(connection))
    const payload = {
      version: 1,
      connections: persistedConnections.map(toConnectionStorageConfig),
    }
    window.localStorage.setItem(knowledgeSourceStorageKey, JSON.stringify(payload))
  } catch {
    // localStorage can be disabled or quota-limited; connection state should remain usable in memory.
  }
}

function mergePersistedAgents(persistedAgents: PersistedAgentConfig[]): AgentConnection[] {
  const persistedById = new Map(persistedAgents.map((agent) => [agent.id, agent]))
  const selectedAgentId = selectedPersistedAgentId(persistedAgents)
    || starterAgentConnections.find((agent) => agent.selected)?.id
    || starterAgentConnections[0]?.id

  return starterAgentConnections.map((starter) => {
    const persisted = persistedAgentForStarter(starter, persistedById)
    if (!persisted || persisted.protocol !== starter.protocol) {
      return { ...starter, selected: starter.id === selectedAgentId }
    }

    return {
      ...starter,
      name: persisted.name,
      added: Boolean(persisted.added),
      url: persisted.url,
      settingsUrl: persisted.settingsUrl,
      selected: starter.id === selectedAgentId,
      status: agentStatusFromPersistedConfig(starter, persisted),
    }
  })
}

function persistedAgentForStarter(
  starter: AgentConnection,
  persistedById: Map<string, PersistedAgentConfig>,
): PersistedAgentConfig | undefined {
  return persistedById.get(starter.id)
}

function selectedPersistedAgentId(persistedAgents: PersistedAgentConfig[]): string {
  const selected = persistedAgents.find((agent) => agent.selected)
  if (!selected) return ''
  const selectedStarter = starterAgentConnections.find((starter) =>
    starter.id === selected.id && starter.protocol === selected.protocol
  )
  return selectedStarter?.id || ''
}

function agentStatusFromPersistedConfig(
  starter: AgentConnection,
  persisted: PersistedAgentConfig,
): AgentConnection['status'] {
  if (starter.protocol === 'mock-agent') return starter.status
  if (persisted.url.trim()) return 'unknown'
  return starter.status
}

function readPersistedAgents(): PersistedAgentConfig[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(agentRuntimeStorageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.agents)
        ? parsed.agents
        : []

    const validAgents = candidates
      .map(toPersistedAgentConfig)
      .filter((agent): agent is PersistedAgentConfig => Boolean(agent))
    return [...new Map(validAgents.map((agent) => [agent.id, agent])).values()]
  } catch {
    return []
  }
}

function persistAgents(agents: AgentConnection[]): void {
  if (typeof window === 'undefined') return

  try {
    const payload = {
      version: 1,
      agents: agents.map(toAgentStorageConfig),
    }
    window.localStorage.setItem(agentRuntimeStorageKey, JSON.stringify(payload))
  } catch {
    // Runtime setup remains usable for the current tab when localStorage is unavailable.
  }
}

function toConnectionStorageConfig(connection: Connection): PersistedConnectionConfig {
  const config: PersistedConnectionConfig = {
    id: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    url: connection.url,
    selected: connection.selected,
  }
  if (connection.nameOverride) config.nameOverride = true
  return config
}

function toAgentStorageConfig(agent: AgentConnection): PersistedAgentConfig {
  const config: PersistedAgentConfig = {
    id: agent.id,
    name: agent.name,
    protocol: agent.protocol,
    url: agent.url || '',
    selected: agent.selected,
    settingsUrl: agent.settingsUrl || '',
  }
  if (agent.added) config.added = true
  return config
}

function toPersistedConnectionConfig(value: unknown): PersistedConnectionConfig | null {
  if (!isRecord(value)) return null
  const protocol = typeof value.protocol === 'string' && isConnectionProtocol(value.protocol) ? value.protocol : null
  if (
    typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.name !== 'string'
    || !value.name.trim()
    || typeof value.url !== 'string'
    || !value.url.trim()
    || typeof value.selected !== 'boolean'
    || !protocol
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    nameOverride: typeof value.nameOverride === 'boolean' ? value.nameOverride : undefined,
    protocol,
    url: value.url,
    selected: value.selected,
  }
}

function toPersistedAgentConfig(value: unknown): PersistedAgentConfig | null {
  if (!isRecord(value)) return null
  const protocol = typeof value.protocol === 'string' && isAgentProtocol(value.protocol) ? value.protocol : null
  if (
    typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.name !== 'string'
    || !value.name.trim()
    || typeof value.url !== 'string'
    || typeof value.selected !== 'boolean'
    || !protocol
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    protocol,
    added: typeof value.added === 'boolean' ? value.added : undefined,
    url: value.url,
    selected: value.selected,
    settingsUrl: typeof value.settingsUrl === 'string' ? value.settingsUrl : '',
  }
}

function isConnectionProtocol(value: string): value is Protocol {
  return value === 'llmwiki-http' || value === 'mcp' || value === 'a2a'
}

function isAgentProtocol(value: string): value is AgentProtocol {
  return value === 'bridge-a2a'
    || value === 'bridge-mcp'
    || value === 'mock-agent'
    || value === 'hermes'
    || value === 'deepagents'
    || value === 'copilot'
    || value === 'custom-a2a'
}

function isBridgeAgent(agent: AgentConnection): boolean {
  return agent.protocol === 'bridge-a2a' || agent.protocol === 'bridge-mcp'
}

function isPrimaryBridgeAgent(agent: AgentConnection): boolean {
  return isBridgeAgent(agent) && Boolean(agent.bridge?.local)
}

function isAddedAgentRuntime(agent: AgentConnection): boolean {
  const starter = starterAgentConnections.find((item) => item.id === agent.id)
  return Boolean(
    agent.added
    || agent.selected
    || agent.url?.trim()
    || agent.bearerToken?.trim()
    || agent.settingsUrl?.trim()
    || agent.error
    || agent.capabilities?.length
    || agent.status === 'checking'
    || agent.status === 'error'
    || (starter && agent.status !== starter.status)
    || (!starter && agent.status !== 'unavailable')
  )
}

function isStarterConnection(connection: Connection): boolean {
  return starterConnections.some((starter) => starter.id === connection.id)
}

function isBridgeManagedConnection(connection: Connection): boolean {
  return connection.sourceOrigin === 'bridge' || Boolean(connection.bridgeSource)
}

function resetOrRemoveConnection(connections: Connection[], connectionId: string): Connection[] {
  const connection = connections.find((item) => item.id === connectionId)
  if (!connection) return connections
  if (isBridgeManagedConnection(connection)) return connections.filter((item) => item.id !== connectionId)
  const starter = starterConnections.find((item) => item.id === connection.id)
  if (!starter) return connections.filter((item) => item.id !== connectionId)
  return connections.map((item) => (
    item.id === connectionId
      ? { ...starter, selected: item.selected, status: 'unknown' }
      : item
  ))
}

function connectionUrlUpdate(url: string): Partial<Connection> {
  return {
    url,
    status: 'unknown',
    adapter: '',
    implementation: '',
    pageCount: undefined,
    approvedPageCount: undefined,
    capabilities: [],
    graph: undefined,
    error: '',
    diagnostic: undefined,
  }
}

function connectionWithUrl(connection: Connection, url: string): Connection {
  return { ...connection, ...connectionUrlUpdate(url) }
}

function shouldAutoDiscoverConnection(connection: Connection): boolean {
  return Boolean(connection.url.trim())
    && connection.status !== 'checking'
    && connection.status !== 'ready'
}

function agentUrlUpdate(url: string): Partial<AgentConnection> {
  return {
    url,
    status: url.trim() ? 'unknown' : 'unavailable',
    error: '',
    diagnostic: undefined,
    capabilities: [],
    latencyMs: undefined,
    settingsUrl: '',
  }
}

function agentBearerTokenUpdate(agent: AgentConnection, bearerToken: string): Partial<AgentConnection> {
  return {
    bearerToken,
    status: agent.url?.trim() ? 'unknown' : 'unavailable',
    error: '',
    diagnostic: undefined,
    capabilities: [],
    latencyMs: undefined,
    settingsUrl: '',
  }
}

function shouldAutoDiscoverAgent(agent: AgentConnection): boolean {
  return agent.protocol !== 'mock-agent'
    && Boolean(agent.url?.trim())
    && agent.status !== 'checking'
    && agent.status !== 'ready'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default function App() {
  const [agents, setAgents] = useState(loadInitialAgents)
  const [connections, setConnections] = useState(loadInitialConnections)
  const [messages, setMessages] = useState<UiChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)
  const [selectedCitationReturnTarget, setSelectedCitationReturnTarget] = useState<CitationReturnTarget | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [runGraph, setRunGraph] = useState<RuntimeGraphState | null>(null)
  const [graphMode, setGraphMode] = useState<GraphMode>('selection')
  const [quickstartEnabled, setQuickstartEnabled] = useState(false)
  const [pageReadCache, setPageReadCache] = useState<Record<string, PageReadCacheEntry>>({})
  const [localIoLoggingEnabled, setLocalIoLoggingEnabled] = useState(loadLocalIoLoggingEnabled)
  const [localIoLogEntries, setLocalIoLogEntries] = useState(() => (
    loadLocalIoLoggingEnabled() ? loadLocalIoLogEntries() : []
  ))
  const threadRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const sourceSectionRef = useRef<HTMLElement>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const pendingAssistantScrollId = useRef<string | null>(null)
  const activeRunController = useRef<AbortController | null>(null)
  const sourceDiscoveryRequests = useRef(new Map<string, SourceDiscoveryRequest>())
  const runtimeDiscoveryRequests = useRef(new Map<string, RuntimeDiscoveryRequest>())
  const pageReadRequests = useRef(new Set<string>())
  const sessionIdRef = useRef(createId())
  const threadIdRef = useRef(createId())
  const localIoLoggingEnabledRef = useRef(localIoLoggingEnabled)
  const initialConnections = useRef<Connection[] | null>(null)
  const initialAgents = useRef<AgentConnection[] | null>(null)
  if (initialConnections.current === null) initialConnections.current = connections
  if (initialAgents.current === null) initialAgents.current = agents

  const abortActiveRun = useCallback(() => {
    activeRunController.current?.abort()
  }, [])

  const commitLocalIoLogEntries = useCallback((updater: (entries: LocalIoLogEntry[]) => LocalIoLogEntry[]) => {
    if (!localIoLoggingEnabledRef.current) return
    setLocalIoLogEntries((current) => storeLocalIoLogEntries(updater(current)))
  }, [])

  const setLocalIoLogCollection = useCallback((enabled: boolean) => {
    localIoLoggingEnabledRef.current = enabled
    persistLocalIoLoggingEnabled(enabled)
    setLocalIoLoggingEnabled(enabled)
    if (!enabled) {
      clearLocalIoLogEntries()
      setLocalIoLogEntries([])
    }
  }, [])

  const clearLocalIoLog = useCallback(() => {
    clearLocalIoLogEntries()
    setLocalIoLogEntries([])
  }, [])

  const abortActiveRunForScopeChange = useCallback((nextAgents: AgentConnection[], nextConnections: Connection[]) => {
    if (!activeRunController.current) return
    if (runScopeKey(agents, connections) !== runScopeKey(nextAgents, nextConnections)) {
      abortActiveRun()
    }
  }, [abortActiveRun, agents, connections])

  const updateAgents = useCallback((nextAgents: AgentConnection[]) => {
    const nextSelectedAgent = selectedAgentFromList(nextAgents)
    const nextConnections = connectionsForSelectedAgent(connections, nextSelectedAgent)
    abortActiveRunForScopeChange(nextAgents, nextConnections)
    setAgents((current) => {
      invalidateChangedRuntimeRequests(current, nextAgents, runtimeDiscoveryRequests.current)
      return nextAgents
    })
    setConnections((current) => connectionsForSelectedAgent(current, nextSelectedAgent))
  }, [abortActiveRunForScopeChange, connections])

  const updateConnections = useCallback((nextConnections: Connection[]) => {
    abortActiveRunForScopeChange(agents, nextConnections)
    setConnections((current) => {
      invalidateChangedSourceRequests(current, nextConnections, sourceDiscoveryRequests.current)
      return nextConnections
    })
  }, [abortActiveRunForScopeChange, agents])

  const selectedAgent = useMemo(() => agents.find((item) => item.selected) || agents[0], [agents])
  const selectedConnections = useMemo(() => connections.filter((item) => item.selected), [connections])
  const readyConnections = useMemo(() => selectedConnections.filter((item) => item.status === 'ready'), [selectedConnections])
  const selectedReadySourceGraph = useMemo(() => graphFromSelectedReadySources(connections), [connections])
  const selectedReadySourceKey = useMemo(() => sourceGraphKey(readyConnections), [readyConnections])
  const selectedSourceSelectionKey = useMemo(() => sourceSelectionKey(selectedConnections), [selectedConnections])
  const selectedReadySourceSnapshots = useMemo(() => readyConnections.map(sourceScopeSnapshot), [readyConnections])
  const activeGraphMode: GraphMode = runGraph && graphMode === 'answer' ? 'answer' : 'selection'
  const activeGraph = useMemo(
    () => (activeGraphMode === 'answer' && runGraph ? runGraph.graph : selectedReadySourceGraph),
    [activeGraphMode, runGraph, selectedReadySourceGraph],
  )
  const activeGraphSources = activeGraphMode === 'answer' ? runGraph?.sources || [] : selectedReadySourceSnapshots
  const selectedGraphNode = activeGraph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedGraphNodeSource = selectedGraphNode ? sourceForGraphNode(selectedGraphNode.id, activeGraphSources) : null
  const selectedPageReadRequest = selectedGraphNode && selectedGraphNodeSource && isPageNode(selectedGraphNode)
    ? pageReadRequestForNode(selectedGraphNode, selectedGraphNodeSource)
    : null
  const selectedPageRead = selectedPageReadRequest && selectedGraphNode
    ? pageReadCache[selectedPageReadRequest.cacheKey] || loadingPageReadEntry(selectedGraphNode)
    : null
  const answerGraphSelectionDiffers = Boolean(
    activeGraphMode === 'answer' && runGraph && runGraph.selectedKey !== selectedSourceSelectionKey,
  )
  const runtimeStatus: RuntimeStatus = busy ? 'running' : selectedAgent.status
  const currentAskBlockReason = askBlockReasonFor(query, busy, selectedAgent, selectedConnections, readyConnections)
  const externalRuntimeSourceUrlAdvisory = externalRuntimeSourceUrlAdvisoryFor(selectedAgent, readyConnections)
  const suggestedPromptActions = useMemo(() => suggestedPrompts.map((prompt) => ({
    prompt,
    blockReason: askBlockReasonFor(prompt, busy, selectedAgent, selectedConnections, readyConnections),
  })), [busy, readyConnections, selectedAgent, selectedConnections])
  const suggestedPromptStatusMessage = suggestedPromptActions.find((prompt) => prompt.blockReason)?.blockReason
    || externalRuntimeSourceUrlAdvisory
  const canAsk = !currentAskBlockReason
  const selectedSourcesTesting = selectedConnections.some((connection) => connection.status === 'checking')
  const askStatusMessage = currentAskBlockReason || externalRuntimeSourceUrlAdvisory || readyAskStatusMessage(selectedConnections)
  const askStatusTone = currentAskBlockReason ? (busy ? 'checking' : 'blocked') : externalRuntimeSourceUrlAdvisory ? 'warning' : 'ready'

  useEffect(() => {
    if (!selectedPageReadRequest || pageReadCache[selectedPageReadRequest.cacheKey]) return
    if (pageReadRequests.current.has(selectedPageReadRequest.cacheKey)) return
    pageReadRequests.current.add(selectedPageReadRequest.cacheKey)

    const controller = new AbortController()
    void readPageForSource(selectedPageReadRequest.source, selectedPageReadRequest.pageId, controller.signal)
      .then((page) => {
        setPageReadCache((current) => ({
          ...current,
          [selectedPageReadRequest.cacheKey]: {
            status: 'ready',
            markdown: page.text,
            title: page.title,
            path: page.path,
            error: '',
          },
        }))
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setPageReadCache((current) => ({
          ...current,
          [selectedPageReadRequest.cacheKey]: {
            status: 'error',
            markdown: '',
            title: selectedGraphNode?.label || selectedPageReadRequest.pageId,
            path: selectedGraphNode?.path || selectedPageReadRequest.pageId,
            error: error instanceof Error ? error.message : String(error),
          },
        }))
      })
      .finally(() => {
        pageReadRequests.current.delete(selectedPageReadRequest.cacheKey)
      })
  }, [pageReadCache, selectedGraphNode, selectedPageReadRequest])

  const discover = useCallback(async (connection: Connection) => {
    const request = createSourceDiscoveryRequest(connection)
    sourceDiscoveryRequests.current.get(connection.id)?.controller.abort()
    sourceDiscoveryRequests.current.set(connection.id, request)
    setConnections((items) =>
      items.map((item) =>
        canApplySourceDiscovery(item, request, sourceDiscoveryRequests.current)
          ? { ...item, status: 'checking', error: '', diagnostic: undefined }
          : item,
      ),
    )
    try {
      const next = await clientFor(connection).discover(connection, request.controller.signal)
      setConnections((items) =>
        items.map((item) =>
          canApplySourceDiscovery(item, request, sourceDiscoveryRequests.current)
            ? mergeDiscoveredConnection(item, next)
            : item,
        ),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const diagnostic = diagnosticFromError(error)
      setConnections((items) =>
        items.map((item) =>
          canApplySourceDiscovery(item, request, sourceDiscoveryRequests.current)
            ? { ...item, status: 'error', error: message, diagnostic, latencyMs: undefined }
            : item,
        ),
      )
    }
  }, [])

  const discoverRuntime = useCallback(async (agent: AgentConnection) => {
    if (agent.protocol === 'mock-agent') return
    const request = createRuntimeDiscoveryRequest(agent)
    runtimeDiscoveryRequests.current.get(agent.id)?.controller.abort()
    runtimeDiscoveryRequests.current.set(agent.id, request)
    setAgents((items) =>
      items.map((item) =>
        canApplyRuntimeDiscovery(item, request, runtimeDiscoveryRequests.current)
          ? { ...item, status: 'checking', error: '', diagnostic: undefined }
          : item,
      ),
    )
    try {
      const next = await discoverAgentRuntime(agent, request.controller.signal)
      setAgents((items) =>
        items.map((item) =>
          canApplyRuntimeDiscovery(item, request, runtimeDiscoveryRequests.current)
            ? mergeDiscoveredAgent(item, next)
            : item,
        ),
      )
      if (isBridgeAgent(next)) {
        try {
          const bridgeSources = await discoverBridgeKnowledgeSources(next, request.controller.signal)
          setConnections((items) => (
            canApplyRuntimeDiscovery(next, request, runtimeDiscoveryRequests.current)
              ? mergeBridgeManagedSources(items, next, bridgeSources)
              : items
          ))
        } catch {
          if (request.controller.signal.aborted) return
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const diagnostic = diagnosticFromError(error)
      setAgents((items) =>
        items.map((item) =>
          canApplyRuntimeDiscovery(item, request, runtimeDiscoveryRequests.current)
            ? {
                ...item,
                status: 'error',
                error: message,
                diagnostic,
                latencyMs: undefined,
                capabilities: [],
              }
            : item,
        ),
      )
    }
  }, [])

  useEffect(() => {
    if (!quickstartEnabled) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('quickstart-panel')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [quickstartEnabled])

  useEffect(() => {
    const initialSelectedConnections = (initialConnections.current || [])
      .filter((connection) => connection.selected && shouldAutoDiscoverConnection(connection))
    initialSelectedConnections.forEach((connection) => {
      void discover(connection)
    })
  }, [discover])

  useEffect(() => {
    const initialSelectedAgent = (initialAgents.current || []).find((agent) => agent.selected)
    if (initialSelectedAgent && shouldAutoDiscoverAgent(initialSelectedAgent)) {
      void discoverRuntime(initialSelectedAgent)
    }
  }, [discoverRuntime])

  useEffect(() => {
    persistConnections(connections)
  }, [connections])

  useEffect(() => {
    persistAgents(agents)
  }, [agents])

  useEffect(() => () => {
    abortActiveRun()
  }, [abortActiveRun])

  useEffect(() => {
    const thread = threadRef.current
    const assistantId = pendingAssistantScrollId.current
    if (!thread || !assistantId) return
    const assistantMessage = messages.find((message) => message.id === assistantId)
    if (!assistantMessage || assistantMessage.agentRuntimeStatus === 'running') return
    const message = thread.querySelector<HTMLElement>(`[data-message-id="${assistantId}"]`)
    if (!message) return
    pendingAssistantScrollId.current = null

    const overflowY = window.getComputedStyle(thread).overflowY
    const stackedLayout = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 980px)').matches
    if (stackedLayout || overflowY === 'visible') {
      message.scrollIntoView({ block: 'start', behavior: 'auto' })
      return
    }

    const threadBox = thread.getBoundingClientRect()
    const messageBox = message.getBoundingClientRect()
    const targetTop = thread.scrollTop + messageBox.top - threadBox.top - 8
    if (typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top: Math.max(targetTop, 0), behavior: 'auto' })
    } else {
      thread.scrollTop = Math.max(targetTop, 0)
    }
  }, [messages])

  const focusKnowledgeSources = useCallback(() => {
    const section = sourceSectionRef.current
    if (!section) return
    const toggle = section.querySelector<HTMLButtonElement>('.sidebar-section-toggle')
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
    if (typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    section.focus({ preventScroll: true })
  }, [])

  const focusQuestionComposer = useCallback(() => {
    const composer = composerRef.current
    if (composer && typeof composer.scrollIntoView === 'function') {
      composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    questionRef.current?.focus({ preventScroll: true })
  }, [])

  const revealDetailsPanel = useCallback(() => {
    const reveal = () => {
      const details = document.getElementById('details-panel')
      if (!details) return
      const stackedLayout = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 980px)').matches
      if (stackedLayout && typeof details.scrollIntoView === 'function') {
        details.scrollIntoView({ block: 'start', behavior: 'auto' })
      } else {
        const inspector = inspectorRef.current || details.closest<HTMLElement>('.inspector')
        const overflowY = inspector ? window.getComputedStyle(inspector).overflowY : 'visible'
        if (inspector && overflowY !== 'visible') {
          const inspectorBox = inspector.getBoundingClientRect()
          const detailsBox = details.getBoundingClientRect()
          const targetTop = inspector.scrollTop + detailsBox.top - inspectorBox.top - 8
          if (typeof inspector.scrollTo === 'function') {
            inspector.scrollTo({ top: Math.max(targetTop, 0), behavior: 'auto' })
          } else {
            inspector.scrollTop = Math.max(targetTop, 0)
          }
        }
      }
      details.focus({ preventScroll: true })
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(reveal)
      return
    }
    window.setTimeout(reveal, 0)
  }, [])

  const revealAnswerCitation = useCallback((target: CitationReturnTarget) => {
    const reveal = () => {
      const thread = threadRef.current
      const message = thread?.querySelector<HTMLElement>(`[data-message-id="${target.messageId}"]`)
      if (!thread || !message) return
      const citationButtons = [...message.querySelectorAll<HTMLButtonElement>('[data-citation-id]')]
        .filter((button) => button.dataset.citationId === target.citationId)
      const citationButton = citationButtons.find((button) => button.closest('.citations')) || citationButtons[0]
      const targetElement = citationButton || message
      const overflowY = window.getComputedStyle(thread).overflowY
      const stackedLayout = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 980px)').matches

      if (stackedLayout || overflowY === 'visible') {
        targetElement.scrollIntoView({ block: citationButton ? 'center' : 'start', behavior: 'auto' })
      } else {
        const threadBox = thread.getBoundingClientRect()
        const targetBox = targetElement.getBoundingClientRect()
        const targetTop = thread.scrollTop + targetBox.top - threadBox.top - 24
        if (typeof thread.scrollTo === 'function') {
          thread.scrollTo({ top: Math.max(targetTop, 0), behavior: 'auto' })
        } else {
          thread.scrollTop = Math.max(targetTop, 0)
        }
      }

      targetElement.focus({ preventScroll: true })
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(reveal)
      return
    }
    window.setTimeout(reveal, 0)
  }, [])

  const selectCitationEvidence = useCallback((message: UiChatMessage, citation: Citation) => {
    const evidenceGraph = message.evidenceGraph || runGraph
    const graph = evidenceGraph?.graph || activeGraph
    const selectedCitationNodeId = graphNodeIdForCitation(citation, graph)
    if (evidenceGraph) setRunGraph(evidenceGraph)
    setGraphMode('answer')
    setSelectedCitation(citation)
    setSelectedCitationReturnTarget({ messageId: message.id, citationId: citation.id })
    setSelectedNodeId(selectedCitationNodeId)
    revealDetailsPanel()
  }, [activeGraph, revealDetailsPanel, runGraph])

  const selectGraphNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setSelectedCitation(null)
    setSelectedCitationReturnTarget(null)
    revealDetailsPanel()
  }, [revealDetailsPanel])

  const showSelectionGraph = useCallback(() => {
    setGraphMode('selection')
    setSelectedCitation(null)
    setSelectedCitationReturnTarget(null)
    setSelectedNodeId('')
  }, [])

  const showAnswerGraph = useCallback(() => {
    if (runGraph) setGraphMode('answer')
  }, [runGraph])

  const resetChat = useCallback(() => {
    abortActiveRun()
    threadIdRef.current = createId()
    pendingAssistantScrollId.current = null
    setMessages([])
    setQuery('')
    setBusy(false)
    setRunGraph(null)
    setGraphMode('selection')
    setSelectedCitation(null)
    setSelectedCitationReturnTarget(null)
    setSelectedNodeId('')
    focusQuestionComposer()
  }, [abortActiveRun, focusQuestionComposer])

  const testSampleSourceQuickstart = useCallback(() => {
    const sampleConnection: Connection = {
      ...starterConnections[0],
      selected: true,
      status: 'unknown',
      error: '',
      diagnostic: undefined,
      graph: undefined,
      latencyMs: undefined,
    }
    const nextConnections = [
      sampleConnection,
      ...connections
        .filter((connection) => connection.id !== sampleConnection.id)
        .map((connection) => ({ ...connection, selected: false })),
    ]
    updateConnections(nextConnections)
    showSelectionGraph()
    void discover(sampleConnection)
  }, [connections, discover, showSelectionGraph, updateConnections])

  const testLocalBridgeQuickstart = useCallback(() => {
    const nextAgents = agents.map((agent) => (
      agent.id === 'bridge-a2a'
        ? { ...agent, selected: true, status: agent.url?.trim() ? 'unknown' as const : 'unavailable' as const }
        : { ...agent, selected: false }
    ))
    updateAgents(nextAgents)
    const localBridge = nextAgents.find((agent) => agent.id === 'bridge-a2a')
    if (localBridge) void discoverRuntime(localBridge)
  }, [agents, discoverRuntime, updateAgents])

  const useLocalDevelopmentRuntimeQuickstart = useCallback(() => {
    updateAgents(agents.map((agent) => ({
      ...agent,
      selected: agent.protocol === 'mock-agent',
    })))
  }, [agents, updateAgents])

  async function ask() {
    await askWith(query)
  }

  async function askWith(text: string) {
    const clean = text.trim()
    const agent = selectedAgent
    const knowledgeSources = readyConnections
    const sourceGraph = selectedReadySourceGraph
    const sourceKey = selectedReadySourceKey
    const selectedKey = selectedSourceSelectionKey
    const sourceSnapshots = knowledgeSources.map(sourceScopeSnapshot)
    const blockReason = askBlockReasonFor(clean, busy, agent, selectedConnections, knowledgeSources)
    if (blockReason) {
      return
    }

    activeRunController.current?.abort()
    const runController = new AbortController()
    activeRunController.current = runController
    const userMessageId = createId()
    const assistantId = createId()
    const turnId = createId()
    const threadId = threadIdRef.current
    const sessionId = sessionIdRef.current
    const runtimeMessages = runtimeConversationMessages(messages, clean)
    const captureLocalIoLog = localIoLoggingEnabledRef.current
    const localIoLogEntryId = createId()
    const startedAt = new Date().toISOString()
    const initialEvidenceGraph: RuntimeGraphState = {
      messageId: assistantId,
      sourceKey,
      selectedKey,
      sources: sourceSnapshots,
      graph: sourceGraph,
    }
    pendingAssistantScrollId.current = assistantId
    setQuery('')
    setBusy(true)
    setSelectedCitation(null)
    setSelectedCitationReturnTarget(null)
    setSelectedNodeId('')
    setGraphMode('answer')
    setRunGraph(initialEvidenceGraph)
    setMessages((items) => [
      ...items,
      { id: userMessageId, role: 'user', text: clean, citations: [] },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        citations: [],
        steps: [],
        agentName: agent.name,
        agentRuntimeStatus: 'running',
        answerScope: createAnswerScopeSnapshot(agent, selectedConnections, knowledgeSources, 'running'),
        turnAudit: createTurnAuditMetadata(turnId, agent, selectedConnections, knowledgeSources, sourceGraph, startedAt),
        evidenceGraph: initialEvidenceGraph,
        toolCalls: [],
      },
    ])
    if (captureLocalIoLog) {
      commitLocalIoLogEntries((items) => [
        ...items,
        {
          schemaVersion: localIoLogSchemaVersion,
          id: localIoLogEntryId,
          turnId,
          threadId,
          sessionId,
          messageId: userMessageId,
          assistantMessageId: assistantId,
          startedAt,
          updatedAt: startedAt,
          status: 'running',
          runtime: {
            id: agent.id,
            name: agent.name,
            protocol: agent.protocol,
            ...(agent.bridge?.mode ? { mode: agent.bridge.mode } : {}),
          },
          prompt: clean,
        },
      ])
    }

    const updateAssistant = (updater: (message: UiChatMessage) => UiChatMessage) => {
      setMessages((items) => items.map((item) => (item.id === assistantId ? updater(item) : item)))
    }

    const updateLocalIoLogEntry = (updater: (entry: LocalIoLogEntry) => LocalIoLogEntry) => {
      if (!localIoLoggingEnabledRef.current) return
      commitLocalIoLogEntries((items) => items.map((item) => (item.id === localIoLogEntryId ? updater(item) : item)))
    }

    let completed = false
    try {
      for await (const event of agentClientFor(agent).stream({
        agent,
        knowledgeSources,
        query: clean,
        messages: runtimeMessages,
        messageId: userMessageId,
        threadId,
        sessionId,
        turnId,
        signal: runController.signal,
      })) {
        if ('step' in event) {
          updateAssistant((message) => ({
            ...message,
            steps: upsertStep(message.steps || [], event.step),
          }))
        }

        if (event.type === 'runtime_request') {
          updateLocalIoLogEntry((entry) => ({
            ...entry,
            request: localIoLogRuntimeRequest(event.request),
            updatedAt: new Date().toISOString(),
          }))
        }

        if (event.type === 'tool_call_started') {
          const source = knowledgeSources.find((item) => item.id === event.connectionId)
          updateAssistant((message) => ({
            ...message,
            toolCalls: upsertToolCall(message.toolCalls || [], {
              id: event.connectionId,
              sourceName: source?.name || event.connectionId,
              sourceProtocol: source?.protocol || 'llmwiki-http',
              status: 'running',
              detail: `${event.toolName} started.`,
            }),
          }))
        }

        if (event.type === 'tool_call_result') {
          const source = knowledgeSources.find((item) => item.id === event.connectionId)
          updateAssistant((message) => ({
            ...message,
            toolCalls: upsertToolCall(message.toolCalls || [], {
              id: event.connectionId,
              sourceName: source?.name || event.connectionId,
              sourceProtocol: source?.protocol || 'llmwiki-http',
              status: event.step.status,
              detail: event.step.detail || `${event.toolName} returned ${event.citations.length} citation(s).`,
            }),
          }))
        }

        if (event.type === 'citation') {
          updateAssistant((message) => ({
            ...message,
            citations: appendCitation(message.citations, event.citation),
          }))
        }

        if (event.type === 'graph_update') {
          setRunGraph((current) =>
            updateEvidenceGraphState(current, assistantId, sourceKey, selectedKey, sourceSnapshots, sourceGraph, event.graph),
          )
          updateAssistant((message) => ({
            ...message,
            evidenceGraph: updateEvidenceGraphState(
              message.evidenceGraph,
              assistantId,
              sourceKey,
              selectedKey,
              sourceSnapshots,
              sourceGraph,
              event.graph,
            ),
          }))
        }

        if (event.type === 'answer_delta') {
          updateAssistant((message) => ({ ...message, text: `${message.text}${event.delta}` }))
          updateLocalIoLogEntry((entry) => ({
            ...entry,
            response: {
              ...entry.response,
              answer: `${entry.response?.answer || ''}${event.delta}`,
            },
            updatedAt: new Date().toISOString(),
          }))
        }

        if (event.type === 'error') {
          updateAssistant((message) => ({
            ...message,
            agentRuntimeStatus: 'error',
            answerScope: updateAnswerScopeRuntimeStatus(message.answerScope, 'error'),
          }))
        }

        if (event.type === 'run_completed') {
          completed = true
          const finalRuntimeStatus: RuntimeStatus = event.result.steps.some((step) => step.status === 'error') ? 'error' : 'ready'
          const completedAt = new Date().toISOString()
          const completedEvidenceGraph = updateEvidenceGraphState(
            initialEvidenceGraph,
            assistantId,
            sourceKey,
            selectedKey,
            sourceSnapshots,
            sourceGraph,
            event.result.graph,
          )
          setRunGraph(completedEvidenceGraph)
          const orderedResult = orderRunResultForDisplay(
            agent,
            event.result.answer,
            event.result.citations,
            completedEvidenceGraph.graph,
            event.result.steps,
          )
          const firstCitation = orderedResult.citations[0] || null
          const toolCalls = renderToolCallsFromSteps(knowledgeSources, event.result.steps, orderedResult.citations)
          setSelectedCitation(firstCitation)
          setSelectedCitationReturnTarget(null)
          setSelectedNodeId(firstCitation ? graphNodeIdForCitation(firstCitation, completedEvidenceGraph.graph) : '')
          updateLocalIoLogEntry((entry) => ({
            ...entry,
            response: {
              answer: orderedResult.answer,
              metadata: localIoLogResponseMetadata(
                finalRuntimeStatus,
                completedAt,
                orderedResult.citations,
                completedEvidenceGraph.graph,
                event.result.steps,
                toolCalls,
              ),
            },
            status: finalRuntimeStatus === 'error' ? 'error' : 'completed',
            completedAt,
            updatedAt: completedAt,
          }))
          updateAssistant((message) => ({
            ...message,
            text: orderedResult.answer,
            citations: orderedResult.citations,
            citationReferenceIds: orderedResult.citationReferenceIds,
            steps: event.result.steps,
            agentRuntimeStatus: finalRuntimeStatus,
            answerScope: updateAnswerScopeRuntimeStatus(message.answerScope, finalRuntimeStatus),
            turnAudit: completeTurnAuditMetadata(
              message.turnAudit,
              sourceSnapshots,
              finalRuntimeStatus,
              completedAt,
              orderedResult.citations,
              completedEvidenceGraph.graph,
              event.result.steps,
              toolCalls,
            ),
            evidenceGraph: updateEvidenceGraphState(
              message.evidenceGraph,
              assistantId,
              sourceKey,
              selectedKey,
              sourceSnapshots,
              sourceGraph,
              event.result.graph,
            ),
            toolCalls,
          }))
        }
      }
      if (!completed) throw new Error(`${agent.name} did not complete`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const canceled = isCanceledRunError(error)
      const diagnostic = diagnosticFromError(error)
      const completedAt = new Date().toISOString()
      const assistantFailure = canceled
        ? 'Canceled because the selected scope changed. Ask again when the intended sources and runtime are selected.'
        : `Agent run failed: ${message}`
      updateLocalIoLogEntry((entry) => ({
        ...entry,
        response: {
          ...entry.response,
          answer: entry.response?.answer || assistantFailure,
        },
        error: {
          message: assistantFailure,
          diagnostic,
        },
        status: 'error',
        completedAt,
        updatedAt: completedAt,
      }))
      updateAssistant((item) => {
        const nextSteps = upsertStep(item.steps || [], {
          id: canceled ? 'agent-canceled' : 'agent-error',
          label: canceled ? `Cancel ${agent.name}` : `Run ${agent.name}`,
          status: 'error',
          detail: canceled ? 'The selected sources or runtime changed before the run completed.' : message,
          timestamp: new Date().toISOString(),
          runtimeId: agent.id,
          diagnostic,
        })
        const nextToolCalls: AgentToolCallTrace[] = item.toolCalls?.length
          ? item.toolCalls.map((call) => (call.status === 'running' ? { ...call, status: 'error' as const } : call))
          : knowledgeSources.map((connection) => ({
            id: connection.id,
            sourceName: connection.name,
            sourceProtocol: connection.protocol,
            status: 'error' as const,
            detail: canceled
              ? 'The agent run was canceled before this source returned evidence.'
              : 'The agent run stopped before this source returned evidence.',
          }))
        return {
          ...item,
          text: item.text || assistantFailure,
          steps: nextSteps,
          agentRuntimeStatus: 'error' as const,
          answerScope: updateAnswerScopeRuntimeStatus(item.answerScope, 'error'),
          turnAudit: completeTurnAuditMetadata(
            item.turnAudit,
            sourceSnapshots,
            'error',
            completedAt,
            item.citations,
            item.evidenceGraph?.graph || sourceGraph,
            nextSteps,
            nextToolCalls,
          ),
          toolCalls: nextToolCalls,
        }
      })
    } finally {
      if (activeRunController.current === runController) {
        activeRunController.current = null
        setBusy(false)
      }
    }
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="Chat">
        <header className="chat-header">
          <div className="mobile-app-identity">
            <strong>LLMWiki Chat</strong>
            <span>Knowledge source chat</span>
          </div>
          <div className="source-summary" role="group" aria-label="Active knowledge source summary">
            <div>
              <p>{sourceSummaryEyebrow(selectedConnections)}</p>
              <strong>{sourceSummaryTitle(selectedConnections, readyConnections)}</strong>
              <span className="source-summary-count">{sourceSummaryLabel(selectedConnections, readyConnections)}</span>
              <span className={`status-line ${sourceSelectionTone(selectedConnections)}`} aria-live="polite">
                {sourceSelectionCopy(selectedConnections)}
              </span>
            </div>
            <div className="source-chip-row" aria-label="Selected knowledge sources">
              {selectedConnections.length ? (
                selectedConnections.slice(0, 3).map((connection) => (
                  <span className={`source-chip ${connection.status}`} key={connection.id}>
                    {connection.name}
                    <small>{connection.status}</small>
                  </span>
                ))
              ) : (
                <span className="source-chip empty">No sources selected</span>
              )}
              {selectedConnections.length > 3 ? <span className="source-chip empty">+{selectedConnections.length - 3} more</span> : null}
            </div>
          </div>
          <div className="chat-session-actions" role="group" aria-label="Chat actions">
            <button
              className="refresh-chat-action"
              type="button"
              onClick={resetChat}
              disabled={!(messages.length > 0 || query.trim() || runGraph)}
              title="Clear the conversation and evidence while keeping source and runtime setup"
            >
              Refresh chat
            </button>
          </div>
          <ConnectionStatusDetails
            selectedAgent={selectedAgent}
            runtimeStatus={runtimeStatus}
            selectedConnections={selectedConnections}
            readyConnections={readyConnections}
            selectedSourcesTesting={selectedSourcesTesting}
            onReviewSources={() => {
              showSelectionGraph()
              focusKnowledgeSources()
            }}
            onTestSelectedSources={() => {
              showSelectionGraph()
              selectedConnections.forEach((connection) => {
                void discover(connection)
              })
            }}
          />
        </header>
        <div className="thread" aria-live="polite" ref={threadRef}>
          {messages.length ? (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id} data-message-id={message.id} tabIndex={-1}>
                {message.role === 'assistant' && message.answerScope ? (
                  <AnswerRunDetails
                    scope={message.answerScope}
                    agentName={message.agentName || message.answerScope.runtime.name}
                    runtimeStatus={message.agentRuntimeStatus || message.answerScope.runtime.status}
                    turnAudit={message.turnAudit}
                    steps={message.steps || []}
                    toolCalls={message.toolCalls || []}
                  />
                ) : message.role === 'assistant' && message.agentName ? (
                  <AnswerRunDetails
                    agentName={message.agentName}
                    runtimeStatus={message.agentRuntimeStatus || 'ready'}
                    turnAudit={message.turnAudit}
                    steps={message.steps || []}
                    toolCalls={message.toolCalls || []}
                  />
                ) : null}
                {message.role === 'assistant' && message.agentRuntimeStatus === 'running' && !message.text ? (
                  <p className="assistant-pending">Gathering evidence from the selected Knowledge Sources...</p>
                ) : (
                  <MarkdownAnswer
                    text={message.text}
                    citations={message.citations}
                    citationReferenceIds={message.citationReferenceIds}
                    selectedCitationId={selectedCitation?.id || ''}
                    selectedCitationMessageId={selectedCitationReturnTarget?.messageId || ''}
                    messageId={message.id}
                    onSelectCitation={(citation) => selectCitationEvidence(message, citation)}
                  />
                )}
                {message.role === 'assistant' && shouldShowUncitedEvidenceNotice(message) ? (
                  <p className="citation-mapping-note">
                    Evidence was returned, but the answer body does not include inline citation anchors.
                  </p>
                ) : null}
                {message.citations.length ? (
                  <div className="citations" aria-label="Citations">
                    {message.citations.map((citation, index) => (
                      <button
                        type="button"
                        onClick={() => selectCitationEvidence(message, citation)}
                        key={citation.id}
                        data-citation-id={citation.id}
                        aria-pressed={selectedCitation?.id === citation.id && selectedCitationReturnTarget?.messageId === message.id}
                        aria-controls="details-panel"
                      >
                        [{index + 1}] {citation.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="empty-state">
              <h1>{emptyStateHeadline(selectedConnections, readyConnections)}</h1>
              <LocalSessionSummary
                agent={selectedAgent}
                runtimeStatus={runtimeStatus}
                selectedConnections={selectedConnections}
                readySourceCount={readyConnections.length}
              />
              <div className="prompt-row" role="group" aria-label="Suggested prompts">
                {suggestedPromptActions.map(({ prompt, blockReason: promptBlockReason }) => {
                  return (
                    <button
                      type="button"
                      key={prompt}
                      disabled={Boolean(promptBlockReason)}
                      aria-describedby={promptBlockReason || externalRuntimeSourceUrlAdvisory ? 'suggested-prompt-status' : undefined}
                      aria-label={`Ask: ${prompt}`}
                      onClick={() => {
                        void askWith(prompt)
                      }}
                    >
                      Ask: {prompt}
                    </button>
                  )
                })}
              </div>
              <div className="quickstart-toggle panel">
                <div>
                  <p>Optional setup help</p>
                  <strong>Need help connecting llmwiki-serve?</strong>
                </div>
                <button
                  type="button"
                  className="secondary-action"
                  aria-expanded={quickstartEnabled}
                  aria-controls="quickstart-panel"
                  onClick={() => setQuickstartEnabled((enabled) => !enabled)}
                >
                  {quickstartEnabled ? 'Hide Quickstart' : 'Show Quickstart'}
                </button>
              </div>
              {quickstartEnabled ? (
                <QuickstartPanel
                  agents={agents}
                  connections={connections}
                  selectedAgent={selectedAgent}
                  runtimeStatus={runtimeStatus}
                  onTestSampleSource={testSampleSourceQuickstart}
                  onTestLocalBridge={testLocalBridgeQuickstart}
                  onUseLocalDevelopmentRuntime={useLocalDevelopmentRuntimeQuickstart}
                  onClose={() => setQuickstartEnabled(false)}
                />
              ) : null}
              {suggestedPromptStatusMessage ? (
                <p id="suggested-prompt-status" className="ask-guidance" aria-live="polite">
                  {suggestedPromptStatusMessage}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <div className="chat-footer">
          <form
            className="composer"
            ref={composerRef}
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            <label htmlFor="query">Question</label>
            <textarea
              id="query"
              ref={questionRef}
              value={query}
              aria-describedby="ask-status"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void ask()
                }
              }}
              rows={3}
            />
            <button type="submit" disabled={!canAsk} aria-describedby="ask-status">
              {askButtonLabel(busy, selectedConnections)}
            </button>
            <p id="ask-status" className={`ask-status ${askStatusTone}`} aria-live="polite">
              {askStatusMessage}
            </p>
          </form>
        </div>
      </section>
      <aside className="inspector" aria-label="Knowledge graph and details" ref={inspectorRef}>
        <KnowledgeMapSummary
          activeMode={activeGraphMode}
          answerGraphAvailable={Boolean(runGraph)}
          answerGraphSelectionDiffers={answerGraphSelectionDiffers}
          graph={activeGraph}
          selectedConnections={selectedConnections}
          readyConnections={readyConnections}
          sourceCount={activeGraphSources.length}
          sourceNames={activeGraphSources.map((source) => source.name)}
          onSelectAnswer={showAnswerGraph}
          onExploreSources={() => {
            showSelectionGraph()
            if (!readyConnections.length) focusKnowledgeSources()
          }}
        />
        <GraphExplorer
          graph={activeGraph}
          title={activeGraphMode === 'answer' ? 'Evidence graph' : 'Knowledge map'}
          emptyTitle="No map loaded yet."
          emptyDescription="Select and test a Knowledge Source to load page links."
          selectionPrompt={
            activeGraphMode === 'answer'
              ? 'Choose an evidence page to inspect its citation context.'
              : 'Choose a page in the map to preview its connections.'
          }
          selectedNodeId={selectedNodeId}
          onSelectNode={selectGraphNode}
        />
        <NodeList
          graph={activeGraph}
          selectedNodeId={selectedNodeId}
          onSelectNode={selectGraphNode}
        />
        <DetailsPanel
          citation={selectedCitation}
          graph={activeGraph}
          sources={activeGraphSources}
          selectedNodeId={selectedNodeId}
          pageRead={selectedPageRead}
          scopeLabel={detailsScopeLabel(activeGraphMode, answerGraphSelectionDiffers)}
          emptyCopy={
            activeGraphMode === 'answer'
              ? 'Choose an evidence page or citation to inspect details.'
              : 'Choose a page in the map to see its path, links, and source.'
          }
          onSelectNode={selectGraphNode}
          onBackToAnswer={selectedCitationReturnTarget ? () => revealAnswerCitation(selectedCitationReturnTarget) : undefined}
        />
        <LocalIoLogPanel
          enabled={localIoLoggingEnabled}
          entries={localIoLogEntries}
          onToggle={setLocalIoLogCollection}
          onClear={clearLocalIoLog}
        />
      </aside>
      <aside className="sidebar" aria-label="Knowledge connections">
        <h2 className="mobile-management-heading">Source management</h2>
        <div className="brand">
          <strong>LLMWiki Chat</strong>
          <span>Chat with selected LLMWiki sources and inspect grounded evidence</span>
        </div>
        <AgentRuntimeList agents={agents} onChange={updateAgents} onDiscover={discoverRuntime} />
        <ConnectionList
          connections={connections}
          onChange={updateConnections}
          onDiscover={discover}
          sectionRef={sourceSectionRef}
        />
      </aside>
    </main>
  )
}

function LocalIoLogPanel({
  enabled,
  entries,
  onToggle,
  onClear,
}: {
  enabled: boolean
  entries: LocalIoLogEntry[]
  onToggle: (enabled: boolean) => void
  onClear: () => void
}) {
  const [actionStatus, setActionStatus] = useState('')
  const jsonl = useMemo(() => localIoLogJsonl(entries), [entries])
  const newestEntries = useMemo(() => [...entries].reverse(), [entries])

  async function copyJsonl() {
    if (!entries.length) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(jsonl)
      setActionStatus('Copied JSONL to clipboard.')
    } catch {
      setActionStatus('Copy failed; use Export JSONL or select the visible entry text.')
    }
  }

  function exportJsonl() {
    if (!entries.length) return
    try {
      if (!URL.createObjectURL) throw new Error('Object URLs unavailable')
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `llmwiki-chat-local-io-log-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
      link.click()
      URL.revokeObjectURL(url)
      setActionStatus('Exported JSONL download.')
    } catch {
      setActionStatus('Export failed; copy the visible JSONL instead.')
    }
  }

  return (
    <section className="local-io-log-controls" aria-label="Local I/O logging controls">
      <label className="local-io-log-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>Local I/O logging</span>
      </label>
      <p>
        On by default for local debugging. Recent prompts, runtime request payloads, answers, errors, and metadata
        are stored as bounded JSONL in this browser only. Authorization headers, bearer tokens, API keys, and
        credential-bearing URL parts are redacted before storage.
      </p>
      {enabled ? (
        <details className="local-io-log-panel" role="region" aria-label="Local I/O log">
          <summary className="local-io-log-panel-header">
            <strong>Local I/O log</strong>
            <span>{entries.length ? `${entries.length} retained entr${entries.length === 1 ? 'y' : 'ies'}.` : 'No entries yet.'}</span>
          </summary>
          <div className="local-io-log-panel-body">
            <div className="local-io-log-actions" role="group" aria-label="Local I/O log actions">
              <button type="button" onClick={() => void copyJsonl()} disabled={!entries.length}>
                Copy JSONL
              </button>
              <button type="button" onClick={exportJsonl} disabled={!entries.length}>
                Export JSONL
              </button>
              <button type="button" onClick={onClear} disabled={!entries.length}>
                Clear local I/O log
              </button>
            </div>
            {actionStatus ? <p className="local-io-log-action-status" aria-live="polite">{actionStatus}</p> : null}
            <p>{entries.length ? `${entries.length} retained entr${entries.length === 1 ? 'y' : 'ies'}.` : 'No local I/O entries collected yet.'}</p>
            {newestEntries.length ? (
              <ol>
                {newestEntries.map((entry) => (
                  <li key={entry.id}>
                    <div className={`local-io-log-status ${entry.status}`}>{entry.status}</div>
                    <dl>
                      <div>
                        <dt>Turn ID</dt>
                        <dd>{entry.turnId}</dd>
                      </div>
                      <div>
                        <dt>Started</dt>
                        <dd>{entry.startedAt}</dd>
                      </div>
                      <div>
                        <dt>Runtime request</dt>
                        <dd>{entry.request ? `${entry.request.transport} · ${entry.request.summary.selectedKnowledgeSourceCount || 0} source(s) · ${entry.request.summary.messagesIncluded || 0} message(s)` : 'Waiting for runtime request...'}</dd>
                      </div>
                      <div>
                        <dt>User prompt</dt>
                        <dd>
                          <input
                            aria-label={`User prompt for turn ${entry.turnId}`}
                            className="local-io-log-field"
                            readOnly
                            value={entry.prompt}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Assistant answer or error</dt>
                        <dd>
                          <input
                            aria-label={`Assistant answer or error for turn ${entry.turnId}`}
                            className="local-io-log-field"
                            readOnly
                            value={entry.response?.answer || entry.error?.message || 'Waiting for assistant answer...'}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>JSONL entry</dt>
                        <dd>
                          <input
                            aria-label={`JSONL entry for turn ${entry.turnId}`}
                            className="local-io-log-field local-io-log-json"
                            readOnly
                            value={JSON.stringify(entry, null, 2)}
                          />
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="local-io-log-disabled">Local I/O logging is off. Stored raw entries were cleared and future turns will not be logged until you re-enable it.</p>
      )}
    </section>
  )
}

function ConnectionStatusDetails({
  selectedAgent,
  runtimeStatus,
  selectedConnections,
  readyConnections,
  selectedSourcesTesting,
  onReviewSources,
  onTestSelectedSources,
}: {
  selectedAgent: AgentConnection
  runtimeStatus: RuntimeStatus
  selectedConnections: Connection[]
  readyConnections: Connection[]
  selectedSourcesTesting: boolean
  onReviewSources: () => void
  onTestSelectedSources: () => void
}) {
  return (
    <details className="connection-status-details">
      <summary>
        <span>Connection status</span>
        <strong>{connectionStatusSummary(selectedConnections, readyConnections, runtimeStatus)}</strong>
      </summary>
      <div className="connection-status-body">
        <dl className="connection-status-list">
          <div>
            <dt>Selected sources</dt>
            <dd>{sourceSummaryLabel(selectedConnections, readyConnections)}</dd>
          </div>
          <div>
            <dt>Source readiness</dt>
            <dd>{sourceSelectionCopy(selectedConnections)}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{runtimeSummaryLabel(selectedAgent, runtimeStatus)}</dd>
          </div>
          <div>
            <dt>Runtime mode</dt>
            <dd>{runtimeModeLabel(selectedAgent)}</dd>
          </div>
          {selectedConnections.length ? (
            <div>
              <dt>Endpoint metadata</dt>
              <dd>{selectedEndpointMetadata(selectedConnections)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="chat-header-actions">
          <button type="button" onClick={onReviewSources}>
            Review sources
          </button>
          <button
            type="button"
            onClick={onTestSelectedSources}
            disabled={!selectedConnections.length || selectedSourcesTesting}
          >
            {selectedSourcesTesting ? 'Testing selected sources...' : 'Test selected sources'}
          </button>
        </div>
      </div>
    </details>
  )
}

function LocalSessionSummary({
  agent,
  runtimeStatus,
  selectedConnections,
  readySourceCount,
}: {
  agent: AgentConnection
  runtimeStatus: RuntimeStatus
  selectedConnections: Connection[]
  readySourceCount: number
}) {
  const primarySource = selectedConnections[0]
  return (
    <div className="local-session-summary" aria-label="Local sample source and runtime">
      <div className="local-source-highlight">
        <span>Selected source</span>
        <strong>{primarySource?.name || 'No source selected'}</strong>
        <small>{primarySource ? `${sourceEndpointSummary(primarySource)} · ${readySourceCount} ready` : 'Select a Knowledge Source'}</small>
      </div>
      <details className="local-session-details">
        <summary>Runtime and endpoint details</summary>
        <dl className="local-session-meta">
          <div>
            <dt>Runtime</dt>
            <dd>{agent.name}</dd>
          </div>
          <div>
            <dt>Runtime mode</dt>
            <dd>{runtimeModeLabel(agent)}</dd>
          </div>
          <div>
            <dt>Runtime status</dt>
            <dd>{runtimeStatusCopy(agent, runtimeStatus)}</dd>
          </div>
          {primarySource ? (
            <>
              <div>
                <dt>Endpoint metadata</dt>
                <dd>{primarySource.url}</dd>
              </div>
              <div>
                <dt>Source readiness</dt>
                <dd>{sourceTestCopy(primarySource)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </details>
    </div>
  )
}

function QuickstartPanel({
  agents,
  connections,
  selectedAgent,
  runtimeStatus,
  onTestSampleSource,
  onTestLocalBridge,
  onUseLocalDevelopmentRuntime,
  onClose,
}: {
  agents: AgentConnection[]
  connections: Connection[]
  selectedAgent: AgentConnection
  runtimeStatus: RuntimeStatus
  onTestSampleSource: () => void
  onTestLocalBridge: () => void
  onUseLocalDevelopmentRuntime: () => void
  onClose: () => void
}) {
  const sampleSource = connections.find(isStarterConnection) || connections[0]
  const localBridge = agents.find((agent) => agent.id === 'bridge-a2a')
  const localDevelopmentRuntime = agents.find((agent) => agent.protocol === 'mock-agent')
  const bridgeChecking = localBridge?.status === 'checking'
  const sourceChecking = sampleSource?.status === 'checking'
  const bridgeReady = localBridge?.status === 'ready'
  const sourceReady = sampleSource?.status === 'ready'
  const selectedRuntimeIsLocalDevelopment = selectedAgent.protocol === 'mock-agent'
  const [advancedRuntimeOpen, setAdvancedRuntimeOpen] = useState(false)

  return (
    <section id="quickstart-panel" className="quickstart-panel panel" aria-label="Quickstart" tabIndex={-1}>
      <div className="quickstart-heading">
        <div>
          <p>First-run quickstart</p>
          <h2>Step 1: connect llmwiki-serve.</h2>
        </div>
        <span className="scope-chip">browser-safe</span>
      </div>
      <p>
        The browser workbench cannot install packages, start local processes, or
        read arbitrary wiki paths. For a first pass, you only need
        {' '}<code>llmwiki-serve</code>: chat can verify the source, show evidence,
        and use the Local Development Runtime for deterministic UI checks.
      </p>
      <section className="quickstart-step" aria-label="Step 1 source setup">
        <h3>Get a Knowledge Source working</h3>
        <p>
          Start or reuse <code>llmwiki-serve</code>, then test the sample URL.
          Once it is ready, the Pages, Details, and graph views can inspect the
          evidence even before you connect any external LLM runtime.
        </p>
        <dl className="quickstart-status" aria-label="Quickstart source status">
          <div>
            <dt>Sample source</dt>
            <dd>
              <span className={`status-chip ${sampleSource?.status || 'unknown'}`}>
                {sampleSource?.status || 'unknown'}
              </span>
              <span>{sampleSource?.url || defaultServeUrl()}</span>
            </dd>
          </div>
        </dl>
        {!sourceReady ? (
          <p className="quickstart-guidance">
            If this check fails or stays unknown, open the llmwiki-serve commands
            below, start the source in a trusted shell, then test again. You can
            close Quickstart any time and configure Knowledge Sources manually.
          </p>
        ) : null}
        <div className="quickstart-actions" role="group" aria-label="Quickstart source actions">
          <button type="button" onClick={onTestSampleSource} disabled={sourceChecking}>
            {sourceChecking ? 'Testing sample source...' : 'Test sample source'}
          </button>
          <button className="secondary-action" type="button" onClick={onClose}>
            Close Quickstart
          </button>
        </div>
      </section>
      <details className="quickstart-command-details">
        <summary>Show llmwiki-serve commands</summary>
        <div className="quickstart-grid">
          <div>
            <h3>Serve a wiki</h3>
            <pre className="quickstart-command"><code>{quickstartServeCommand.join('\n')}</code></pre>
            <small>Replace <code>/path/to/wiki</code> with your Markdown, Obsidian, or LLMWiki folder.</small>
          </div>
          <div>
            <h3>Use the bundled sample</h3>
            <pre className="quickstart-command"><code>{quickstartSampleServeCommand.join('\n')}</code></pre>
            <small>Use this when you want a known-good source before trying private content.</small>
          </div>
        </div>
      </details>
      {sourceReady ? (
        <section className="quickstart-step" aria-label="Step 2 runtime choice">
          <div>
            <p className="quickstart-step-label">Step 2</p>
            <h3>Choose the default runtime path</h3>
          </div>
          <p>
            Default: use Local Development Runtime. It needs no external LLM
            endpoint and keeps the source/evidence inspection path unblocked.
          </p>
          <dl className="quickstart-status" aria-label="Quickstart runtime status">
            <div>
              <dt>Selected runtime</dt>
              <dd>
                <span className={`status-chip ${runtimeStatus}`}>{runtimeStatus}</span>
                <span>{runtimeSummaryLabel(selectedAgent, runtimeStatus)}</span>
              </dd>
            </div>
          </dl>
          <div className="quickstart-actions" role="group" aria-label="Quickstart runtime actions">
            <button
              type="button"
              onClick={selectedRuntimeIsLocalDevelopment ? onClose : onUseLocalDevelopmentRuntime}
              disabled={!selectedRuntimeIsLocalDevelopment && !localDevelopmentRuntime}
            >
              {selectedRuntimeIsLocalDevelopment ? 'Continue serve-only' : 'Use Local Development Runtime'}
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              Finish Quickstart
            </button>
          </div>
          <p className="quickstart-ready-note">
            {selectedRuntimeIsLocalDevelopment
              ? 'Serve-only path is ready: ask from the composer or inspect the evidence panels.'
              : 'No external LLM runtime is required for the default path; select Local Development Runtime to continue serve-only.'}
          </p>
          <div className="quickstart-advanced-entry">
            <div>
              <strong>Optional: bridge or external LLM runtime</strong>
              <span>Skip this if you only have llmwiki-serve right now.</span>
            </div>
            <button
              className="secondary-action"
              type="button"
              aria-expanded={advancedRuntimeOpen}
              aria-controls="quickstart-advanced-runtime"
              onClick={() => setAdvancedRuntimeOpen((open) => !open)}
            >
              {advancedRuntimeOpen ? 'Hide optional bridge/runtime steps' : 'Show optional bridge/runtime steps'}
            </button>
          </div>
          {advancedRuntimeOpen ? (
            <section
              id="quickstart-advanced-runtime"
              className="quickstart-advanced-panel"
              aria-label="Optional bridge runtime steps"
            >
              <h3>Optional advanced runtime</h3>
              <p>
                {bridgeReady
                  ? 'Local bridge is ready for a real LLM-backed runtime path.'
                  : 'No bridge or LLM endpoint? Skip this. To use a real LLM later, install/start llmwiki-agent-bridge, read the docs, then test the bridge here.'}
              </p>
              <p className="quickstart-docs">
                Bridge mode is for Hermes, DeepAgents, or OpenAI-compatible runtimes. Read{' '}
                <a href={quickstartDocsUrl} target="_blank" rel="noreferrer">Quickstart docs</a>
                {' '}or{' '}
                <a href={runtimeAdapterDocsUrl} target="_blank" rel="noreferrer">Runtime adapter notes</a>.
                For bridge installation details, see the{' '}
                <a href={agentBridgeDocsUrl} target="_blank" rel="noreferrer">Agent Bridge README</a>.
              </p>
              <dl className="quickstart-status" aria-label="Quickstart bridge status">
                <div>
                  <dt>Local bridge</dt>
                  <dd>
                    <span className={`status-chip ${localBridge?.status || 'unknown'}`}>
                      {localBridge?.status || 'unknown'}
                    </span>
                    <span>{localBridge?.url || 'http://127.0.0.1:8788'}</span>
                  </dd>
                </div>
              </dl>
              <div className="quickstart-actions" role="group" aria-label="Quickstart bridge actions">
                <button className="secondary-action" type="button" onClick={onTestLocalBridge} disabled={!localBridge || bridgeChecking}>
                  {bridgeChecking ? 'Testing local bridge...' : 'Test local bridge'}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    onUseLocalDevelopmentRuntime()
                    onClose()
                  }}
                >
                  Skip and close
                </button>
              </div>
              <details className="quickstart-command-details">
                <summary>Show bridge command</summary>
                <div className="quickstart-grid">
                  <div>
                    <h3>Optional: start the local bridge</h3>
                    <pre className="quickstart-command"><code>{quickstartBridgeCommand.join('\n')}</code></pre>
                    <small>Use this only after you have a real runtime endpoint to put behind the bridge.</small>
                  </div>
                </div>
              </details>
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function createSourceDiscoveryRequest(connection: Connection): SourceDiscoveryRequest {
  return {
    id: connection.id,
    url: connection.url,
    protocol: connection.protocol,
    token: createId(),
    controller: new AbortController(),
  }
}

function canApplySourceDiscovery(
  connection: Connection,
  request: SourceDiscoveryRequest,
  requests: Map<string, SourceDiscoveryRequest>,
): boolean {
  return connection.id === request.id
    && connection.url === request.url
    && connection.protocol === request.protocol
    && requests.get(request.id)?.token === request.token
}

function mergeDiscoveredConnection(current: Connection, discovered: Connection): Connection {
  const keepUserName = Boolean(current.nameOverride && current.name.trim())
  return {
    ...current,
    ...discovered,
    name: keepUserName ? current.name : discovered.name,
    nameOverride: keepUserName ? current.nameOverride : discovered.nameOverride,
    selected: current.selected,
    diagnostic: discovered.diagnostic,
  }
}

function invalidateChangedSourceRequests(
  current: Connection[],
  next: Connection[],
  requests: Map<string, SourceDiscoveryRequest>,
): void {
  const nextById = new Map(next.map((connection) => [connection.id, connection]))
  current.forEach((connection) => {
    const nextConnection = nextById.get(connection.id)
    if (
      !nextConnection
      || connection.url !== nextConnection.url
      || connection.protocol !== nextConnection.protocol
    ) {
      requests.get(connection.id)?.controller.abort()
      requests.delete(connection.id)
    }
  })
}

function createRuntimeDiscoveryRequest(agent: AgentConnection): RuntimeDiscoveryRequest {
  return {
    id: agent.id,
    url: agent.url || '',
    protocol: agent.protocol,
    bearerToken: agent.bearerToken || '',
    token: createId(),
    controller: new AbortController(),
  }
}

function canApplyRuntimeDiscovery(
  agent: AgentConnection,
  request: RuntimeDiscoveryRequest,
  requests: Map<string, RuntimeDiscoveryRequest>,
): boolean {
  return agent.id === request.id
    && (agent.url || '') === request.url
    && agent.protocol === request.protocol
    && (agent.bearerToken || '') === request.bearerToken
    && requests.get(request.id)?.token === request.token
}

function mergeDiscoveredAgent(current: AgentConnection, discovered: AgentConnection): AgentConnection {
  return {
    ...current,
    ...discovered,
    selected: current.selected,
    bearerToken: current.bearerToken,
    diagnostic: discovered.diagnostic,
  }
}

function mergeBridgeManagedSources(
  current: Connection[],
  agent: AgentConnection,
  bridgeSources: BridgeKnowledgeSourceSnapshot[],
): Connection[] {
  const currentById = new Map(current.map((connection) => [connection.id, connection]))
  const bridgeConnectionByEndpoint = new Map(
    current
      .filter(isBridgeManagedConnection)
      .map((connection) => [connectionEndpointKey(connection), connection]),
  )
  const nextBridgeIds = new Set(
    bridgeSources.map((source) => bridgeManagedConnectionId(agent, source)),
  )
  const nextBridgeEndpointKeys = new Set(
    bridgeSources.map((source) => sourceEndpointKey(source.protocol, source.url)),
  )
  const selectedReadyBridgeEndpointKeys = new Set(
    bridgeSources
      .filter((source) => source.selected && (source.status === 'ready' || source.status === 'unknown'))
      .map((source) => sourceEndpointKey(source.protocol, source.url)),
  )
  const keptConnections = current.filter((connection) => (
    !isBridgeManagedConnection(connection)
    || (
      connection.bridgeSource?.agentId !== agent.id
      && !nextBridgeEndpointKeys.has(connectionEndpointKey(connection))
    )
    || nextBridgeIds.has(connection.id)
  ))
  const bridgeConnections = bridgeSources
    .map((source): Connection => {
      const id = bridgeManagedConnectionId(agent, source)
      const existing = currentById.get(id) || bridgeConnectionByEndpoint.get(sourceEndpointKey(source.protocol, source.url))
      return {
        id,
        name: source.name,
        protocol: source.protocol,
        url: source.url,
        selected: existing?.selected ?? source.selected,
        status: source.status === 'unknown' ? 'ready' : source.status,
        sourceOrigin: 'bridge',
        bridgeSource: {
          agentId: agent.id,
          agentName: agent.name,
          sourceId: source.id,
        },
        readOnly: true,
        description: source.description,
        adapter: source.adapter,
        implementation: source.implementation,
        capabilities: source.capabilities,
        error: '',
        diagnostic: undefined,
      }
    })

  const directConnections = keptConnections
    .filter((connection) => !nextBridgeIds.has(connection.id))
    .map((connection) => (
      bridgeConnections.length && (
        shouldDeselectDefaultStarterForBridge(connection)
        || shouldDeselectDirectDuplicateForBridge(connection, selectedReadyBridgeEndpointKeys)
      )
        ? { ...connection, selected: false }
        : connection
    ))

  return [...directConnections, ...bridgeConnections]
}

function selectedAgentFromList(agents: AgentConnection[]): AgentConnection | undefined {
  return agents.find((agent) => agent.selected) || agents[0]
}

function connectionsForSelectedAgent(connections: Connection[], agent: AgentConnection | undefined): Connection[] {
  if (agent && isBridgeAgent(agent)) return connections
  let changed = false
  const nextConnections = connections.map((connection) => {
    if (!isBridgeManagedConnection(connection) || !connection.selected) return connection
    changed = true
    return { ...connection, selected: false }
  })
  return changed ? nextConnections : connections
}

function runScopeKey(agents: AgentConnection[], connections: Connection[]): string {
  const agent = selectedAgentFromList(agents)
  const runtimeKey = agent
    ? ['runtime', agent.id, agent.protocol, scopeUrlKey(agent.url || ''), agent.bearerToken || ''].join('\u0001')
    : 'runtime'
  const sourceKeys = connections
    .filter((connection) => connection.selected)
    .map((connection) => ['source', connection.id, connection.protocol, scopeUrlKey(connection.url)].join('\u0001'))
    .sort()
  return [runtimeKey, ...sourceKeys].join('\u0002')
}

function scopeUrlKey(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function bridgeManagedConnectionId(agent: AgentConnection, source: BridgeKnowledgeSourceSnapshot): string {
  return `bridge:${agent.id}:${source.id}`
}

function connectionEndpointKey(connection: Pick<Connection, 'protocol' | 'url'>): string {
  return sourceEndpointKey(connection.protocol, connection.url)
}

function sourceEndpointKey(protocol: Protocol, url: string): string {
  return `${protocol}:${url.trim().replace(/\/+$/, '').toLowerCase()}`
}

function shouldDeselectDefaultStarterForBridge(connection: Connection): boolean {
  return connection.id === 'local-demo'
    && !connection.nameOverride
    && connection.url === defaultServeUrl()
    && connection.status !== 'ready'
}

function shouldDeselectDirectDuplicateForBridge(
  connection: Connection,
  selectedReadyBridgeEndpointKeys: Set<string>,
): boolean {
  return !isBridgeManagedConnection(connection)
    && connection.selected
    && selectedReadyBridgeEndpointKeys.has(connectionEndpointKey(connection))
}

function resetAgentRuntime(agents: AgentConnection[], agentId: string): AgentConnection[] {
  const current = agents.find((agent) => agent.id === agentId)
  const starter = starterAgentConnections.find((agent) => agent.id === agentId)
  const defaultSelectedId = starterAgentConnections.find((agent) => agent.selected)?.id || starterAgentConnections[0]?.id
  const next: AgentConnection[] = agents.map((agent): AgentConnection => {
    if (agent.id === agentId) {
      if (starter) {
        return {
          ...starter,
          added: false,
          selected: current?.selected && isBridgeAgent(starter) && Boolean(starter.url?.trim())
            ? true
            : Boolean(starter.selected),
          bearerToken: '',
          capabilities: [],
          latencyMs: undefined,
          error: '',
          diagnostic: undefined,
          settingsUrl: '',
        }
      }
      return {
        ...agent,
        added: false,
        url: '',
        bearerToken: '',
        selected: false,
        status: 'unavailable',
        capabilities: [],
        latencyMs: undefined,
        error: '',
        diagnostic: undefined,
      }
    }
    return agent
  })
  if (!current?.selected || next.some((agent) => agent.selected)) return next
  return next.map((agent) => ({ ...agent, selected: agent.id === defaultSelectedId }))
}

function invalidateChangedRuntimeRequests(
  current: AgentConnection[],
  next: AgentConnection[],
  requests: Map<string, RuntimeDiscoveryRequest>,
): void {
  const nextById = new Map(next.map((agent) => [agent.id, agent]))
  current.forEach((agent) => {
    const nextAgent = nextById.get(agent.id)
    if (
      !nextAgent
      || (agent.url || '') !== (nextAgent.url || '')
      || agent.protocol !== nextAgent.protocol
      || (agent.bearerToken || '') !== (nextAgent.bearerToken || '')
    ) {
      requests.get(agent.id)?.controller.abort()
      requests.delete(agent.id)
    }
  })
}

function MarkdownAnswer({
  text,
  citations,
  citationReferenceIds = [],
  selectedCitationId,
  selectedCitationMessageId,
  messageId,
  onSelectCitation,
}: {
  text: string
  citations: Citation[]
  citationReferenceIds?: string[]
  selectedCitationId: string
  selectedCitationMessageId: string
  messageId: string
  onSelectCitation: (citation: Citation) => void
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
      components={{
        a({ href, children, node, ...props }) {
          void node
          const citation = citationForMarkdownReference(href, children, citations, citationReferenceIds)
          if (citation) {
            return (
              <button
                type="button"
                className="inline-citation"
                data-citation-id={citation.id}
                aria-label={citationActionLabel(citation, citations)}
                aria-controls="details-panel"
                aria-pressed={selectedCitationId === citation.id && (!selectedCitationMessageId || selectedCitationMessageId === messageId)}
                onClick={() => onSelectCitation(citation)}
              >
                {citationInlineChildren(children, citation, citations)}
              </button>
            )
          }
          return <a href={href} {...props}>{children}</a>
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function DiagnosticDetails({
  diagnostic,
  label,
  openByDefault = false,
}: {
  diagnostic?: Diagnostic
  label: string
  openByDefault?: boolean
}) {
  if (!diagnostic || !diagnosticHasContent(diagnostic)) return null

  const partial = diagnosticPartialText(diagnostic.partial)
  const summary = diagnostic.title || diagnostic.detail || label

  return (
    <details className="diagnostic-details" open={openByDefault ? true : undefined}>
      <summary>{label}</summary>
      <div className="diagnostic-detail-body">
        {diagnostic.title || diagnostic.detail ? (
          <p>
            {diagnostic.title ? <strong>{diagnostic.title}</strong> : null}
            {diagnostic.title && diagnostic.detail ? ' ' : null}
            {diagnostic.detail && diagnostic.detail !== diagnostic.title ? <span>{diagnostic.detail}</span> : null}
          </p>
        ) : (
          <p>{summary}</p>
        )}
        <dl className="diagnostic-meta">
          {diagnostic.severity ? (
            <div>
              <dt>Severity</dt>
              <dd>{diagnostic.severity}</dd>
            </div>
          ) : null}
          {diagnostic.scope ? (
            <div>
              <dt>Scope</dt>
              <dd>{diagnostic.scope}</dd>
            </div>
          ) : null}
          {diagnostic.phase ? (
            <div>
              <dt>Phase</dt>
              <dd>{diagnostic.phase}</dd>
            </div>
          ) : null}
          {diagnostic.protocol ? (
            <div>
              <dt>Protocol</dt>
              <dd>{diagnostic.protocol}</dd>
            </div>
          ) : null}
          {diagnostic.subject ? (
            <div>
              <dt>Subject</dt>
              <dd>{diagnostic.subject}</dd>
            </div>
          ) : null}
          {diagnostic.retryable ? (
            <div>
              <dt>Retry</dt>
              <dd>{diagnostic.retryable}</dd>
            </div>
          ) : null}
          {diagnostic.traceId ? (
            <div>
              <dt>Trace ID</dt>
              <dd>{diagnostic.traceId}</dd>
            </div>
          ) : null}
          {diagnostic.status !== undefined ? (
            <div>
              <dt>Status</dt>
              <dd>{diagnostic.status}</dd>
            </div>
          ) : null}
          {diagnostic.type ? (
            <div>
              <dt>Type</dt>
              <dd>{diagnostic.type}</dd>
            </div>
          ) : null}
          {diagnostic.instance ? (
            <div>
              <dt>Instance</dt>
              <dd>{diagnostic.instance}</dd>
            </div>
          ) : null}
        </dl>
        {diagnostic.observations?.length ? (
          <div className="diagnostic-list">
            <strong>Observations</strong>
            <ul>
              {diagnostic.observations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {diagnostic.remediation?.length ? (
          <div className="diagnostic-list">
            <strong>Remediation</strong>
            <ul>
              {diagnostic.remediation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {diagnostic.steps?.length ? (
          <div className="diagnostic-list">
            <strong>Diagnostic steps</strong>
            <ol>
              {diagnostic.steps.map((step, index) => (
                <li key={step.id || `${step.label}-${index}`}>
                  {step.status ? <span className={`step-status ${step.status}`}>{step.status}</span> : null}
                  <span>{step.label}</span>
                  {step.detail ? <small>{step.detail}</small> : null}
                  {step.error ? <small className="step-error">{step.error}</small> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {partial ? (
          <div className="diagnostic-partial">
            <strong>Partial</strong>
            <pre>{partial}</pre>
          </div>
        ) : null}
      </div>
    </details>
  )
}

function diagnosticHasContent(diagnostic: Diagnostic): boolean {
  return Boolean(
    diagnostic.title
    || diagnostic.detail
    || diagnostic.severity
    || diagnostic.scope
    || diagnostic.phase
    || diagnostic.protocol
    || diagnostic.subject
    || diagnostic.retryable
    || diagnostic.observations?.length
    || diagnostic.remediation?.length
    || diagnostic.traceId
    || diagnostic.type
    || diagnostic.instance
    || diagnostic.status !== undefined
    || diagnostic.steps?.length
    || diagnosticPartialText(diagnostic.partial),
  )
}

function diagnosticPartialText(partial: unknown): string {
  if (partial === undefined || partial === null) return ''
  if (typeof partial === 'string') return limitDiagnosticText(partial)
  if (typeof partial === 'number' || typeof partial === 'boolean') return String(partial)
  try {
    return limitDiagnosticText(JSON.stringify(partial, null, 2) || '')
  } catch {
    return limitDiagnosticText(String(partial))
  }
}

function limitDiagnosticText(value: string): string {
  const clean = value.trim()
  return clean.length > 900 ? `${clean.slice(0, 900)}...` : clean
}

function citationActionLabel(citation: Citation, citations: Citation[]): string {
  const index = citations.findIndex((item) => item.id === citation.id)
  const label = citation.title.trim() || citation.path.trim() || 'Untitled source'
  return index >= 0 ? `Citation ${index + 1}: ${label}` : `Citation: ${label}`
}

function shouldShowUncitedEvidenceNotice(message: UiChatMessage): boolean {
  return Boolean(
    message.citations.length
    && message.text.trim()
    && !answerHasMappedCitationAnchor(message.text, message.citations, message.citationReferenceIds),
  )
}

function answerHasMappedCitationAnchor(
  text: string,
  citations: Citation[],
  citationReferenceIds: string[] = [],
): boolean {
  if (!citations.length) return false

  for (const reference of markdownCitationReferences(text)) {
    if (citationForMarkdownReference(reference.href, reference.label, citations, citationReferenceIds)) return true
  }

  for (const reference of htmlCitationReferences(text)) {
    if (citationForMarkdownReference(reference.href, reference.label, citations, citationReferenceIds)) return true
  }

  return false
}

type CitationReferenceCandidate = {
  href: string
  label: string
}

function markdownCitationReferences(text: string): CitationReferenceCandidate[] {
  const references: CitationReferenceCandidate[] = []
  let searchIndex = 0
  while (searchIndex < text.length) {
    const labelStart = text.indexOf('[', searchIndex)
    if (labelStart < 0) break
    if (isEscapedMarkdownCharacter(text, labelStart)) {
      searchIndex = labelStart + 1
      continue
    }

    const labelEnd = findMarkdownCharacter(text, ']', labelStart + 1)
    if (labelEnd < 0) break
    if (text[labelEnd + 1] !== '(') {
      searchIndex = labelStart + 1
      continue
    }

    const hrefStart = skipMarkdownWhitespace(text, labelEnd + 2)
    if (text[hrefStart] !== '#') {
      searchIndex = labelStart + 1
      continue
    }

    let hrefEnd = hrefStart + 1
    while (
      hrefEnd < text.length
      && text[hrefEnd] !== ')'
      && !isMarkdownWhitespace(text[hrefEnd])
    ) {
      hrefEnd += 1
    }

    const linkEnd = findMarkdownCharacter(text, ')', hrefEnd)
    if (linkEnd < 0) break
    references.push({
      href: text.slice(hrefStart, hrefEnd),
      label: unescapeMarkdownText(text.slice(labelStart + 1, labelEnd)),
    })
    searchIndex = linkEnd + 1
  }
  return references
}

function htmlCitationReferences(text: string): CitationReferenceCandidate[] {
  const references: CitationReferenceCandidate[] = []
  let searchIndex = 0

  while (searchIndex < text.length) {
    const openStart = indexOfCaseInsensitive(text, '<a', searchIndex)
    if (openStart < 0) break
    if (!isHtmlTagNameBoundary(text[openStart + 2])) {
      searchIndex = openStart + 2
      continue
    }

    const openEnd = htmlTagEndIndex(text, openStart + 2)
    if (openEnd < 0) break
    const href = hrefFromAnchorStartTag(text.slice(openStart, openEnd + 1))
    const closeStart = indexOfCaseInsensitive(text, '</a', openEnd + 1)
    if (closeStart < 0) break

    if (href.startsWith('#')) {
      references.push({
        href,
        label: htmlTextContent(text.slice(openEnd + 1, closeStart)).trim(),
      })
    }
    searchIndex = closeStart + 3
  }

  return references
}

function indexOfCaseInsensitive(value: string, needle: string, start: number): number {
  const lowerNeedle = needle.toLowerCase()
  const maxStart = value.length - needle.length
  for (let index = start; index <= maxStart; index += 1) {
    if (value.slice(index, index + needle.length).toLowerCase() === lowerNeedle) return index
  }
  return -1
}

function isHtmlTagNameBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || isMarkdownWhitespace(char)
}

function htmlTagEndIndex(value: string, start: number): number {
  let quote = ''
  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return -1
}

function hrefFromAnchorStartTag(tag: string): string {
  let index = 2

  while (index < tag.length) {
    index = skipMarkdownWhitespace(tag, index)
    if (tag[index] === '>' || tag[index] === '/') break

    const nameStart = index
    while (
      index < tag.length
      && tag[index] !== '='
      && tag[index] !== '>'
      && !isMarkdownWhitespace(tag[index])
    ) {
      index += 1
    }
    const name = tag.slice(nameStart, index).toLowerCase()
    index = skipMarkdownWhitespace(tag, index)

    let value = ''
    if (tag[index] === '=') {
      index = skipMarkdownWhitespace(tag, index + 1)
      const quote = tag[index] === '"' || tag[index] === "'" ? tag[index] : ''
      if (quote) {
        const valueStart = index + 1
        const valueEnd = tag.indexOf(quote, valueStart)
        if (valueEnd < 0) break
        value = tag.slice(valueStart, valueEnd)
        index = valueEnd + 1
      } else {
        const valueStart = index
        while (index < tag.length && tag[index] !== '>' && !isMarkdownWhitespace(tag[index])) index += 1
        value = tag.slice(valueStart, index)
      }
    }

    if (name === 'href') return value
  }

  return ''
}

function htmlTextContent(value: string): string {
  let output = ''
  let index = 0

  while (index < value.length) {
    if (value[index] !== '<') {
      output += value[index]
      index += 1
      continue
    }

    const tagEnd = htmlTagEndIndex(value, index + 1)
    if (tagEnd < 0) break
    index = tagEnd + 1
  }

  return output
}

function findMarkdownCharacter(value: string, needle: string, start: number): number {
  let index = start
  while (index < value.length) {
    if (value[index] === needle && !isEscapedMarkdownCharacter(value, index)) return index
    index += 1
  }
  return -1
}

function isEscapedMarkdownCharacter(value: string, index: number): boolean {
  let slashCount = 0
  let cursor = index - 1
  while (cursor >= 0 && value[cursor] === '\\') {
    slashCount += 1
    cursor -= 1
  }
  return slashCount % 2 === 1
}

function unescapeMarkdownText(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && index + 1 < value.length) {
      output += value[index + 1]
      index += 1
    } else {
      output += value[index]
    }
  }
  return output
}

function skipMarkdownWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && isMarkdownWhitespace(value[index])) index += 1
  return index
}

function isMarkdownWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f'
}

function AgentRuntimeList({
  agents,
  onChange,
  onDiscover,
}: {
  agents: AgentConnection[]
  onChange: (agents: AgentConnection[]) => void
  onDiscover: (agent: AgentConnection) => void
}) {
  const [runtimeTemplateId, setRuntimeTemplateId] = useState('')
  const [sectionState, setSectionState] = useState({ open: false, completionKey: '' })
  const [expandedAgentCardId, setExpandedAgentCardId] = useState('')
  const [addRuntimeOpen, setAddRuntimeOpen] = useState(false)
  const updateAgent = (agentId: string, update: Partial<AgentConnection>) => {
    onChange(agents.map((agent) => (agent.id === agentId ? { ...agent, ...update } : agent)))
  }
  const maybeDiscoverAgent = (agent: AgentConnection) => {
    if (shouldAutoDiscoverAgent(agent)) onDiscover(agent)
  }
  const selectAgent = (agent: AgentConnection) => {
    const nextAgent = { ...agent, selected: true }
    onChange(agents.map((item) => ({ ...item, selected: item.id === agent.id })))
    maybeDiscoverAgent(nextAgent)
  }
  const selectedAgent = agents.find((agent) => agent.selected) || agents[0]
  const bridgeAgents = agents.filter(isPrimaryBridgeAgent)
  const testingAgents = agents.filter((agent) => agent.protocol === 'mock-agent')
  const addableAgents = agents.filter((agent) => !isPrimaryBridgeAgent(agent) && agent.protocol !== 'mock-agent')
  const configuredAgents = addableAgents.filter(isAddedAgentRuntime)
  const runtimeTemplates = addableAgents.filter((agent) => !isAddedAgentRuntime(agent))
  const testingRuntimesOpen = testingAgents.some((agent) => agent.selected)
  const selectedTemplateId = runtimeTemplates.some((agent) => agent.id === runtimeTemplateId)
    ? runtimeTemplateId
    : runtimeTemplates[0]?.id || ''
  const selectedAgentReady = selectedAgent?.status === 'ready'
  const openAddRuntimeByDefault = testingRuntimesOpen && !configuredAgents.length
  const agentCompletionKey = selectedAgentReady
    ? `${selectedAgent.id}:${selectedAgent.protocol}:${selectedAgent.url || ''}:${selectedAgent.settingsUrl || ''}`
    : ''
  const sectionOpen = sectionState.open
  const agentSectionTone = selectedAgent?.status === 'ready'
    ? 'ready'
    : selectedAgent?.status === 'checking'
      ? 'checking'
      : selectedAgent?.status === 'error'
        ? 'error'
        : 'blocked'
  const agentSectionStatus = selectedAgent?.status === 'ready'
    || selectedAgent?.status === 'checking'
    || selectedAgent?.status === 'error'
    ? selectedAgent.status
    : 'setup'

  const addRuntime = () => {
    if (!selectedTemplateId) return
    const nextAgents: AgentConnection[] = agents.map((agent): AgentConnection => (
      agent.id === selectedTemplateId
        ? {
            ...agent,
            selected: true,
            added: true,
            status: agent.url?.trim() ? 'unknown' : 'unavailable',
            error: '',
            diagnostic: undefined,
            capabilities: [],
            latencyMs: undefined,
          }
        : { ...agent, selected: false }
    ))
    onChange(nextAgents)
    const addedAgent = nextAgents.find((agent) => agent.id === selectedTemplateId)
    if (addedAgent) maybeDiscoverAgent(addedAgent)
    setExpandedAgentCardId(selectedTemplateId)
    setAddRuntimeOpen(false)
    setRuntimeTemplateId('')
  }

  const clearAgentRuntime = (agent: AgentConnection) => {
    const nextAgents = resetAgentRuntime(agents, agent.id)
    onChange(nextAgents)
    const selectedRuntime = nextAgents.find((item) => item.selected)
    if (selectedRuntime) maybeDiscoverAgent(selectedRuntime)
    setExpandedAgentCardId('')
    if (!isPrimaryBridgeAgent(agent) && agent.id) {
      setRuntimeTemplateId(agent.id)
      setAddRuntimeOpen(true)
    }
  }

  const renderAgentCard = (agent: AgentConnection, optional = false) => {
    const detailsOpen = expandedAgentCardId === agent.id
    const detailsId = `runtime-card-details-${agent.id}`

    return (
      <article
        className={`agent-runtime-card${agent.selected ? ' selected-runtime' : ''}${optional ? ' optional-runtime-card' : ''}`}
        key={agent.id}
      >
        <div className="runtime-card-summary">
          <button
            className={`runtime-select-action${agent.selected ? ' active' : ''}`}
            type="button"
            aria-pressed={agent.selected}
            aria-label={`${agent.selected ? 'Using' : 'Use'} ${agent.name} runtime`}
            onClick={() => selectAgent(agent)}
            disabled={agent.selected}
          >
            {agent.selected ? 'Using' : 'Use'}
          </button>
          <label className="runtime-card-choice">
            <input
              type="radio"
              name="agent-runtime"
              checked={agent.selected}
              onChange={() => selectAgent(agent)}
            />
            <span>{agent.name}</span>
          </label>
          <span className={`status-chip ${agent.status}`} aria-label={`Agent runtime status ${agent.status}`}>
            {agent.status}
          </span>
          <button
            className="secondary-action compact-action runtime-card-toggle"
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            aria-label={`${detailsOpen ? 'Close setup for' : 'Setup'} ${agent.name}`}
            onClick={() => setExpandedAgentCardId(detailsOpen ? '' : agent.id)}
          >
            {detailsOpen ? 'Done' : '...'}
          </button>
        </div>
        {detailsOpen ? (
          <div className="runtime-card-body" id={detailsId}>
            <RuntimeCardDetails agent={agent} />
            <small className="runtime-mode">
              {runtimeModeLabel(agent)}
              {' · '}
              {runtimeProtocolLabel(agent)}
              {agent.latencyMs ? ` · ${agent.latencyMs}ms` : ''}
            </small>
            {agent.protocol === 'mock-agent' ? (
              <p className="runtime-note">Testing/developer mock for UI, trace, citation, and graph checks.</p>
            ) : null}
            {agent.protocol !== 'mock-agent' ? (
              <div className="runtime-setup-panel" aria-label={isBridgeAgent(agent) ? 'Bridge setup' : 'Runtime setup'}>
                <input
                  value={agent.url || ''}
                  aria-label={isBridgeAgent(agent) ? `${agent.name} bridge URL` : `${agent.name} runtime URL`}
                  placeholder={isBridgeAgent(agent) ? 'http://127.0.0.1:8788' : 'https://runtime.example.com'}
                  onChange={(event) =>
                    updateAgent(agent.id, agentUrlUpdate(event.target.value))
                  }
                  onBlur={(event) => {
                    maybeDiscoverAgent({ ...agent, ...agentUrlUpdate(event.currentTarget.value) })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                />
                <input
                  type="password"
                  value={agent.bearerToken || ''}
                  aria-label={`${agent.name} bearer token`}
                  placeholder="Optional bearer token"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updateAgent(agent.id, agentBearerTokenUpdate(agent, event.target.value))
                  }
                  onBlur={(event) => {
                    maybeDiscoverAgent({ ...agent, ...agentBearerTokenUpdate(agent, event.currentTarget.value) })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                />
                {agent.bearerToken?.trim() ? (
                  <small className="runtime-secret-status">Bearer token set for this tab only.</small>
                ) : null}
                {agent.error ? <p className="error">{agent.error}</p> : null}
                <DiagnosticDetails diagnostic={agent.diagnostic} label="Runtime diagnostic" openByDefault={agent.status === 'error'} />
                <div className="connection-actions">
                  <button
                    type="button"
                    data-manual-connection-test="true"
                    onClick={() => onDiscover(agent)}
                    disabled={agent.status === 'checking' || !agent.url?.trim()}
                  >
                    {agent.status === 'checking'
                      ? isBridgeAgent(agent) ? 'Testing bridge...' : 'Testing runtime...'
                      : isBridgeAgent(agent) ? 'Test bridge' : 'Test runtime'}
                  </button>
                  {runtimeSettingsLinkUrl(agent) ? (
                      <a
                        className="button-link secondary-action"
                        href={runtimeSettingsLinkUrl(agent)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {runtimeSettingsLinkLabel(agent)}
                      </a>
                  ) : isBridgeAgent(agent) ? (
                    <button className="secondary-action" type="button" disabled>
                      Open bridge settings
                    </button>
                  ) : null}
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => clearAgentRuntime(agent)}
                    disabled={!canClearAgentRuntime(agent)}
                  >
                    {isPrimaryBridgeAgent(agent) ? 'Clear bridge' : 'Remove runtime'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <SidebarSection
      className="agent-runtime-section"
      ariaLabel="Agent bridge"
      title="Agent Bridge"
      summary={selectedAgent ? runtimeSummaryLabel(selectedAgent, selectedAgent.status) : 'No runtime selected'}
      tone={agentSectionTone}
      statusLabel={agentSectionStatus}
      open={sectionOpen}
      onToggle={() => setSectionState({ open: !sectionOpen, completionKey: agentCompletionKey })}
      bodyId="agent-runtime-section-body"
    >
      <p className="sidebar-section-guidance">Choose a runtime. Selected or edited endpoints are checked automatically; use the test button to retry.</p>
      <div className="agent-runtime-list" role="radiogroup" aria-label="Agent runtime selection">
        {bridgeAgents.map((agent) => renderAgentCard(agent))}
        {configuredAgents.length ? (
          <div className="configured-runtime-group" aria-label="Added runtimes">
            <div className="runtime-subsection-heading">
              <span>Added runtimes</span>
              <small>{configuredAgents.length} configured or in progress</small>
            </div>
            {configuredAgents.map((agent) => renderAgentCard(agent, true))}
          </div>
        ) : null}
        {runtimeTemplates.length ? (
          <details
            className="add-runtime-disclosure"
            open={addRuntimeOpen || openAddRuntimeByDefault}
            onToggle={(event) => setAddRuntimeOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Add runtime</span>
              <small>Hermes, DeepAgents, Copilot, custom A2A, or another bridge.</small>
            </summary>
            <div className="add-runtime-body">
              <label>
                Runtime type
                <select
                  aria-label="Runtime type"
                  value={selectedTemplateId}
                  onChange={(event) => setRuntimeTemplateId(event.target.value)}
                >
                  {runtimeTemplates.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addRuntime} disabled={!selectedTemplateId}>
                Add runtime
              </button>
            </div>
          </details>
        ) : null}
        {testingAgents.length ? (
          <details
            className="optional-runtime-disclosure testing-runtime-disclosure"
            open={testingRuntimesOpen ? true : undefined}
          >
            <summary>
              <span>Test-only local runtime</span>
              <small>{testingAgents.map((agent) => agent.name).join(', ')}</small>
            </summary>
            <div className="optional-runtime-list">
              {testingAgents.map((agent) => renderAgentCard(agent, true))}
            </div>
          </details>
        ) : null}
      </div>
    </SidebarSection>
  )
}

function SidebarSection({
  className,
  ariaLabel,
  title,
  summary,
  tone,
  statusLabel,
  open,
  onToggle,
  bodyId,
  children,
  sectionRef,
}: {
  className: string
  ariaLabel: string
  title: string
  summary: string
  tone: 'ready' | 'checking' | 'error' | 'blocked'
  statusLabel: string
  open: boolean
  onToggle: () => void
  bodyId: string
  children: ReactNode
  sectionRef?: RefObject<HTMLElement | null>
}) {
  const summaryId = `${bodyId}-summary`

  return (
    <section
      className={`sidebar-section ${className} ${open ? 'is-expanded' : 'is-collapsed'} ${tone}`}
      aria-label={ariaLabel}
      tabIndex={sectionRef ? -1 : undefined}
      ref={sectionRef}
    >
      <div className="sidebar-section-card">
        <div className="sidebar-section-summary">
          <span className="sidebar-section-heading" id={summaryId}>
            <h2>{title}</h2>
            <small>{summary}</small>
          </span>
          <span className={`status-chip ${tone}`} aria-label={`${title} status ${statusLabel}`}>
            {statusLabel}
          </span>
          <button
            className="sidebar-section-toggle"
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-describedby={summaryId}
            aria-label={`${open ? 'Collapse' : 'Configure'} ${title}`}
            onClick={onToggle}
          >
            {open ? 'Done' : 'Open'}
          </button>
        </div>
        <div
          className="sidebar-section-body"
          id={bodyId}
          inert={!open ? true : undefined}
        >
          {children}
        </div>
      </div>
    </section>
  )
}

function AnswerRunDetails({
  scope,
  agentName,
  runtimeStatus,
  turnAudit,
  steps,
  toolCalls,
}: {
  scope?: AnswerScopeSnapshot
  agentName: string
  runtimeStatus: RuntimeStatus
  turnAudit?: TurnAuditMetadata
  steps: AgentStep[]
  toolCalls: AgentToolCallTrace[]
}) {
  const expandedByDefault = runtimeStatus === 'running' || runtimeStatus === 'error'
  const visibleSources = scope?.sources.slice(0, 3) || []
  const hiddenSourceCount = Math.max((scope?.sources.length || 0) - visibleSources.length, 0)
  const runtimeName = scope?.runtime.name || agentName
  const runtimeProtocol = scope?.runtime.protocol || ''
  const runtimeMode = scope?.runtime.mode || ''
  const hasTraceDetails = steps.length > 0 || toolCalls.length > 0
  const label = `${runtimeName} run details`

  return (
    <details className="answer-run-details" aria-label={label} open={expandedByDefault ? true : undefined}>
      <summary className="run-details-summary">
        <strong>Run details</strong>
        <span>{runtimeName}</span>
        <span className={`status-chip ${runtimeStatus}`}>{runtimeStatus}</span>
        {scope ? <span className="scope-chip coverage">{scope.selectedSourceCount} selected / {scope.usedSourceCount} used</span> : null}
        {hasTraceDetails ? <span className="trace-summary">{traceSummary(steps, toolCalls)}</span> : null}
        {scope?.runtime.deterministicMock ? <span className="scope-chip mock">test-only deterministic runtime</span> : null}
      </summary>
      <div className="run-details-body">
        {scope ? (
          <section className="run-detail-section" aria-label="Answer context">
            <strong>Answer context</strong>
            <div className="answer-scope-details">
              <span className="scope-chip strong">Runtime: {runtimeName}</span>
              {runtimeMode ? <span className="scope-chip">mode: {runtimeMode}</span> : null}
              {runtimeProtocol ? <span className="scope-chip">protocol: {runtimeProtocol}</span> : null}
              {visibleSources.map((source) => (
                <span
                  className="scope-chip source"
                  aria-label={`${source.name} source ${source.protocol} ${source.status}`}
                  key={source.id}
                >
                  {source.name} · {source.protocol}
                </span>
              ))}
              {hiddenSourceCount ? <span className="scope-chip">+{hiddenSourceCount} more</span> : null}
            </div>
          </section>
        ) : null}
        {turnAudit ? <TurnAuditDetails audit={turnAudit} /> : null}
        {hasTraceDetails ? (
          <section className="run-detail-section" aria-label="Agent trace">
            <strong>Agent trace</strong>
            {steps.length ? (
              <ol className="agent-steps">
                {steps.map((step) => (
                  <li key={step.id}>
                    <span className={`step-status ${step.status}`}>{step.status}</span>
                    <strong>{step.label}</strong>
                    {step.detail ? <small>{step.detail}</small> : null}
                    {step.error ? <small className="step-error">{step.error}</small> : null}
                    <DiagnosticDetails diagnostic={step.diagnostic} label="Diagnostic" openByDefault={step.status === 'error'} />
                  </li>
                ))}
              </ol>
            ) : null}
            {toolCalls.length ? (
              <div className="tool-call-trace" aria-label="Tool call trace">
                <strong>Tool call trace</strong>
                <ul>
                  {toolCalls.map((call) => (
                    <li key={call.id}>
                      <span>{call.sourceName}</span>
                      <small>{call.sourceProtocol} · {call.status} · {call.detail}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : (
          <p className="run-detail-empty">No agent trace steps were reported for this run.</p>
        )}
      </div>
    </details>
  )
}

function TurnAuditDetails({ audit }: { audit: TurnAuditMetadata }) {
  return (
    <section className="run-detail-section turn-audit" aria-label="Turn audit">
      <strong>Turn audit</strong>
      <p>In-memory redacted client summary. It does not include prompts, answers, endpoint URLs, or tokens.</p>
      <dl className="turn-audit-grid">
        <div>
          <dt>Turn ID</dt>
          <dd>{audit.turnId}</dd>
        </div>
        <div>
          <dt>Runtime mode</dt>
          <dd>{audit.runtimeMode || 'n/a'}</dd>
        </div>
        <div>
          <dt>Runtime protocol</dt>
          <dd>{audit.runtimeProtocol}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{audit.status}</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>{audit.selectedSourceCount} selected · {audit.readySourceCount} ready · {audit.usedSourceCount} used</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{audit.startedAt}</dd>
        </div>
        {audit.completedAt ? (
          <div>
            <dt>Completed</dt>
            <dd>{audit.completedAt}</dd>
          </div>
        ) : null}
        {audit.durationMs !== undefined ? (
          <div>
            <dt>Duration</dt>
            <dd>{audit.durationMs}ms</dd>
          </div>
        ) : null}
        <div>
          <dt>Counts</dt>
          <dd>
            citations {audit.citationCount} · graph nodes {audit.graphNodeCount} · graph edges {audit.graphEdgeCount} · steps {audit.stepCount} · tool calls {audit.toolCallCount}
          </dd>
        </div>
        {audit.requestId ? (
          <div>
            <dt>Request ID</dt>
            <dd>{audit.requestId}</dd>
          </div>
        ) : null}
        {audit.traceId ? (
          <div>
            <dt>Trace ID</dt>
            <dd>{audit.traceId}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}

function traceSummary(steps: AgentStep[], toolCalls: AgentToolCallTrace[]): string {
  const stepCount = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`
  const toolCallCount = `${toolCalls.length} ${toolCalls.length === 1 ? 'tool call' : 'tool calls'}`
  return `${stepCount} · ${toolCallCount}`
}

function ConnectionList({
  connections,
  onChange,
  onDiscover,
  sectionRef,
}: {
  connections: Connection[]
  onChange: (connections: Connection[]) => void
  onDiscover: (connection: Connection) => void
  sectionRef: RefObject<HTMLElement | null>
}) {
  const [draft, setDraft] = useState({
    name: 'New LLMWiki',
    protocol: 'llmwiki-http' as Protocol,
    url: defaultServeUrl(),
  })
  const [sectionState, setSectionState] = useState({ open: false, completionKey: '' })
  const selectedConnections = connections.filter((connection) => connection.selected)
  const readySelectedConnections = selectedConnections.filter((connection) => connection.status === 'ready')
  const selectedSourceKey = sourceSelectionKey(selectedConnections)
  const selectedSourcesReady = selectedConnections.length > 0
    && readySelectedConnections.length === selectedConnections.length
  const sourceCompletionKey = selectedSourcesReady ? selectedSourceKey : ''
  const previousSelectedSourcesReady = useRef(selectedSourcesReady)
  const sectionOpen = sectionState.open
  useEffect(() => {
    const becameReady = selectedSourcesReady && !previousSelectedSourcesReady.current
    previousSelectedSourcesReady.current = selectedSourcesReady
    if (!becameReady) return
    setSectionState((current) => (
      current.open ? { open: false, completionKey: sourceCompletionKey } : current
    ))
  }, [selectedSourcesReady, sourceCompletionKey])
  const selectedSourcesChecking = selectedConnections.some((connection) => connection.status === 'checking')
  const selectedSourcesErrored = selectedConnections.some((connection) => connection.status === 'error')
  const sourceSectionTone = selectedSourcesReady
    ? 'ready'
    : selectedSourcesChecking
      ? 'checking'
      : selectedSourcesErrored
        ? 'error'
        : 'blocked'
  const sourceSectionStatus = selectedSourcesReady
    ? 'ready'
    : selectedSourcesChecking
      ? 'checking'
      : selectedSourcesErrored
        ? 'error'
        : 'setup'

  const maybeDiscoverConnection = (connection: Connection) => {
    if (shouldAutoDiscoverConnection(connection)) onDiscover(connection)
  }

  function addConnection() {
    const cleanUrl = draft.url.trim()
    const cleanName = draft.name.trim()
    if (!cleanUrl || !cleanName) return
    const nextConnection: Connection = {
      id: createId(),
      name: cleanName,
      nameOverride: cleanName !== 'New LLMWiki',
      protocol: draft.protocol,
      url: cleanUrl,
      selected: true,
      status: 'unknown',
    }
    onChange([
      ...connections,
      nextConnection,
    ])
    maybeDiscoverConnection(nextConnection)
  }

  function selectConnection(connection: Connection, selected: boolean) {
    const nextConnection = { ...connection, selected }
    onChange(connections.map((item) => (item.id === connection.id ? nextConnection : item)))
    if (selected) maybeDiscoverConnection(nextConnection)
  }

  function selectOnlyConnection(connection: Connection) {
    const nextConnection = { ...connection, selected: true }
    onChange(connections.map((item) => ({ ...item, selected: item.id === connection.id })))
    maybeDiscoverConnection(nextConnection)
  }

  function updateConnectionUrl(connection: Connection, url: string) {
    onChange(connections.map((item) => (
      item.id === connection.id ? { ...item, ...connectionUrlUpdate(url), selected: true } : item
    )))
  }

  function commitConnectionUrl(connection: Connection, url: string) {
    maybeDiscoverConnection(connectionWithUrl(connection, url))
  }

  function resetConnection(connection: Connection) {
    const nextConnections = resetOrRemoveConnection(connections, connection.id)
    onChange(nextConnections)
    const nextConnection = nextConnections.find((item) => item.id === connection.id)
    if (nextConnection?.selected) maybeDiscoverConnection(nextConnection)
  }

  return (
    <SidebarSection
      className="source-section"
      ariaLabel="Knowledge sources"
      title="Knowledge Sources"
      summary={sourceSummaryLabel(selectedConnections, readySelectedConnections)}
      tone={sourceSectionTone}
      statusLabel={sourceSectionStatus}
      open={sectionOpen}
      onToggle={() => setSectionState({ open: !sectionOpen, completionKey: sourceCompletionKey })}
      bodyId="knowledge-sources-section-body"
      sectionRef={sectionRef}
    >
      <p className="sidebar-section-guidance">Select direct or bridge-managed Knowledge Sources. New, selected, or edited direct endpoints are checked automatically.</p>
      <div className="connection-list">
        {connections.map((connection) => {
          const bridgeManaged = isBridgeManagedConnection(connection)
          return (
          <article className={`connection-card ${bridgeManaged ? 'bridge-managed-source' : ''}`} key={connection.id}>
            <div className="connection-title">
              <label>
                <input
                  type="checkbox"
                  checked={connection.selected}
                  onChange={(event) => selectConnection(connection, event.target.checked)}
                />
                <span>{connection.name}</span>
              </label>
              <div className="connection-state">
                <span className={`origin-chip ${bridgeManaged ? 'bridge' : 'direct'}`}>
                  {bridgeManaged ? 'Bridge source' : 'Direct source'}
                </span>
                <span
                  className={`selection-chip ${connection.selected ? 'selected' : 'not-selected'}`}
                  aria-label={`Source selection ${connection.selected ? 'selected' : 'not selected'}`}
                >
                  {connection.selected ? 'Selected' : 'Not selected'}
                </span>
                <span className={`status-chip ${connection.status}`} aria-label={`Connection status ${connection.status}`}>
                  {connection.status}
                </span>
                <button
                  className="secondary-action compact-action"
                  type="button"
                  onClick={() => resetConnection(connection)}
                >
                  {bridgeManaged ? 'Hide source' : isStarterConnection(connection) ? 'Reset source' : 'Remove source'}
                </button>
              </div>
            </div>
            <ConnectionCardDetails connection={connection} />
            <p className={`status-line ${sourceTestTone(connection)}`} aria-live="polite">
              {sourceTestCopy(connection)}
            </p>
            <details className="source-setup-disclosure" open={connection.status !== 'ready' ? true : undefined}>
              <summary>{bridgeManaged ? 'Source details' : 'Source setup'}</summary>
              <div className="source-setup-body">
                <input
                  value={connection.name}
                  aria-label="Source display label"
                  placeholder="Source display label"
                  readOnly={bridgeManaged}
                  onChange={(event) =>
                    !bridgeManaged && onChange(connections.map((item) => (
                      item.id === connection.id
                        ? { ...item, name: event.target.value, nameOverride: true }
                        : item
                    )))
                  }
                />
                <input
                  value={connection.url}
                  aria-label={`${connection.name} URL`}
                  readOnly={bridgeManaged}
                  onChange={(event) => {
                    if (!bridgeManaged) updateConnectionUrl(connection, event.target.value)
                  }}
                  onBlur={(event) => {
                    if (!bridgeManaged) commitConnectionUrl(connection, event.currentTarget.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                />
                {connection.error ? <p className="error">{connection.error}</p> : null}
                <DiagnosticDetails diagnostic={connection.diagnostic} label="Source diagnostic" openByDefault={connection.status === 'error'} />
                <div className="connection-actions">
                  {bridgeManaged ? (
                    <span className="managed-source-note">Managed by {connection.bridgeSource?.agentName || 'Agent Bridge'}</span>
                  ) : (
                    <button
                      type="button"
                      data-manual-connection-test="true"
                      onClick={() => onDiscover(connection)}
                      disabled={connection.status === 'checking'}
                    >
                      {connection.status === 'checking' ? 'Testing source...' : 'Test source'}
                    </button>
                  )}
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => selectOnlyConnection(connection)}
                  >
                    Use only this source
                  </button>
                </div>
              </div>
            </details>
          </article>
        )})}
      </div>
      <details
        className="add-connection"
        aria-label="Add connection"
        {...(connections.length === 0 ? { open: true } : {})}
      >
        <summary>Add source</summary>
        <div className="add-connection-body">
          <h2>Add connection</h2>
          <label>
            Name
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            Protocol
            <select
              value={draft.protocol}
              onChange={(event) => setDraft({ ...draft, protocol: event.target.value as Protocol })}
            >
              <option value="llmwiki-http">LLMWiki HTTP</option>
              <option value="mcp">MCP</option>
            </select>
          </label>
          <label>
            New connection URL
            <input
              aria-label="New connection URL"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </label>
          <button type="button" onClick={addConnection}>Create source</button>
        </div>
      </details>
    </SidebarSection>
  )
}

function RuntimeCardDetails({ agent }: { agent: AgentConnection }) {
  const capabilities = agent.capabilities || []
  const capabilitySummary = compactCapabilitySummary(capabilities)
  if (!agent.description && !capabilities.length) return null

  return (
    <details className="card-disclosure">
      <summary>Runtime details</summary>
      <div className="card-detail-body">
        {agent.description ? <p>{agent.description}</p> : null}
        {capabilitySummary ? <small>Capabilities: {capabilitySummary}</small> : null}
      </div>
    </details>
  )
}

function ConnectionCardDetails({ connection }: { connection: Connection }) {
  const metaItems = connectionManifestMetaItems(connection)
  const capabilities = connection.capabilities || []
  const capabilitySummary = compactCapabilitySummary(capabilities)
  const technicalSummary = `${connection.protocol}${connection.latencyMs ? ` · ${connection.latencyMs}ms` : ''}`
  if (!connection.description && !metaItems.length && !capabilities.length && !technicalSummary) return null

  return (
    <details className="card-disclosure">
      <summary>Source details</summary>
      <div className="card-detail-body">
        <small>Connection: {technicalSummary}</small>
        {connection.description ? <p>{connection.description}</p> : null}
        <ConnectionManifestMeta connection={connection} />
        {capabilitySummary ? <small>Capabilities: {capabilitySummary}</small> : null}
      </div>
    </details>
  )
}

function ConnectionManifestMeta({ connection }: { connection: Connection }) {
  const items = connectionManifestMetaItems(connection)

  if (!items.length) return null

  return (
    <dl className="connection-meta" aria-label={`${connection.name} manifest metadata`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function connectionManifestMetaItems(connection: Connection): Array<[string, string]> {
  return [
    connection.bridgeSource ? ['Bridge', `${connection.bridgeSource.agentName} · ${connection.bridgeSource.sourceId}`] : null,
    connection.adapter ? ['Adapter', connection.adapter] : null,
    connection.implementation ? ['Implementation', connection.implementation] : null,
    typeof connection.pageCount === 'number' ? ['Pages', `${connection.approvedPageCount ?? 0}/${connection.pageCount} approved`] : null,
  ].filter((item): item is [string, string] => Boolean(item))
}

function compactCapabilitySummary(capabilities: string[]): string {
  if (!capabilities.length) return ''
  const visible = capabilities.slice(0, 4).join(', ')
  return capabilities.length > 4 ? `${visible}, +${capabilities.length - 4} more` : visible
}

function KnowledgeMapSummary({
  activeMode,
  answerGraphAvailable,
  answerGraphSelectionDiffers,
  graph,
  selectedConnections,
  readyConnections,
  sourceCount,
  sourceNames,
  onSelectAnswer,
  onExploreSources,
}: {
  activeMode: GraphMode
  answerGraphAvailable: boolean
  answerGraphSelectionDiffers: boolean
  graph: KnowledgeGraph
  selectedConnections: Connection[]
  readyConnections: Connection[]
  sourceCount: number
  sourceNames: string[]
  onSelectAnswer: () => void
  onExploreSources: () => void
}) {
  const sourceIntro = selectedKnowledgeSourceIntro(selectedConnections, readyConnections)
  const graphOverview = graphOverviewLabel(graph)
  const inAnswerMode = activeMode === 'answer'
  const scopeTitle = inAnswerMode ? 'Selected answer evidence' : sourceIntro.title
  const description = inAnswerMode
    ? 'Citations and page links from the selected answer stay available for drill-down.'
    : sourceIntro.description
  const statusText = knowledgeMapStatus(activeMode, answerGraphSelectionDiffers, sourceCount)
  const statusTone = answerGraphSelectionDiffers ? 'checking' : sourceCount ? 'ready' : 'blocked'

  return (
    <section className="panel knowledge-map-summary" aria-label="Knowledge map">
      <div className="map-title-row">
        <div>
          <p>{inAnswerMode ? 'Evidence scope' : 'Map scope'}</p>
          <strong>{scopeTitle}</strong>
          <span>{description}</span>
        </div>
        <span className={`status-chip ${statusTone}`}>{sourceCount} source{sourceCount === 1 ? '' : 's'}</span>
      </div>
      <div className="map-overview" aria-label="Graph overview">
        {graphOverview.map((item) => (
          <span key={item.label}>
            <strong>{item.value}</strong>
            {item.label}
          </span>
        ))}
      </div>
      {answerGraphAvailable ? (
        <div className="graph-scope-controls" role="group" aria-label="Evidence graph scope">
          <button
            type="button"
            aria-pressed={activeMode === 'answer'}
            disabled={!answerGraphAvailable}
            onClick={onSelectAnswer}
          >
            Answer evidence
          </button>
          <button type="button" aria-pressed={activeMode === 'selection'} onClick={onExploreSources}>
            Current source map
          </button>
        </div>
      ) : null}
      <p className={`status-line ${statusTone}`} aria-live="polite">
        {statusText}
      </p>
      {sourceNames.length ? <small>{sourceNames.slice(0, 3).join(', ')}{sourceNames.length > 3 ? `, +${sourceNames.length - 3} more` : ''}</small> : null}
    </section>
  )
}

function DetailsPanel({
  citation,
  graph,
  sources,
  selectedNodeId,
  pageRead,
  scopeLabel,
  emptyCopy,
  onSelectNode,
  onBackToAnswer,
}: {
  citation: Citation | null
  graph: KnowledgeGraph
  sources: ScopeSourceSnapshot[]
  selectedNodeId: string
  pageRead: PageReadCacheEntry | null
  scopeLabel: string
  emptyCopy: string
  onSelectNode: (nodeId: string) => void
  onBackToAnswer?: () => void
}) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedNodeSource = selectedNode ? sourceForGraphNode(selectedNode.id, sources) : null
  const citationSource = citation ? sourceForCitation(citation, sources) : null
  const headings = selectedNode ? relatedNodes(graph, selectedNode.id, 'contains') : []
  const sourceRefs = selectedNode ? relatedNodes(graph, selectedNode.id, 'cites') : []
  const outgoingLinks = selectedNode ? relatedNodes(graph, selectedNode.id, 'links_to') : []
  const incomingLinks = selectedNode
    ? graph.edges
        .filter((edge) => edge.relation === 'links_to' && edge.target === selectedNode.id)
        .map((edge) => graph.nodes.find((node) => node.id === edge.source))
        .filter((node): node is KnowledgeGraph['nodes'][number] => Boolean(node))
    : []
  const hasRelatedDetails = Boolean(headings.length || sourceRefs.length || outgoingLinks.length || incomingLinks.length)
  const canReturnToAnswer = Boolean(citation && onBackToAnswer)

  return (
    <section id="details-panel" className="panel details-panel" aria-label="Details" aria-live="polite" tabIndex={-1}>
      <div className="details-heading">
        <h2>Details</h2>
        {canReturnToAnswer ? (
          <div className="details-actions">
            <button type="button" className="back-to-answer" onClick={onBackToAnswer}>
              Back to answer
            </button>
          </div>
        ) : null}
      </div>
      <p className="detail-scope-note">{scopeLabel}</p>
      {selectedNode ? (
        <>
          {citation ? <CitationEvidence citation={citation} source={citationSource} /> : null}
          {citation ? (
            <details className="detail-disclosure">
              <summary>Selected page metadata</summary>
              <NodeMetadata node={selectedNode} source={selectedNodeSource} />
            </details>
          ) : (
            <NodeMetadata node={selectedNode} source={selectedNodeSource} />
          )}
          {isPageNode(selectedNode) ? <PageMarkdown pageRead={pageRead} graph={graph} onSelectNode={onSelectNode} /> : null}
          {hasRelatedDetails ? (
            <details className="detail-disclosure detail-related-disclosure" open={!citation}>
              <summary>Related context</summary>
              <div className="detail-related">
                <DetailList title="Headings" values={headings.map((node) => node.label)} />
                <DetailList title="Source refs" values={sourceRefs.map((node) => node.label)} />
                <RelatedNodeList
                  title="Links out"
                  nodes={outgoingLinks}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
                <RelatedNodeList
                  title="Links in"
                  nodes={incomingLinks}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
              </div>
            </details>
          ) : null}
        </>
      ) : citation ? (
        <CitationEvidence citation={citation} source={citationSource} />
      ) : (
        <p>{emptyCopy}</p>
      )}
    </section>
  )
}

function PageMarkdown({
  pageRead,
  graph,
  onSelectNode,
}: {
  pageRead: PageReadCacheEntry | null
  graph: KnowledgeGraph
  onSelectNode: (nodeId: string) => void
}) {
  if (!pageRead) return null

  const displayMarkdown = pageMarkdownForDisplay(pageRead.markdown)

  return (
    <article className="page-markdown-card" aria-label="Selected page markdown">
      <div className="page-markdown-heading">
        <strong>Rendered page</strong>
        {pageRead.path ? <span>{pageRead.path}</span> : null}
      </div>
      {pageRead.status === 'loading' ? (
        <p className="status-line checking">Loading full markdown...</p>
      ) : pageRead.status === 'error' ? (
        <p className="status-line error">{pageRead.error || 'Could not load page markdown.'}</p>
      ) : pageRead.markdown.trim() ? (
        <div className="page-markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
            skipHtml
            components={{
              p({ children, node, ...props }) {
                void node
                const rowChildren = wikiLinkRowChildren(children)
                if (rowChildren) {
                  return (
                    <nav className="wiki-link-row" aria-label="Page links">
                      {rowChildren}
                    </nav>
                  )
                }
                return <p {...props}>{children}</p>
              },
              a({ href, children, node, ...props }) {
                void node
                const wikiTarget = wikiTargetFromHref(href)
                if (!wikiTarget) return <a href={href} {...props}>{children}</a>

                const targetNode = pageNodeForWikiTarget(graph, wikiTarget)
                if (!targetNode) {
                  return (
                    <span className="wiki-link" title={wikiTarget} data-wiki-link="true">
                      {children}
                    </span>
                  )
                }

                return (
                  <button
                    type="button"
                    className="wiki-link wiki-link-button"
                    title={wikiTarget}
                    data-wiki-link="true"
                    aria-controls="details-panel"
                    onClick={() => onSelectNode(targetNode.id)}
                  >
                    {children}
                  </button>
                )
              },
            }}
          >
            {displayMarkdown}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="status-line blocked">No markdown was returned for this page.</p>
      )}
    </article>
  )
}

function pageMarkdownForDisplay(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const displayLine = line
        .split(/(`[^`]*`)/g)
        .map((segment) => segment.startsWith('`') ? segment : replaceWikiLinks(segment))
        .join('')
      return wikiLinkNavigationLinePattern.test(line) ? `\n${displayLine}\n` : displayLine
    })
    .join('\n')
}

function replaceWikiLinks(value: string): string {
  return value.replace(/\[\[([^[\]\n]+?)\]\]/g, (_, rawInner: string) => {
    const link = parseWikiLink(rawInner)
    if (!link.target) return rawInner
    return `[${escapeMarkdownLinkText(link.label)}](${wikiLinkHref(link.target)})`
  })
}

function parseWikiLink(rawInner: string): { target: string; label: string } {
  const [rawTarget = '', rawLabel = ''] = rawInner.split('|')
  const target = rawTarget.trim()
  const label = rawLabel.trim() || wikiLinkDefaultLabel(target)
  return { target, label }
}

function wikiLinkDefaultLabel(target: string): string {
  const withoutHeading = target.split('#').filter(Boolean).at(-1) || target
  const basename = withoutHeading.split(/[\\/]/).filter(Boolean).at(-1) || withoutHeading
  return basename.trim() || target
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1')
}

function wikiLinkHref(target: string): string {
  return `${wikiLinkHrefPrefix}${encodeURIComponent(target)}`
}

function wikiTargetFromHref(href: string | undefined): string {
  if (!href?.startsWith(wikiLinkHrefPrefix)) return ''
  try {
    return decodeURIComponent(href.slice(wikiLinkHrefPrefix.length))
  } catch {
    return href.slice(wikiLinkHrefPrefix.length)
  }
}

type WikiLinkElementProps = {
  'data-wiki-link'?: string
  href?: string
}

function wikiLinkRowChildren(children: ReactNode): ReactNode[] | null {
  const childItems = Children.toArray(children)
  const rowChildren: ReactNode[] = []

  for (const child of childItems) {
    if (isWikiLinkElement(child)) {
      rowChildren.push(child)
      continue
    }

    if (typeof child === 'string' && wikiLinkSeparatorPattern.test(child)) continue
    return null
  }

  return rowChildren.length >= 2 ? rowChildren : null
}

function isWikiLinkElement(child: ReactNode): child is ReactElement<WikiLinkElementProps> {
  if (!isValidElement<WikiLinkElementProps>(child)) return false
  return child.props['data-wiki-link'] === 'true' || Boolean(child.props.href?.startsWith(wikiLinkHrefPrefix))
}

function pageNodeForWikiTarget(
  graph: KnowledgeGraph,
  target: string,
): KnowledgeGraph['nodes'][number] | null {
  const targetWithoutHeading = target.split('#')[0]?.trim() || target.trim()
  const targetCandidates = wikiTargetCandidates(targetWithoutHeading)
  if (!targetCandidates.size) return null

  return pageNodesForDisplay(graph).find((node) => {
    const nodeCandidates = new Set([
      ...wikiTargetCandidates(node.label),
      ...wikiTargetCandidates(node.path || ''),
      ...wikiTargetCandidates(graphNodeBaseId(node.id).replace(/^page:/, '')),
    ])
    return [...targetCandidates].some((candidate) => nodeCandidates.has(candidate))
  }) || null
}

function wikiTargetCandidates(value: string): Set<string> {
  const clean = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const withoutExtension = clean.replace(/\.[^.]+$/, '')
  const basename = withoutExtension.split('/').filter(Boolean).at(-1) || withoutExtension
  return new Set([
    normalizedPath(clean),
    normalizedPath(withoutExtension),
    normalizedPath(basename),
    normalizedComparableText(clean),
    normalizedComparableText(withoutExtension),
    normalizedComparableText(basename),
  ].filter(Boolean))
}

function NodeMetadata({
  node,
  source,
}: {
  node: KnowledgeGraph['nodes'][number]
  source: ScopeSourceSnapshot | null
}) {
  return (
    <article className="detail-primary" aria-label="Selected page metadata">
      <strong className="detail-title">{node.label}</strong>
      <dl className="detail-meta">
        <div>
          <dt>Kind</dt>
          <dd>{node.kind}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{node.path || 'n/a'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{sourceLabel(source)}</dd>
        </div>
      </dl>
    </article>
  )
}

function CitationEvidence({ citation, source }: { citation: Citation; source: ScopeSourceSnapshot | null }) {
  return (
    <article className="citation-evidence" aria-label="Citation evidence">
      <strong className="citation-title">{citation.title}</strong>
      <p className="citation-snippet">{citation.snippet || 'No snippet provided.'}</p>
      <dl className="detail-meta citation-primary-meta">
        <div>
          <dt>Path</dt>
          <dd>{citation.path || 'n/a'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{sourceLabel(source)}</dd>
        </div>
      </dl>
      <details className="detail-disclosure citation-support">
        <summary>Citation reference details</summary>
        <dl className="detail-meta">
          <div>
            <dt>Source refs</dt>
            <dd>{citation.sourceRefs.join(', ') || 'n/a'}</dd>
          </div>
        </dl>
      </details>
    </article>
  )
}

function DetailList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null
  return (
    <div className="detail-list">
      <strong>{title}</strong>
      <ul>
        {values.map((value, index) => (
          <li key={`${value}:${index}`}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

function RelatedNodeList({
  title,
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  title: string
  nodes: Array<KnowledgeGraph['nodes'][number]>
  selectedNodeId: string
  onSelectNode: (nodeId: string) => void
}) {
  if (!nodes.length) return null
  return (
    <div className="detail-list detail-node-links">
      <strong>{title}</strong>
      <ul>
        {nodes.map((node) => (
          <li key={`${title}:${node.id}`}>
            <button
              type="button"
              className="detail-node-link"
              aria-pressed={selectedNodeId === node.id}
              aria-label={`${node.label} ${node.kind}`}
              aria-controls="details-panel"
              onClick={() => onSelectNode(node.id)}
            >
              <span>{node.label}</span>
              <span className="node-kind">{node.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GraphExplorer({
  graph,
  title,
  emptyTitle,
  emptyDescription,
  selectionPrompt,
  selectedNodeId,
  onSelectNode,
}: {
  graph: KnowledgeGraph
  title: string
  emptyTitle: string
  emptyDescription: string
  selectionPrompt: string
  selectedNodeId: string
  onSelectNode: (nodeId: string) => void
}) {
  const pageNodes = pageNodesForDisplay(graph)
  const visibleNodes = pageNodes
  const positions = new Map(visibleNodes.map((node, index) => [node.id, point(index, visibleNodes.length)]))
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = graph.edges
    .filter((edge) => edge.relation === 'links_to' && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .slice(0, graphMapEdgeLimit)
  const activeNodeId = visibleNodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : ''
  const activeNode = visibleNodes.find((node) => node.id === activeNodeId)
  const selectedGraphNode = graph.nodes.find((node) => node.id === selectedNodeId)
  const selectionSummary = selectedGraphNode
    ? graphNodeSelectionSummary(graph, selectedGraphNode)
    : selectionPrompt
  const showPersistentLabels = visibleNodes.length <= 6

  return (
    <section className="panel graph-panel" aria-label="Graph">
      <div className="panel-heading">
        <h2>{title}</h2>
        {visibleNodes.length ? (
          <span>
            {visibleNodes.length === pageNodes.length
              ? `${visibleNodes.length} pages`
              : `${visibleNodes.length} of ${pageNodes.length} pages`}
          </span>
        ) : null}
      </div>
      {visibleNodes.length ? (
        <>
          <svg viewBox="0 0 360 220" role="group" aria-label="Knowledge graph overview">
            {visibleEdges.map((edge, index) => {
              const a = positions.get(edge.source)
              const b = positions.get(edge.target)
              if (!a || !b) return null
              const selected = edge.source === activeNodeId || edge.target === activeNodeId
              return (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  key={`${edge.source}-${edge.target}-${index}`}
                  className={selected ? 'selected-edge' : undefined}
                />
              )
            })}
            {visibleNodes.map((node, index) => {
              const p = positions.get(node.id) ?? point(index, visibleNodes.length)
              const selected = activeNodeId === node.id
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  className="graph-node"
                  aria-label={`Select graph node ${node.label} (${node.kind})`}
                  aria-pressed={selected}
                  aria-controls="details-panel"
                  onClick={() => onSelectNode(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectNode(node.id)
                    }
                  }}
                >
                  <title>{node.label}</title>
                  {selected ? <circle cx={p.x} cy={p.y} r={graphNodeHaloRadius(visibleNodes.length)} className="selected-node-halo" aria-hidden="true" /> : null}
                  <circle cx={p.x} cy={p.y} r={graphNodeHitRadius(visibleNodes.length)} className="node-hit-target" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={graphNodeRadius(node, visibleNodes.length)}
                    className={`node-${node.kind}${selected ? ' selected-node' : ''}`}
                  />
                </g>
              )
            })}
            {visibleNodes.map((node, index) => {
              const p = positions.get(node.id) ?? point(index, visibleNodes.length)
              const selected = activeNodeId === node.id
              const showLabel = showPersistentLabels || selected
              return showLabel ? (
                <text
                  x={graphNodeLabelX(p)}
                  y={graphNodeLabelY(p)}
                  textAnchor={graphNodeTextAnchor(p)}
                  className={`node-label${selected ? ' selected-node-label' : ''}`}
                  aria-hidden="true"
                  key={`${node.id}-label`}
                >
                  {compactGraphNodeLabel(node)}
                </text>
              ) : null
            })}
          </svg>
          <GraphLegend />
          <p className="selection-summary" aria-live="polite">
            {selectionSummary}
          </p>
          {!activeNode && selectedGraphNode ? (
            <p className="selection-summary muted-selection-summary">
              Selected item is listed below but is not a page in this map view.
            </p>
          ) : null}
        </>
      ) : (
        <div className="graph-empty-state" role="status">
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      )}
    </section>
  )
}

function GraphLegend() {
  return (
    <div className="graph-legend" aria-label="Map legend">
      <span>
        <span className="legend-dot legend-dot-page" aria-hidden="true" />
        Topic page
      </span>
      <span>
        <span className="legend-dot legend-dot-focus" aria-hidden="true" />
        Focus/index page
      </span>
      <span>
        <span className="legend-line" aria-hidden="true" />
        Page link
      </span>
      <span>
        <span className="legend-ring" aria-hidden="true" />
        Selected page
      </span>
    </div>
  )
}

function graphNodeSelectionSummary(
  graph: KnowledgeGraph,
  node: KnowledgeGraph['nodes'][number],
): string {
  const outgoingLinkCount = graph.edges.filter((edge) => edge.relation === 'links_to' && edge.source === node.id).length
  const incomingLinkCount = graph.edges.filter((edge) => edge.relation === 'links_to' && edge.target === node.id).length
  const sourceRefCount = graph.edges.filter((edge) => edge.relation === 'cites' && edge.source === node.id).length

  return [
    `Selected: ${node.label} (${node.kind})`,
    countPhrase(outgoingLinkCount, 'link out', 'links out'),
    countPhrase(incomingLinkCount, 'link in', 'links in'),
    countPhrase(sourceRefCount, 'source ref', 'source refs'),
  ].join(' - ')
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function graphNodeLabelX(point: { x: number; y: number }): number {
  if (point.x < 100) return point.x + 15
  if (point.x > 260) return point.x - 15
  return point.x
}

function graphNodeLabelY(point: { x: number; y: number }): number {
  if (point.y > 118) return point.y - 17
  return point.y + 24
}

function graphNodeTextAnchor(point: { x: number; y: number }): 'start' | 'middle' | 'end' {
  if (point.x < 100) return 'start'
  if (point.x > 260) return 'end'
  return 'middle'
}

function graphNodeRadius(node: KnowledgeGraph['nodes'][number], total: number): number {
  if (total > 180) return node.kind === 'source_ref' ? 3 : 4
  if (total > 90) return node.kind === 'source_ref' ? 4 : 5
  return node.kind === 'source_ref' ? 5 : 8
}

function graphNodeHitRadius(total: number): number {
  if (total > 180) return 7
  if (total > 90) return 10
  return 15
}

function graphNodeHaloRadius(total: number): number {
  if (total > 180) return 8
  if (total > 90) return 11
  return 14
}

function compactGraphNodeLabel(node: KnowledgeGraph['nodes'][number]): string {
  const label = node.label.trim() || node.id
  return label.length > 22 ? `${label.slice(0, 19)}...` : label
}

function NodeList({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: KnowledgeGraph
  selectedNodeId: string
  onSelectNode: (nodeId: string) => void
}) {
  const pageNodes = pageNodesForDisplay(graph)

  return (
    <section className="panel node-list-panel" aria-label="Pages">
      <div className="panel-heading">
        <h2>Pages</h2>
        {pageNodes.length ? <span>{pageNodes.length} pages</span> : null}
      </div>
      {pageNodes.length ? (
        <ul>
          {pageNodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className={selectedNodeId === node.id ? 'selected-list-node' : undefined}
                aria-pressed={selectedNodeId === node.id}
                aria-label={`${node.label} ${node.kind}`}
                aria-controls="details-panel"
                onClick={() => onSelectNode(node.id)}
              >
                <span className="node-list-label">{node.label}</span>
                <span className="node-kind">{node.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No pages loaded yet.</p>
      )}
    </section>
  )
}

function isPageNode(node: KnowledgeGraph['nodes'][number]): boolean {
  return graphNodeBaseId(node.id).startsWith('page:') || node.kind === 'page' || pageNodeKinds.has(node.kind)
}

function pageNodesForDisplay(graph: KnowledgeGraph): Array<KnowledgeGraph['nodes'][number]> {
  return graph.nodes
    .filter(isPageNode)
    .sort((a, b) => {
      const rankDiff = (pageNodeKindRank.get(a.kind) ?? 99) - (pageNodeKindRank.get(b.kind) ?? 99)
      if (rankDiff) return rankDiff
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
    })
}

function relatedNodes(
  graph: KnowledgeGraph,
  sourceNodeId: string,
  relation: string,
): Array<KnowledgeGraph['nodes'][number]> {
  return graph.edges
    .filter((edge) => edge.relation === relation && edge.source === sourceNodeId)
    .map((edge) => graph.nodes.find((node) => node.id === edge.target))
    .filter((node): node is KnowledgeGraph['nodes'][number] => Boolean(node))
}

function sourceForGraphNode(nodeId: string, sources: ScopeSourceSnapshot[]): ScopeSourceSnapshot | null {
  const [, sourceId] = nodeId.split('::')
  if (!sourceId) return sources.length === 1 ? sources[0] : null
  return sources.find((source) => source.id === sourceId) || null
}

function sourceForCitation(citation: Citation, sources: ScopeSourceSnapshot[]): ScopeSourceSnapshot | null {
  return sources.find((source) => source.id === citation.connectionId) || (sources.length === 1 ? sources[0] : null)
}

function sourceLabel(source: ScopeSourceSnapshot | null): string {
  return source ? `${source.name} · ${source.protocol} · ${source.status}` : 'n/a'
}

function graphFromSelectedReadySources(connections: Connection[]): KnowledgeGraph {
  const selectedGraphs = connections
    .filter((connection) => connection.selected && connection.status === 'ready' && connection.graph)
    .map((connection) => namespaceGraph(connection.graph as KnowledgeGraph, connection))
  return selectedGraphs.length ? mergeGraphs(selectedGraphs) : emptyGraph()
}

function sourceGraphKey(connections: Connection[]): string {
  return connections
    .map((connection) => [
      connection.id,
      connection.protocol,
      connection.url,
      connection.latencyMs ?? '',
      connection.graph?.nodes.length ?? 0,
      connection.graph?.edges.length ?? 0,
    ].join(':'))
    .join('|')
}

function sourceSelectionKey(connections: Connection[]): string {
  return connections
    .map((connection) => [
      connection.id,
      connection.protocol,
      connection.url,
      connection.status,
    ].join(':'))
    .join('|')
}

function sourceScopeSnapshot(connection: Connection): ScopeSourceSnapshot {
  return {
    id: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    url: connection.url,
    status: connection.status,
  }
}

function pageReadRequestForNode(
  node: KnowledgeGraph['nodes'][number],
  source: ScopeSourceSnapshot,
): PageReadRequest | null {
  const pageId = pageReadIdForNode(node)
  if (!pageId) return null
  return {
    cacheKey: pageReadCacheKey(source, pageId),
    pageId,
    source,
  }
}

function pageReadIdForNode(node: KnowledgeGraph['nodes'][number]): string {
  const path = node.path?.trim()
  if (path) return path
  const baseId = graphNodeBaseId(node.id).trim()
  return baseId.startsWith('page:') ? baseId.slice('page:'.length) : baseId
}

function pageReadCacheKey(source: ScopeSourceSnapshot, pageId: string): string {
  return [source.id, source.protocol, source.url, pageId].join('\u0001')
}

function loadingPageReadEntry(node: KnowledgeGraph['nodes'][number]): PageReadCacheEntry {
  return {
    status: 'loading',
    markdown: '',
    title: node.label,
    path: node.path || pageReadIdForNode(node),
    error: '',
  }
}

async function readPageForSource(
  source: ScopeSourceSnapshot,
  pageId: string,
  signal?: AbortSignal,
): Promise<KnowledgePage> {
  const connection = connectionFromScopeSource(source)
  if (!connection.url.trim()) {
    throw new Error(`No endpoint URL is available for ${source.name}.`)
  }

  return clientFor(connection).readPage(connection, pageId, signal)
}

function connectionFromScopeSource(source: ScopeSourceSnapshot): Connection {
  return {
    id: source.id,
    name: source.name,
    protocol: source.protocol,
    url: source.url,
    selected: true,
    status: source.status,
  }
}

function createAnswerScopeSnapshot(
  agent: AgentConnection,
  selectedSources: Connection[],
  usedSources: Connection[],
  runtimeStatus: RuntimeStatus,
): AnswerScopeSnapshot {
  return {
    runtime: {
      name: agent.name,
      status: runtimeStatus,
      mode: runtimeModeLabel(agent),
      protocol: agent.protocol,
      deterministicMock: agent.protocol === 'mock-agent',
    },
    selectedSourceCount: selectedSources.length,
    usedSourceCount: usedSources.length,
    sources: usedSources.map(sourceScopeSnapshot),
  }
}

function runtimeConversationMessages(messages: UiChatMessage[], latestUserTurn: string): AgentRuntimeMessage[] {
  const priorMessages = messages
    .map(runtimeConversationMessage)
    .filter((message): message is AgentRuntimeMessage => Boolean(message))
  const combined: AgentRuntimeMessage[] = [
    ...priorMessages,
    { role: 'user', content: latestUserTurn.trim() },
  ]
  return combined.filter((message) => message.content).slice(-runtimeConversationMessageLimit)
}

function runtimeConversationMessage(message: UiChatMessage): AgentRuntimeMessage | null {
  const content = message.text.trim()
  if (!content) return null
  return { role: message.role, content }
}

function createTurnAuditMetadata(
  turnId: string,
  agent: AgentConnection,
  selectedSources: Connection[],
  readySources: Connection[],
  graph: KnowledgeGraph,
  startedAt: string,
): TurnAuditMetadata {
  return {
    turnId,
    runtimeMode: runtimeModeLabel(agent),
    runtimeProtocol: agent.protocol,
    selectedSourceCount: selectedSources.length,
    readySourceCount: readySources.length,
    usedSourceCount: 0,
    startedAt,
    status: 'running',
    citationCount: 0,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
    stepCount: 0,
    toolCallCount: 0,
  }
}

function completeTurnAuditMetadata(
  audit: TurnAuditMetadata | undefined,
  sources: ScopeSourceSnapshot[],
  status: RuntimeStatus,
  completedAt: string,
  citations: Citation[],
  graph: KnowledgeGraph,
  steps: AgentStep[],
  toolCalls: AgentToolCallTrace[],
): TurnAuditMetadata | undefined {
  if (!audit) return undefined
  const ids = safeTurnAuditIds(steps)
  return {
    ...audit,
    completedAt,
    durationMs: turnAuditDurationMs(audit.startedAt, completedAt),
    status,
    citationCount: citations.length,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
    stepCount: steps.length,
    toolCallCount: turnAuditToolCallCount(steps, toolCalls),
    usedSourceCount: turnAuditUsedSourceCount(sources, steps, citations, toolCalls),
    ...(ids.requestId ? { requestId: ids.requestId } : {}),
    ...(ids.traceId ? { traceId: ids.traceId } : {}),
  }
}

function turnAuditDurationMs(startedAt: string, completedAt: string): number | undefined {
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return undefined
  return Math.max(0, completed - started)
}

function turnAuditToolCallCount(steps: AgentStep[], toolCalls: AgentToolCallTrace[]): number {
  return toolCalls.length || steps.filter((step) => Boolean(step.toolName)).length
}

function turnAuditUsedSourceCount(
  sources: ScopeSourceSnapshot[],
  steps: AgentStep[],
  citations: Citation[],
  toolCalls: AgentToolCallTrace[],
): number {
  const readySourceIds = new Set(sources.map((source) => source.id))
  const usedIds = new Set<string>()
  steps.forEach((step) => {
    if (step.connectionId && readySourceIds.has(step.connectionId)) usedIds.add(step.connectionId)
  })
  citations.forEach((citation) => {
    if (citation.connectionId && readySourceIds.has(citation.connectionId)) usedIds.add(citation.connectionId)
  })
  toolCalls.forEach((call) => {
    if (readySourceIds.has(call.id)) usedIds.add(call.id)
  })
  return usedIds.size
}

function safeTurnAuditIds(steps: AgentStep[]): { requestId?: string; traceId?: string } {
  return {
    requestId: firstSafeAuditId(steps.flatMap((step) => [
      step.requestId,
      step.diagnostic?.requestId,
    ])),
    traceId: firstSafeAuditId(steps.flatMap((step) => [
      step.traceId,
      step.diagnostic?.traceId,
    ])),
  }
}

function firstSafeAuditId(values: Array<string | undefined>): string | undefined {
  return values.map(safeAuditId).find(Boolean)
}

function safeAuditId(value: string | undefined): string | undefined {
  const clean = value?.trim()
  if (!clean) return undefined
  if (clean.length > 128) return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(clean)) return undefined
  if (/^(?:https?|wss?):/i.test(clean)) return undefined
  if (/(?:bearer|token|secret|password|sk-[A-Za-z0-9_-]|sk-proj-[A-Za-z0-9_-])/i.test(clean)) return undefined
  return clean
}

function localIoLogRuntimeRequest(request: AgentRuntimeRequestLog): LocalIoLogEntry['request'] {
  return {
    transport: request.transport,
    summary: request.summary,
    body: request.body,
  }
}

function localIoLogResponseMetadata(
  status: RuntimeStatus,
  completedAt: string,
  citations: Citation[],
  graph: KnowledgeGraph,
  steps: AgentStep[],
  toolCalls: AgentToolCallTrace[],
): Record<string, unknown> {
  return {
    status,
    completedAt,
    citationCount: citations.length,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
    stepCount: steps.length,
    toolCallCount: toolCalls.length,
    ...safeTurnAuditIds(steps),
    steps: steps.map(localIoLogStepMetadata),
  }
}

function localIoLogStepMetadata(step: AgentStep): Record<string, unknown> {
  const requestId = safeAuditId(step.requestId)
  const traceId = safeAuditId(step.traceId)
  return {
    id: step.id,
    label: step.label,
    status: step.status,
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.error ? { error: step.error } : {}),
    ...(step.runtimeId ? { runtimeId: step.runtimeId } : {}),
    ...(step.toolName ? { toolName: step.toolName } : {}),
    ...(step.connectionId ? { connectionId: step.connectionId } : {}),
    ...(step.citationIds?.length ? { citationIds: step.citationIds } : {}),
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(step.diagnostic ? { diagnostic: step.diagnostic } : {}),
  }
}

function updateAnswerScopeRuntimeStatus(
  scope: AnswerScopeSnapshot | undefined,
  runtimeStatus: RuntimeStatus,
): AnswerScopeSnapshot | undefined {
  if (!scope) return scope
  return {
    ...scope,
    runtime: {
      ...scope.runtime,
      status: runtimeStatus,
    },
  }
}

function orderRunResultForDisplay(
  agent: AgentConnection,
  answer: string,
  citations: Citation[],
  graph: KnowledgeGraph,
  steps: AgentStep[],
): { answer: string; citations: Citation[]; citationReferenceIds?: string[] } {
  if (agent.protocol === 'mock-agent' || citations.length < 2) return { answer, citations }

  const citationIdsInReadOrder = citationStepIdOrder(steps)
  const ranked = citations.map((citation, index) => ({
    citation,
    originalIndex: index,
    stepRank: citationStepIdRank(citation, citationIdsInReadOrder),
    graphRank: citationGraphRank(citation, graph),
  }))

  ranked.sort((a, b) =>
    a.stepRank - b.stepRank
    || a.graphRank - b.graphRank
    || a.originalIndex - b.originalIndex
  )

  if (ranked.every((item, index) => item.originalIndex === index)) {
    return { answer, citations }
  }

  return {
    answer,
    citations: ranked.map((item) => item.citation),
    citationReferenceIds: citations.map((citation) => citation.id),
  }
}

function citationGraphRank(citation: Citation, graph: KnowledgeGraph): number {
  const graphNodeId = graphNodeIdForCitation(citation, graph)
  const graphNode = graphNodeId ? graph.nodes.find((node) => node.id === graphNodeId) : null
  const kindRank = graphNode ? pageNodeKindRank.get(graphNode.kind) : undefined
  return Math.min(kindRank ?? 99, citationPathRank(citation), citationTitleRank(citation))
}

function citationPathRank(citation: Citation): number {
  const cleanPath = normalizedPath(citation.path)
  const basename = cleanPath.split('/').filter(Boolean).at(-1)?.replace(/\.[^.]+$/, '') || cleanPath
  if (basename === 'hot') return 0
  if (basename === 'index') return 1
  if (basename === 'overview') return 2
  return 99
}

function citationTitleRank(citation: Citation): number {
  const title = normalizedComparableText(citation.title)
  if (title === 'current focus' || title === 'hot') return 0
  if (title === 'wiki index' || title === 'index') return 1
  if (title === 'overview') return 2
  return 99
}

function citationStepIdOrder(steps: AgentStep[]): string[] {
  return steps
    .flatMap((step) => step.citationIds || [])
    .map(normalizeCitationReference)
    .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index)
}

function citationStepIdRank(citation: Citation, orderedIds: string[]): number {
  if (!orderedIds.length) return 99
  const identities = citationReferenceIdentities(citation)
  const index = orderedIds.findIndex((id) => identities.includes(id))
  return index < 0 ? 99 : index
}

function citationReferenceIdentities(citation: Citation): string[] {
  const withoutConnection = citation.connectionId && citation.id.startsWith(`${citation.connectionId}:`)
    ? citation.id.slice(citation.connectionId.length + 1)
    : ''
  return [
    citation.id,
    withoutConnection,
    citation.path,
    ...citation.sourceRefs,
  ].map(normalizeCitationReference).filter(Boolean)
}

function selectedKnowledgeSourceIntro(
  selectedConnections: Connection[],
  readyConnections: Connection[],
): { title: string; description: string } {
  if (!selectedConnections.length) {
    return {
      title: 'No knowledge source selected',
      description: 'Select a Knowledge Source to load its map.',
    }
  }

  const primary = readyConnections[0] || selectedConnections[0]
  const title = selectedConnections.length === 1
    ? primary.name
    : `${selectedConnections.length} selected knowledge sources`
  const description = primary.description?.trim()
    || (primary.status === 'ready'
      ? 'Map loaded from the selected source.'
      : 'Test the selected source to load its map.')

  return { title, description }
}

function emptyStateHeadline(selectedConnections: Connection[], readyConnections: Connection[]): string {
  if (!selectedConnections.length) return 'Ask an LLMWiki source'
  const primary = readyConnections[0] || selectedConnections[0]
  if (selectedConnections.length === 1) return `Ask ${primary.name}`
  return `Ask ${selectedConnections.length} selected LLMWiki sources`
}

function graphOverviewLabel(graph: KnowledgeGraph): Array<{ label: string; value: string }> {
  const pageCount = graph.nodes.filter(isPageNode).length
  const linkCount = graph.edges.filter((edge) => edge.relation === 'links_to').length
  const sourceRefCount = graph.nodes.filter((node) => node.kind === 'source_ref').length

  return [
    { label: pageCount === 1 ? 'page' : 'pages', value: String(pageCount) },
    { label: linkCount === 1 ? 'link' : 'links', value: String(linkCount) },
    { label: sourceRefCount === 1 ? 'source ref' : 'source refs', value: String(sourceRefCount) },
  ]
}

function knowledgeMapStatus(
  activeMode: GraphMode,
  answerGraphSelectionDiffers: boolean,
  sourceCount: number,
): string {
  if (activeMode === 'answer') {
    if (answerGraphSelectionDiffers) {
      return 'Showing the selected answer evidence graph; current selected sources are different.'
    }
    return 'Showing the evidence graph from the selected answer.'
  }
  if (sourceCount) return 'Showing the graph from currently selected ready Knowledge Sources.'
  return 'No ready selected Knowledge Sources are available for the current graph.'
}

function detailsScopeLabel(activeMode: GraphMode, answerGraphSelectionDiffers: boolean): string {
  if (activeMode === 'answer' && answerGraphSelectionDiffers) {
    return 'Detail scope: selected answer evidence; current selected sources differ.'
  }
  if (activeMode === 'answer') return 'Detail scope: selected answer evidence.'
  return 'Detail scope: current selected source graph.'
}

function updateEvidenceGraphState(
  current: RuntimeGraphState | null | undefined,
  messageId: string,
  sourceKey: string,
  selectedKey: string,
  sources: ScopeSourceSnapshot[],
  sourceGraph: KnowledgeGraph,
  incomingGraph: KnowledgeGraph | undefined,
): RuntimeGraphState {
  const currentMatchesRun = current?.messageId === messageId && current.sourceKey === sourceKey
  return {
    messageId,
    sourceKey,
    selectedKey: currentMatchesRun ? current.selectedKey : selectedKey,
    sources: currentMatchesRun ? current.sources : sources,
    graph: graphWithFallback(currentMatchesRun ? current.graph : sourceGraph, incomingGraph, sourceGraph),
  }
}

function graphNodeIdForCitation(citation: Citation, graph: KnowledgeGraph): string {
  const pageNodes = graph.nodes.filter(isPageNode)
  if (!pageNodes.length) return ''

  const sourceRefNodeId = graphNodeIdFromCitationSourceRefs(citation, graph, pageNodes)
  if (sourceRefNodeId) return sourceRefNodeId

  const idCandidates = citationPageNodeIdCandidates(citation)
  const idNode = findCitationPageNode(citation, pageNodes, (node) => idCandidates.has(graphNodeBaseId(node.id)))
  if (idNode) return idNode.id

  const citationPath = normalizedPath(citation.path)
  const pathNode = citationPath
    ? findCitationPageNode(citation, pageNodes, (node) => normalizedPath(node.path || '') === citationPath)
    : null
  if (pathNode) return pathNode.id

  const pathCandidates = pathPageNodeIdCandidates(citation.path)
  const pathIdNode = findCitationPageNode(citation, pageNodes, (node) => pathCandidates.has(graphNodeBaseId(node.id)))
  if (pathIdNode) return pathIdNode.id

  const title = normalizedComparableText(citation.title)
  const titleNode = title
    ? findCitationPageNode(citation, pageNodes, (node) => normalizedComparableText(node.label) === title)
    : null
  return titleNode?.id || ''
}

function graphNodeIdFromCitationSourceRefs(
  citation: Citation,
  graph: KnowledgeGraph,
  pageNodes: KnowledgeGraph['nodes'],
): string {
  const sourceRefIds = new Set(
    citation.sourceRefs.flatMap((sourceRef) => {
      const clean = sourceRef.trim()
      return clean ? [clean, `source:${clean}`] : []
    }),
  )
  if (!sourceRefIds.size) return ''

  for (const edge of graph.edges) {
    if (edge.relation !== 'cites' || !sourceRefIds.has(graphNodeBaseId(edge.target))) continue
    const edgeSourceBaseId = graphNodeBaseId(edge.source)
    const node = findCitationPageNode(
      citation,
      pageNodes,
      (item) => item.id === edge.source || graphNodeBaseId(item.id) === edgeSourceBaseId,
    )
    if (node) return node.id
  }
  return ''
}

function findCitationPageNode(
  citation: Citation,
  pageNodes: KnowledgeGraph['nodes'],
  predicate: (node: KnowledgeGraph['nodes'][number]) => boolean,
): KnowledgeGraph['nodes'][number] | null {
  return pageNodes
    .filter((node) => citationNodeSourceScore(citation, node) < 2)
    .sort((a, b) => citationNodeSourceScore(citation, a) - citationNodeSourceScore(citation, b))
    .find(predicate) || null
}

function citationNodeSourceScore(citation: Citation, node: KnowledgeGraph['nodes'][number]): number {
  const nodeSourceId = graphNodeSourceId(node.id)
  if (!citation.connectionId || nodeSourceId === citation.connectionId) return 0
  if (!nodeSourceId) return 1
  return 2
}

function citationPageNodeIdCandidates(citation: Citation): Set<string> {
  const candidates = new Set<string>()
  const rawIds = [citation.id]
  if (citation.connectionId && citation.id.startsWith(`${citation.connectionId}:`)) {
    rawIds.push(citation.id.slice(citation.connectionId.length + 1))
  }

  rawIds.forEach((rawId) => {
    const cleanId = graphNodeBaseId(rawId.trim())
    if (!cleanId) return
    if (cleanId.startsWith('page:')) {
      candidates.add(cleanId)
      return
    }
    if (!cleanId.includes('/') && !cleanId.startsWith('source:') && !cleanId.startsWith('heading:')) {
      candidates.add(`page:${cleanId}`)
    }
  })

  pathPageNodeIdCandidates(citation.path).forEach((candidate) => candidates.add(candidate))
  return candidates
}

function pathPageNodeIdCandidates(path: string): Set<string> {
  const cleanPath = normalizedPath(path)
  const candidates = new Set<string>()
  if (!cleanPath) return candidates

  const withoutExtension = cleanPath.replace(/\.[^.]+$/, '')
  if (withoutExtension) candidates.add(`page:${withoutExtension}`)
  const basename = withoutExtension.split('/').filter(Boolean).at(-1)
  if (basename) candidates.add(`page:${basename}`)
  return candidates
}

function graphNodeBaseId(nodeId: string): string {
  return nodeId.split('::')[0] || nodeId
}

function graphNodeSourceId(nodeId: string): string {
  return nodeId.split('::')[1] || ''
}

function normalizedPath(value: string): string {
  return value.trim().replace(/^\/+/, '').toLowerCase()
}

function normalizedComparableText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function citationForMarkdownReference(
  href: string | undefined,
  children: ReactNode,
  citations: Citation[],
  citationReferenceIds: string[] = [],
): Citation | null {
  if (!href?.startsWith('#') || !citations.length) return null

  const hrefReference = decodeHashReference(href.slice(1))
  const childReference = reactNodeText(children)
  const hrefIndex = citationIndexFromReference(hrefReference)
  const childIndex = citationIndexFromReference(childReference)
  const indexedCitation = citationByReferenceIndex(hrefIndex, citations, citationReferenceIds)
    || citationByReferenceIndex(childIndex, citations, citationReferenceIds)
  if (indexedCitation) return indexedCitation

  const hrefHasCitationPrefix = hasCitationReferencePrefix(hrefReference)
  const hrefPayload = citationReferencePayload(hrefReference)
  return citations.find((citation) => citationMatchesReference(citation, hrefPayload, hrefHasCitationPrefix)) || null
}

function citationByReferenceIndex(
  index: number,
  citations: Citation[],
  citationReferenceIds: string[],
): Citation | null {
  if (!index) return null
  const referenceId = citationReferenceIds[index - 1]
  if (referenceId) {
    const normalizedReferenceId = normalizeCitationReference(referenceId)
    const byOriginalId = citations.find((citation) => citationReferenceIdentities(citation).includes(normalizedReferenceId))
    if (byOriginalId) return byOriginalId
  }
  return citations[index - 1] || null
}

function citationInlineChildren(children: ReactNode, citation: Citation, citations: Citation[]): ReactNode {
  const text = reactNodeText(children)
  if (!citationIndexFromReference(text)) return children
  const index = citations.findIndex((item) => item.id === citation.id)
  return index >= 0 ? String(index + 1) : children
}

function citationIndexFromReference(value: string): number {
  const clean = normalizeCitationReference(value)
  if (!clean) return 0
  const bracketed = clean.match(/^\[(\d+)\]$/)
  if (bracketed) return Number(bracketed[1])
  if (/^\d+$/.test(clean)) return Number(clean)
  const prefixed = clean.match(/^(?:user-content-)?(?:citation|cite|source|ref|evidence|fn|fnref)[-_:\s]?(\d+)$/)
  return prefixed ? Number(prefixed[1]) : 0
}

function citationMatchesReference(citation: Citation, reference: string, allowTitleMatch: boolean): boolean {
  const cleanReference = normalizeCitationReference(reference)
  if (!cleanReference) return false
  const idValues = [
    citation.id,
    citation.connectionId && citation.id.startsWith(`${citation.connectionId}:`)
      ? citation.id.slice(citation.connectionId.length + 1)
      : '',
    citation.path,
    ...citation.sourceRefs,
  ].map(normalizeCitationReference)
  if (idValues.includes(cleanReference)) return true
  return allowTitleMatch && normalizeCitationReference(citation.title) === cleanReference
}

function citationReferencePayload(value: string): string {
  const clean = normalizeCitationReference(value)
  const prefixed = clean.match(/^(?:user-content-)?(?:citation|cite|source|ref|evidence|fn|fnref)[-_:\s](.+)$/)
  return prefixed?.[1] || clean
}

function hasCitationReferencePrefix(value: string): boolean {
  return /^(?:user-content-)?(?:citation|cite|source|ref|evidence|fn|fnref)(?:[-_:\s]|\d)/.test(normalizeCitationReference(value))
}

function normalizeCitationReference(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

function decodeHashReference(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(reactNodeText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return reactNodeText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

function graphHasContent(graph?: KnowledgeGraph): graph is KnowledgeGraph {
  return Boolean(graph && (graph.nodes.length || graph.edges.length))
}

function graphWithFallback(
  currentGraph: KnowledgeGraph,
  incomingGraph: KnowledgeGraph | undefined,
  sourceGraph: KnowledgeGraph,
): KnowledgeGraph {
  if (!graphHasContent(incomingGraph)) return graphHasContent(currentGraph) ? currentGraph : sourceGraph
  if (!graphHasContent(sourceGraph)) return incomingGraph
  return mergeGraphs([sourceGraph, incomingGraph])
}

function appendCitation(citations: Citation[], citation: Citation): Citation[] {
  if (citations.some((item) => item.id === citation.id)) return citations
  return [...citations, citation]
}

function upsertStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const index = steps.findIndex((item) => item.id === step.id)
  if (index < 0) return [...steps, step]
  return steps.map((item, itemIndex) => (itemIndex === index ? step : item))
}

function upsertToolCall(calls: AgentToolCallTrace[], call: AgentToolCallTrace): AgentToolCallTrace[] {
  const index = calls.findIndex((item) => item.id === call.id)
  if (index < 0) return [...calls, call]
  return calls.map((item, itemIndex) => (itemIndex === index ? call : item))
}

function renderToolCallsFromSteps(
  connections: Connection[],
  steps: AgentStep[],
  citations: Citation[],
): AgentToolCallTrace[] {
  const selectedConnectionIds = new Set(connections.map((connection) => connection.id))
  const citationsByConnection = citations.reduce((counts, citation) => {
    counts.set(citation.connectionId, (counts.get(citation.connectionId) || 0) + 1)
    return counts
  }, new Map<string, number>())
  const stepsByConnection = new Map<string, AgentStep>()

  steps.forEach((step) => {
    if (step.connectionId && selectedConnectionIds.has(step.connectionId)) {
      stepsByConnection.set(step.connectionId, step)
    }
  })

  return [...stepsByConnection.entries()].map(([connectionId, step]) => {
    const connection = connections.find((item) => item.id === connectionId)
    const citationCount = citationsByConnection.get(connectionId) || 0
    const latency = step.latencyMs === undefined ? '' : ` · ${step.latencyMs}ms`
    return {
      id: connectionId,
      sourceName: connection?.name || connectionId,
      sourceProtocol: connection?.protocol || 'llmwiki-http',
      status: step.status,
      detail: step.error || step.detail || `${citationCount} citation(s) returned.${latency}`,
    }
  })
}

function point(index: number, total: number): { x: number; y: number } {
  const count = Math.max(total, 1)
  if (count <= 90) {
    const angle = (index / count) * Math.PI * 2
    return { x: 180 + Math.cos(angle) * 120, y: 110 + Math.sin(angle) * 74 }
  }

  const maxNodesPerRing = 90
  const ringCount = Math.ceil(count / maxNodesPerRing)
  const ringIndex = Math.floor(index / maxNodesPerRing)
  const ringOffset = ringCount === 1 ? 1 : ringIndex / Math.max(ringCount - 1, 1)
  const nodesInRing = Math.min(maxNodesPerRing, count - ringIndex * maxNodesPerRing)
  const indexInRing = index - ringIndex * maxNodesPerRing
  const angle = (indexInRing / Math.max(nodesInRing, 1)) * Math.PI * 2 + (ringIndex % 2 ? Math.PI / nodesInRing : 0)
  const radiusX = 44 + ringOffset * 88
  const radiusY = 28 + ringOffset * 58
  return { x: 180 + Math.cos(angle) * radiusX, y: 110 + Math.sin(angle) * radiusY }
}

function askBlockReasonFor(
  text: string,
  busy: boolean,
  agent: AgentConnection,
  selectedConnections: Connection[],
  readyConnections: Connection[],
): string {
  if (busy) return 'Wait for the current agent run to finish before asking again.'
  if (!selectedConnections.length) return 'Select at least one Knowledge Source before asking.'
  if (selectedConnections.some((connection) => connection.status === 'checking')) {
    return 'Wait for the selected Knowledge Source check to finish before asking.'
  }
  if (selectedConnections.some((connection) => connection.status === 'error')) {
    return 'Some selected Knowledge Sources need attention. Review the error, retry failed sources, or deselect them.'
  }
  if (!readyConnections.length) return 'Select or edit a Knowledge Source endpoint so it can be checked before asking.'
  if (selectedConnections.some((connection) => connection.status !== 'ready')) {
    return 'Some selected Knowledge Sources still need attention. Wait for checks, retry failed sources, or deselect them.'
  }
  if (agent.status === 'checking') return `${agent.name} is still being tested.`
  if (agent.status === 'error' && agent.error) {
    return `Last ${isBridgeAgent(agent) ? 'bridge' : 'runtime'} test failed for ${agent.name}: ${agent.error}. Test it again, or choose a ready runtime.`
  }
  if (agent.status !== 'ready') {
    return isBridgeAgent(agent)
      ? `Select or configure ${agent.name} bridge so it can be checked, or choose a ready runtime.`
      : `Select or configure ${agent.name} so it can be checked, or choose a ready runtime.`
  }
  if (!text.trim()) return `Enter a question to ask ${selectedSourceTargetLabel(selectedConnections)}.`
  return ''
}

function externalRuntimeSourceUrlAdvisoryFor(
  agent: AgentConnection,
  readyConnections: Connection[],
): string {
  if (agent.protocol === 'mock-agent') return ''
  if (readyConnections.some((connection) => {
    const managedBySelectedBridge = isBridgeAgent(agent) && connection.bridgeSource?.agentId === agent.id
    return !managedBySelectedBridge && !isReachablePublicHttpsSourceUrl(connection.url)
  })) {
    return externalRuntimeSourceUrlAdvisoryMessage
  }
  return ''
}

function isCanceledRunError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /request was canceled|aborted|aborterror/i.test(message)
}

function sourceSummaryLabel(selectedConnections: Connection[], readyConnections: Connection[]): string {
  return `${selectedConnections.length} selected · ${readyConnections.length} ready available`
}

function sourceSummaryTitle(selectedConnections: Connection[], readyConnections: Connection[]): string {
  if (!selectedConnections.length) return 'No source selected'
  const primary = readyConnections[0] || selectedConnections[0]
  if (selectedConnections.length === 1) return primary.name
  return `${selectedConnections.length} selected LLMWiki sources`
}

function sourceSummaryEyebrow(selectedConnections: Connection[]): string {
  if (selectedConnections.length === 1) return 'Selected source'
  return 'Selected sources'
}

function askButtonLabel(busy: boolean, selectedConnections: Connection[]): string {
  if (busy) return 'Running agent...'
  if (!selectedConnections.length) return 'Ask selected source'
  if (selectedConnections.length === 1) return `Ask ${selectedConnections[0].name}`
  return `Ask ${selectedConnections.length} sources`
}

function readyAskStatusMessage(selectedConnections: Connection[]): string {
  return `Ready to ask ${askTargetLabel(selectedConnections)}.`
}

function askTargetLabel(selectedConnections: Connection[]): string {
  if (!selectedConnections.length) return 'a selected source'
  if (selectedConnections.length === 1) return selectedConnections[0].name
  return `${selectedConnections.length} selected sources`
}

function selectedSourceTargetLabel(selectedConnections: Connection[]): string {
  return selectedConnections.length === 1 ? 'the selected source' : 'the selected sources'
}

function connectionStatusSummary(
  selectedConnections: Connection[],
  readyConnections: Connection[],
  runtimeStatus: RuntimeStatus,
): string {
  const sourceCount = readyConnections.length === 1 ? '1 ready source' : `${readyConnections.length} ready sources`
  return `${sourceCount} · runtime ${runtimeStatus}`
}

function selectedEndpointMetadata(selectedConnections: Connection[]): string {
  const visible = selectedConnections.slice(0, 2).map((connection) => `${connection.name}: ${connection.url}`)
  const hiddenCount = Math.max(selectedConnections.length - visible.length, 0)
  return hiddenCount ? `${visible.join('; ')}; +${hiddenCount} more` : visible.join('; ')
}

function sourceSelectionCopy(connections: Connection[]): string {
  if (!connections.length) return 'No Knowledge Source is selected.'
  if (connections.some((connection) => connection.status === 'checking')) return 'Checking selected sources...'
  const ready = connections.filter((connection) => connection.status === 'ready')
  if (ready.length === connections.length) return 'Selected sources tested successfully.'
  const failed = connections.filter((connection) => connection.status === 'error')
  if (failed.length) return `${failed.length} selected source(s) need attention.`
  if (ready.length) return `${ready.length} selected source(s) ready; remaining sources will be checked when selected or edited.`
  return 'Selected sources are being set up. Edit or select a source to check it, or use Test selected sources.'
}

function sourceSelectionTone(connections: Connection[]): string {
  if (!connections.length) return 'blocked'
  if (connections.some((connection) => connection.status === 'checking')) return 'checking'
  if (connections.some((connection) => connection.status === 'error')) return 'error'
  if (connections.every((connection) => connection.status === 'ready')) return 'ready'
  return 'blocked'
}

function sourceTestCopy(connection: Connection): string {
  if (isBridgeManagedConnection(connection) && connection.status === 'ready') {
    return `Registered by ${connection.bridgeSource?.agentName || 'Agent Bridge'} and ready for bridge calls.`
  }
  if (connection.status === 'checking') return 'Checking source connection...'
  if (connection.status === 'ready') {
    return 'Source tested successfully.'
  }
  if (connection.status === 'error') return 'Last source test failed. Review the error and test again.'
  return 'Not tested since the latest connection change. Leave the URL field or use Test source to check it.'
}

function sourceTestTone(connection: Connection): string {
  if (connection.status === 'ready') return 'ready'
  if (connection.status === 'checking') return 'checking'
  if (connection.status === 'error') return 'error'
  return 'blocked'
}

function runtimeModeLabel(agent: AgentConnection): string {
  if (agent.protocol === 'mock-agent') return 'Local deterministic runtime'
  if (agent.protocol === 'bridge-a2a') return 'Agent Bridge A2A'
  if (agent.protocol === 'bridge-mcp') return 'Agent Bridge MCP'
  return 'Live A2A runtime'
}

function sourceEndpointSummary(connection: Connection): string {
  return connection.id === 'local-demo' ? 'local sample endpoint' : `${connection.protocol} endpoint`
}

function runtimeProtocolLabel(agent: AgentConnection): string {
  return agent.protocol === 'mock-agent' ? 'browser-local' : agent.protocol
}

function runtimeSummaryLabel(agent: AgentConnection, status: RuntimeStatus): string {
  return agent.protocol === 'mock-agent' ? `${agent.name} · ${status}` : `${agent.name} · ${runtimeModeLabel(agent)} · ${status}`
}

function runtimeStatusCopy(agent: AgentConnection, status: RuntimeStatus): string {
  if (status === 'running') return `${agent.name} is running over the selected ready sources.`
  if (status === 'checking') return isBridgeAgent(agent) ? `${agent.name} bridge test is running.` : `${agent.name} runtime test is running.`
  if (status === 'ready') return `${agent.name} is ready for the next question.`
  if (status === 'error' && agent.error) return `${isBridgeAgent(agent) ? 'Bridge' : 'Runtime'} test failed: ${agent.error}`
  if (status === 'error') return `${isBridgeAgent(agent) ? 'Bridge' : 'Runtime'} test failed. Review the card and test again.`
  if (status === 'unknown') {
    return isBridgeAgent(agent)
      ? 'Select this bridge or leave its URL field to check it.'
      : 'Select this runtime or leave its URL field to check it.'
  }
  return isBridgeAgent(agent) ? 'Configure this bridge, or choose a ready runtime.' : 'Configure this runtime, or choose a ready runtime.'
}

function runtimeSettingsLinkUrl(agent: AgentConnection): string {
  if (agent.settingsUrl?.trim()) return agent.settingsUrl.trim()
  if (!isBridgeAgent(agent)) return ''
  const baseUrl = agent.url?.trim()
  if (!baseUrl) return ''
  try {
    return new URL('/settings', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  } catch {
    return ''
  }
}

function runtimeSettingsLinkLabel(agent: AgentConnection): string {
  if (isBridgeAgent(agent) || isAgentBridgeLikeRuntime(agent)) return 'Open bridge settings'
  return 'Open runtime settings'
}

function isAgentBridgeLikeRuntime(agent: AgentConnection): boolean {
  return Boolean(
    agent.capabilities?.includes('localBridge')
    || agent.capabilities?.includes('settings')
    || /agent bridge/i.test(agent.description || '')
  )
}

function canClearAgentRuntime(agent: AgentConnection): boolean {
  if (!isPrimaryBridgeAgent(agent) && agent.selected) return true
  const starter = starterAgentConnections.find((item) => item.id === agent.id)
  if (!starter) return Boolean(agent.url?.trim() || agent.bearerToken?.trim() || agent.error || agent.capabilities?.length)
  return (agent.url || '') !== (starter.url || '')
    || Boolean(agent.bearerToken?.trim())
    || Boolean(agent.settingsUrl?.trim())
    || Boolean(agent.error)
    || Boolean(agent.capabilities?.length)
    || agent.status !== starter.status
}
