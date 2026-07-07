export type Protocol = 'llmwiki-http' | 'mcp' | 'a2a'
export type AgentProtocol =
  | 'bridge-a2a'
  | 'bridge-mcp'
  | 'mock-agent'
  | 'hermes'
  | 'deepagents'
  | 'copilot'
  | 'custom-a2a'
export type AgentRuntimeStatus = 'unknown' | 'checking' | 'ready' | 'unavailable' | 'error'
export type AgentStepStatus = 'pending' | 'running' | 'done' | 'error'

export interface DiagnosticStep {
  id?: string
  label: string
  status?: AgentStepStatus
  detail?: string
  error?: string
}

export interface Diagnostic {
  schemaVersion?: string
  severity?: string
  scope?: string
  phase?: string
  protocol?: string
  subject?: string
  retryable?: string
  redacted?: boolean
  title?: string
  detail?: string
  observations?: string[]
  remediation?: string[]
  traceId?: string
  type?: string
  instance?: string
  status?: number
  steps?: DiagnosticStep[]
  partial?: unknown
}

export interface AgentBridgeMetadata {
  mode: 'a2a' | 'mcp'
  local?: boolean
}

export interface Connection {
  id: string
  name: string
  nameOverride?: boolean
  protocol: Protocol
  url: string
  selected: boolean
  status: 'unknown' | 'checking' | 'ready' | 'error'
  description?: string
  adapter?: string
  implementation?: string
  pageCount?: number
  approvedPageCount?: number
  capabilities?: string[]
  graph?: KnowledgeGraph
  latencyMs?: number
  error?: string
  diagnostic?: Diagnostic
}

export interface Citation {
  id: string
  title: string
  path: string
  snippet: string
  connectionId: string
  sourceRefs: string[]
}

export interface AgentConnection {
  id: string
  name: string
  protocol: AgentProtocol
  added?: boolean
  url?: string
  bearerToken?: string
  settingsUrl?: string
  bridge?: AgentBridgeMetadata
  selected: boolean
  status: AgentRuntimeStatus
  description?: string
  capabilities?: string[]
  latencyMs?: number
  error?: string
  diagnostic?: Diagnostic
}

export interface AgentStep {
  id: string
  label: string
  status: AgentStepStatus
  detail?: string
  timestamp: string
  runtimeId?: string
  toolName?: string
  connectionId?: string
  citationIds?: string[]
  latencyMs?: number
  error?: string
  diagnostic?: Diagnostic
  parentId?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations: Citation[]
  steps?: AgentStep[]
}

export interface KnowledgeNode {
  id: string
  label: string
  kind: string
  path?: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeEdge {
  source: string
  target: string
  relation: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

export interface KnowledgePage {
  id: string
  title: string
  path: string
  text: string
  sourceRefs: string[]
}

export interface KnowledgeOrientation {
  title: string
  snippet: string
  role: string
}

export interface KnowledgeQueryResult {
  wikiTitle: string
  orientation: KnowledgeOrientation[]
  citations: Citation[]
  limitations: string[]
  graph?: KnowledgeGraph
}
