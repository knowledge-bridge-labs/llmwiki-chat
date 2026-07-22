import type {
  AgentStepStatus,
  Citation,
  Connection,
  Diagnostic,
  DiagnosticStep,
  KnowledgeGraph,
  KnowledgePage,
  KnowledgeQueryResult,
  ProjectionStoreDiagnostics,
} from './domain'
import {
  a2aKnowledgeSourceMessageUrlPolicyMessage,
  isAllowedA2aKnowledgeSourceMessageUrl,
} from './urlPolicy'

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const OPTIONAL_DIAGNOSTICS_TIMEOUT_MS = 2_000

export interface KnowledgeEndpointClient {
  discover(connection: Connection, signal?: AbortSignal): Promise<Connection>
  query(connection: Connection, query: string, signal?: AbortSignal): Promise<KnowledgeQueryResult>
  readPage(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage>
  read(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage>
  graph(connection: Connection, signal?: AbortSignal): Promise<KnowledgeGraph>
}

export class LlmWikiServeClient implements KnowledgeEndpointClient {
  async discover(connection: Connection, signal?: AbortSignal): Promise<Connection> {
    const started = performance.now()
    const [manifest, graph, projectionStore] = await Promise.all([
      fetchJson<Record<string, unknown>>(joinUrl(connection.url, '/manifest'), { signal }, 'manifest'),
      this.graph(connection, signal),
      fetchProjectionStoreDiagnostics(connection, signal),
    ])
    return discoveredConnectionFromManifest(connection, manifest, graph, started, projectionStore)
  }

  async query(connection: Connection, query: string, signal?: AbortSignal): Promise<KnowledgeQueryResult> {
    const payload = await fetchJson<Record<string, unknown>>(joinUrl(connection.url, '/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 8 }),
      signal,
    }, 'query')
    return normalizeQueryResult(connection, payload)
  }

  async readPage(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    const payload = await fetchJson<Record<string, unknown>>(
      joinUrl(connection.url, `/read/${encodePageIdPath(pageId)}`),
      { signal },
      'read',
    )
    return normalizeKnowledgePage(connection, payload, pageId, 'read')
  }

  async read(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    return this.readPage(connection, pageId, signal)
  }

  async graph(connection: Connection, signal?: AbortSignal): Promise<KnowledgeGraph> {
    const payload = await fetchJson<Record<string, unknown>>(
      joinUrl(connection.url, '/graph?limit=500'),
      { signal },
      'graph',
    )
    return normalizeGraphPayload(payload)
  }
}

export class McpKnowledgeClient implements KnowledgeEndpointClient {
  async discover(connection: Connection, signal?: AbortSignal): Promise<Connection> {
    const started = performance.now()
    const [toolsResult, contextPayload] = await Promise.all([
      callMcpMethod(connection, 'tools/list', undefined, signal, 'mcp tools/list'),
      callMcpTool(connection, 'llmwiki_context', { query: '', limit: 8 }, signal),
    ])
    const contextGraph = graphFromKnowledgePayload(contextPayload)
    const graph = contextGraph || await this.graph(connection, signal)
    const capabilities = uniqueStrings([
      ...mcpToolNames(toolsResult),
      ...readStringArray(contextPayload.capabilities),
    ])
    return discoveredConnectionFromKnowledgePayload(connection, contextPayload, graph, started, { capabilities })
  }

  async query(connection: Connection, query: string, signal?: AbortSignal): Promise<KnowledgeQueryResult> {
    const payload = await callMcpTool(connection, 'llmwiki_context', { query, limit: 8 }, signal)
    return normalizeQueryResult(connection, payload)
  }

  async readPage(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    const payload = await callMcpTool(connection, 'llmwiki_read', { page_id: pageId }, signal)
    return normalizeKnowledgePage(connection, payload, pageId, 'mcp llmwiki_read')
  }

  async read(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    return this.readPage(connection, pageId, signal)
  }

  async graph(connection: Connection, signal?: AbortSignal): Promise<KnowledgeGraph> {
    const payload = await callMcpTool(connection, 'llmwiki_graph', { limit: 500, include_drafts: false }, signal)
    return normalizeGraphPayload(payload)
  }
}

export class A2aKnowledgeClient implements KnowledgeEndpointClient {
  async discover(connection: Connection, signal?: AbortSignal): Promise<Connection> {
    const started = performance.now()
    const endpoint = await loadA2aEndpoint(connection, signal)
    const message = await postA2aMessage(endpoint.messageUrl, '', signal)
    const contextPayload = extractA2aContextPayload(message)
    if (!contextPayload) throw new Error(a2aMissingContextMessage(message))
    const graph = graphFromKnowledgePayload(contextPayload) || emptyKnowledgeGraph()
    const capabilities = uniqueStrings([
      'a2a-message',
      ...capabilitiesFromA2aCard(endpoint.card),
      ...readStringArray(contextPayload.capabilities),
    ])
    const discovered = discoveredConnectionFromKnowledgePayload(
      connection,
      contextPayload,
      graph,
      started,
      { capabilities },
    )
    return {
      ...discovered,
      name: readString(endpoint.card, 'name') || discovered.name,
      description: readString(endpoint.card, 'description') || discovered.description,
    }
  }

  async query(connection: Connection, query: string, signal?: AbortSignal): Promise<KnowledgeQueryResult> {
    const endpoint = await loadA2aEndpoint(connection, signal)
    const message = await postA2aMessage(endpoint.messageUrl, query, signal)
    const contextPayload = extractA2aContextPayload(message)
    if (!contextPayload) return fallbackA2aQueryResult(connection, message)
    return normalizeQueryResult(connection, contextPayload)
  }

  async readPage(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    void pageId
    void signal
    throw new Error(unsupportedReadMessage(connection.protocol, connection.name))
  }

  async read(connection: Connection, pageId: string, signal?: AbortSignal): Promise<KnowledgePage> {
    return this.readPage(connection, pageId, signal)
  }

  async graph(connection: Connection, signal?: AbortSignal): Promise<KnowledgeGraph> {
    const endpoint = await loadA2aEndpoint(connection, signal)
    const message = await postA2aMessage(endpoint.messageUrl, '', signal)
    const contextPayload = extractA2aContextPayload(message)
    return contextPayload ? graphFromKnowledgePayload(contextPayload) || emptyKnowledgeGraph() : emptyKnowledgeGraph()
  }
}

export function clientFor(connection: Connection): KnowledgeEndpointClient {
  if (connection.protocol === 'llmwiki-http') return new LlmWikiServeClient()
  if (connection.protocol === 'mcp') return new McpKnowledgeClient()
  if (connection.protocol === 'a2a') return new A2aKnowledgeClient()
  return new UnsupportedProtocolClient(String(connection.protocol))
}

export function normalizeQueryResult(
  connection: Connection,
  payload: Record<string, unknown>,
): KnowledgeQueryResult {
  const citations = readRecordArray(payload.evidence).map((item, index): Citation => ({
    id: `${connection.id}:${readString(item, 'page_id') || readString(item, 'path') || index}`,
    title: readString(item, 'title') || 'Untitled',
    path: readString(item, 'path'),
    snippet: readableMarkdown(readString(item, 'snippet')),
    connectionId: connection.id,
    sourceRefs: readStringArray(item.source_refs ?? item.sourceRefs),
  }))
  const orientation = readRecordArray(payload.orientation).map((item) => ({
    title: readString(item, 'title') || 'Untitled',
    snippet: readableMarkdown(readString(item, 'snippet')),
    role: readString(item, 'role'),
  }))
  const graphPayload = asRecord(payload.graph)
  return {
    wikiTitle: readString(payload, 'wiki_title') || readString(payload, 'wikiTitle') || connection.name,
    orientation,
    citations,
    limitations: readStringArray(payload.limitations),
    graph: graphPayload ? normalizeGraphPayload(graphPayload) : undefined,
  }
}

export function normalizeGraphPayload(payload: Record<string, unknown>): KnowledgeGraph {
  const nodes = readRecordArray(payload.nodes)
    .map((item, index) => ({
      id: readString(item, 'id') || `node:${index}`,
      label: readString(item, 'label') || readString(item, 'title') || readString(item, 'id') || `Node ${index + 1}`,
      kind: readString(item, 'kind') || readString(item, 'role') || 'node',
      path: readString(item, 'path'),
      metadata: asRecord(item.metadata) || undefined,
    }))
    .filter((node) => node.id)
  const edges = readRecordArray(payload.edges)
    .map((item) => ({
      source: readString(item, 'source'),
      target: readString(item, 'target'),
      relation: readString(item, 'relation') || readString(item, 'kind') || 'related',
      metadata: asRecord(item.metadata) || undefined,
    }))
    .filter((edge) => edge.source && edge.target)
  return { nodes, edges }
}

export function normalizeKnowledgePage(
  connection: Connection,
  payload: Record<string, unknown>,
  requestedPageId: string,
  label: string,
): KnowledgePage {
  if (payload.found === false) {
    const reason = readString(payload, 'reason')
    throw new Error(reason
      ? `${label} did not find page "${requestedPageId}": ${reason}`
      : `${label} did not find page "${requestedPageId}"`)
  }

  const id = readString(payload, 'id') || requestedPageId
  const title = readString(payload, 'title') || id || 'Untitled'
  const path = readString(payload, 'path') || requestedPageId
  const text = readString(payload, 'text') || readString(payload, 'markdown') || readString(payload, 'content')
  if (!id || !text) throw new Error(`${label} returned no page content for ${connection.name}.`)

  return {
    id,
    title,
    path,
    text,
    sourceRefs: readStringArray(payload.source_refs ?? payload.sourceRefs),
  }
}

function discoveredConnectionFromManifest(
  connection: Connection,
  manifest: Record<string, unknown>,
  graph: KnowledgeGraph,
  started: number,
  projectionStore?: ProjectionStoreDiagnostics,
): Connection {
  return {
    ...connection,
    name: readString(manifest, 'title') || connection.name,
    description: readString(manifest, 'description') || connection.description,
    adapter: readString(manifest, 'adapter'),
    implementation: readString(manifest, 'implementation'),
    pageCount: readNumber(manifest, 'page_count'),
    approvedPageCount: readNumber(manifest, 'approved_page_count'),
    capabilities: readStringArray(manifest.capabilities),
    graph,
    status: 'ready',
    latencyMs: Math.round(performance.now() - started),
    error: '',
    diagnostic: undefined,
    projectionStore,
  }
}

function discoveredConnectionFromKnowledgePayload(
  connection: Connection,
  payload: Record<string, unknown>,
  graph: KnowledgeGraph,
  started: number,
  overrides: { capabilities?: string[] } = {},
): Connection {
  return {
    ...connection,
    name: readString(payload, 'wiki_title') || readString(payload, 'wikiTitle') || readString(payload, 'title') || connection.name,
    description: readString(payload, 'description') || connection.description,
    adapter: readString(payload, 'adapter') || connection.adapter,
    implementation: readString(payload, 'implementation') || connection.implementation,
    pageCount: readNumber(payload, 'page_count') ?? readNumber(payload, 'pageCount'),
    approvedPageCount: readNumber(payload, 'approved_page_count') ?? readNumber(payload, 'approvedPageCount'),
    capabilities: overrides.capabilities || readStringArray(payload.capabilities),
    graph,
    status: 'ready',
    latencyMs: Math.round(performance.now() - started),
    error: '',
    diagnostic: undefined,
    projectionStore: undefined,
  }
}

async function fetchProjectionStoreDiagnostics(
  connection: Connection,
  signal?: AbortSignal,
): Promise<ProjectionStoreDiagnostics | undefined> {
  try {
    const payload = await fetchJson<Record<string, unknown>>(
      joinUrl(connection.url, '/diagnostics/projection-store'),
      { signal },
      'projection store diagnostics',
      OPTIONAL_DIAGNOSTICS_TIMEOUT_MS,
    )
    return normalizeProjectionStoreDiagnostics(payload)
  } catch {
    return undefined
  }
}

function normalizeProjectionStoreDiagnostics(payload: Record<string, unknown>): ProjectionStoreDiagnostics | undefined {
  const diagnostics: ProjectionStoreDiagnostics = {
    backend: readString(payload, 'backend'),
    backendKind: readString(payload, 'backend_kind') || readString(payload, 'backendKind'),
    namespace: readString(payload, 'namespace'),
    cacheSourceId: readString(payload, 'cache_source_id') || readString(payload, 'cacheSourceId'),
    available: readBooleanValue(payload.available),
    lastError: readString(payload, 'last_error') || readString(payload, 'lastError'),
    endpoint: safeProjectionStoreEndpointLabel(readString(payload, 'endpoint')),
  }
  return hasProjectionStoreDiagnosticsContent(diagnostics) ? diagnostics : undefined
}

function safeProjectionStoreEndpointLabel(value: string | undefined): string | undefined {
  const clean = value?.trim()
  if (!clean) return undefined
  if (/[@?#\\\s]/.test(clean)) return undefined
  if (/^(redis|rediss|valkey|valkeys|unix):\/\/<redacted>$/i.test(clean)) return clean

  let parsed: URL
  try {
    parsed = new URL(clean)
  } catch {
    return undefined
  }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (!['redis', 'rediss', 'valkey', 'valkeys'].includes(scheme)) return undefined
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) return undefined
  if (parsed.pathname && !/^\/\d+$/.test(parsed.pathname)) return undefined
  return clean
}

function hasProjectionStoreDiagnosticsContent(diagnostics: ProjectionStoreDiagnostics): boolean {
  return Boolean(
    diagnostics.backend
    || diagnostics.backendKind
    || diagnostics.namespace
    || diagnostics.cacheSourceId
    || diagnostics.available !== undefined
    || diagnostics.lastError
    || diagnostics.endpoint,
  )
}

let mcpRequestId = 0

async function callMcpMethod(
  connection: Connection,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
  label: string,
): Promise<Record<string, unknown>> {
  const request = {
    jsonrpc: '2.0',
    id: ++mcpRequestId,
    method,
    ...(params ? { params } : {}),
  }
  const envelope = await fetchJson<Record<string, unknown>>(mcpEndpointUrl(connection.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  }, label)
  const error = asRecord(envelope.error)
  if (error) throw errorWithDiagnostic(`${label} returned JSON-RPC error: ${jsonRpcErrorMessage(error)}`, error)
  if (!Object.hasOwn(envelope, 'result')) throw new Error(`${label} returned no JSON-RPC result`)
  const result = asRecord(envelope.result)
  if (!result) throw new Error(`${label} returned a non-object JSON-RPC result`)
  return result
}

async function callMcpTool(
  connection: Connection,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const result = await callMcpMethod(
    connection,
    'tools/call',
    { name, arguments: args },
    signal,
    `mcp ${name}`,
  )
  return unwrapMcpToolPayload(result, name)
}

function unwrapMcpToolPayload(result: Record<string, unknown>, name: string): Record<string, unknown> {
  if (result.isError === true) {
    throw errorWithDiagnostic(`mcp ${name} returned tool error: ${extractMcpText(result) || 'unknown tool error'}`, result)
  }
  const structured = asRecord(result.structuredContent ?? result.structured_content)
  if (structured) return structured
  const data = asRecord(result.data)
  if (data) return data
  const contentPayload = extractRecordFromParts(result.content)
  if (contentPayload) return contentPayload
  if (Array.isArray(result.content)) throw new Error(`mcp ${name} returned no object payload`)
  return result
}

function extractMcpText(result: Record<string, unknown>): string {
  return readRecordArray(result.content)
    .map((item) => readString(item, 'text'))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function mcpToolNames(result: Record<string, unknown>): string[] {
  return readRecordArray(result.tools)
    .map((tool) => readString(tool, 'name'))
    .filter(Boolean)
}

function mcpEndpointUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '')
  return pathName(clean).endsWith('/mcp') ? clean : `${clean}/mcp`
}

async function loadA2aEndpoint(
  connection: Connection,
  signal?: AbortSignal,
): Promise<{ card: Record<string, unknown>; cardUrl: string; messageUrl: string }> {
  const cardUrl = a2aAgentCardUrl(connection.url)
  const card = await fetchJson<Record<string, unknown>>(cardUrl, { signal }, 'a2a agent card')
  const messageUrl = resolveA2aMessageUrl(card, cardUrl)
  if (!isAllowedA2aKnowledgeSourceMessageUrl(messageUrl)) {
    throw new Error(`A2A Knowledge Source agent card message URL is not allowed. ${a2aKnowledgeSourceMessageUrlPolicyMessage}`)
  }
  return { card, cardUrl, messageUrl }
}

async function postA2aMessage(
  messageUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const payload = await fetchJson<Record<string, unknown>>(messageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { query } }),
    signal,
  }, 'a2a message')
  assertNoA2aError(payload)
  return payload
}

function a2aAgentCardUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '')
  return pathName(clean).endsWith('/.well-known/agent-card.json')
    ? clean
    : joinUrl(clean, '/.well-known/agent-card.json')
}

function resolveA2aMessageUrl(card: Record<string, unknown>, cardUrl: string): string {
  const rawUrl = readString(card, 'url') || '/message:send'
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const serviceBase = cardUrl.replace(/\/\.well-known\/agent-card\.json(?:[?#].*)?$/, '/')
  const relativeUrl = rawUrl.startsWith('/') ? rawUrl : `./${rawUrl}`
  try {
    return new URL(relativeUrl, serviceBase).toString()
  } catch {
    return rawUrl.startsWith('/') ? rawUrl : joinUrl(serviceBase, rawUrl)
  }
}

function assertNoA2aError(payload: Record<string, unknown>): void {
  const directError = readStringValue(payload.error)
  const error = asRecord(payload.error)
  if (directError || error) {
    throw errorWithDiagnostic(`a2a message returned error: ${error ? a2aErrorMessage(error) : directError}`, error || payload)
  }

  const status = asRecord(payload.status)
  const state = readString(status || {}, 'state').toLowerCase()
  if (['failed', 'canceled', 'cancelled', 'rejected'].includes(state)) {
    throw errorWithDiagnostic(`a2a message failed: ${extractA2aMessageText(payload) || state}`, payload)
  }
}

function a2aErrorMessage(error: Record<string, unknown>): string {
  return readString(error, 'message') || readString(error, 'detail') || readString(error, 'code') || 'unknown error'
}

function capabilitiesFromA2aCard(card: Record<string, unknown>): string[] {
  const capabilities = readStringArray(card.capabilities)
  const capabilityRecord = asRecord(card.capabilities)
  if (!capabilityRecord) return capabilities
  return uniqueStrings([...capabilities, ...Object.keys(capabilityRecord).filter((key) => Boolean(capabilityRecord[key]))])
}

function extractA2aContextPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const artifacts = [
    ...readRecordArray(payload.artifacts),
    ...readRecordArray(asRecord(payload.result)?.artifacts),
    ...readRecordArray(asRecord(payload.task)?.artifacts),
  ]
  for (const artifact of artifacts) {
    if (readString(artifact, 'name') !== 'llmwiki_context') continue
    const directData = asRecord(artifact.data)
    if (directData) return directData
    const partsPayload = extractRecordFromParts(artifact.parts)
    if (partsPayload) return partsPayload
  }
  return null
}

function fallbackA2aQueryResult(connection: Connection, payload: Record<string, unknown>): KnowledgeQueryResult {
  const messageText = readableMarkdown(extractA2aMessageText(payload))
  return {
    wikiTitle: connection.name,
    orientation: messageText ? [{ title: 'A2A message', snippet: messageText, role: 'message' }] : [],
    citations: [],
    limitations: [
      messageText
        ? `A2A response did not include a llmwiki_context data artifact. Message: ${messageText}`
        : 'A2A response did not include a llmwiki_context data artifact.',
    ],
  }
}

function a2aMissingContextMessage(payload: Record<string, unknown>): string {
  const messageText = readableMarkdown(extractA2aMessageText(payload))
  return messageText
    ? `A2A discovery did not receive a llmwiki_context data artifact. Message: ${messageText}`
    : 'A2A discovery did not receive a llmwiki_context data artifact.'
}

function extractA2aMessageText(payload: Record<string, unknown>): string {
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

function graphFromKnowledgePayload(payload: Record<string, unknown>): KnowledgeGraph | undefined {
  const graphPayload = asRecord(payload.graph)
  if (graphPayload) return normalizeGraphPayload(graphPayload)
  if (Array.isArray(payload.nodes) || Array.isArray(payload.edges)) return normalizeGraphPayload(payload)
  return undefined
}

function jsonRpcErrorMessage(error: Record<string, unknown>): string {
  const code = readString(error, 'code')
  const message = readString(error, 'message') || 'unknown error'
  return code ? `${code} ${message}` : message
}

export function diagnosticFromError(error: unknown): Diagnostic | undefined {
  const record = asRecord(error)
  if (!record) return undefined

  return diagnosticFromParts({
    diagnostic: normalizeDiagnosticEnvelope(record.diagnostic),
    requestId: readRequestId(record),
    traceId: readTraceId(record),
    steps: normalizeDiagnosticSteps(record.steps),
    partial: Object.hasOwn(record, 'partial') ? record.partial : undefined,
  })
}

export function normalizeDiagnosticEnvelope(value: unknown): Diagnostic | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const observations = readDiagnosticFactList(record.observations ?? record.observation)
  const remediation = readDiagnosticActionList(record.remediation ?? record.remediations)
  const steps = normalizeDiagnosticSteps(record.steps)
  const partial = Object.hasOwn(record, 'partial') ? record.partial : undefined
  const status = readNumber(record, 'status')
  const diagnostic: Diagnostic = {
    schemaVersion: readString(record, 'schemaVersion') || readString(record, 'schema_version'),
    severity: readString(record, 'severity'),
    scope: readString(record, 'scope'),
    phase: readString(record, 'phase'),
    protocol: readString(record, 'protocol'),
    subject: readDiagnosticSubject(record.subject),
    retryable: readRetryable(record.retryable),
    redacted: readBooleanValue(record.redacted),
    title: readString(record, 'title') || readString(record, 'message'),
    detail: readString(record, 'detail') || readString(record, 'description'),
    observations: observations.length ? observations : undefined,
    remediation: remediation.length ? remediation : undefined,
    requestId: readRequestId(record),
    traceId: readTraceId(record),
    type: readString(record, 'type'),
    instance: readString(record, 'instance'),
    status,
    steps: steps.length ? steps : undefined,
  }
  if (partial !== undefined) diagnostic.partial = partial

  return hasDiagnosticContent(diagnostic) ? diagnostic : undefined
}

export function errorWithDiagnostic(message: string, envelope?: unknown): Error {
  const error = new Error(message) as Error & {
    diagnostic?: Diagnostic
    requestId?: string
    traceId?: string
    steps?: DiagnosticStep[]
    partial?: unknown
  }
  const diagnostic = diagnosticFromEnvelope(envelope)
  if (!diagnostic) return error

  error.diagnostic = diagnostic
  if (diagnostic.requestId) error.requestId = diagnostic.requestId
  if (diagnostic.traceId) error.traceId = diagnostic.traceId
  if (diagnostic.steps?.length) error.steps = diagnostic.steps
  if (Object.hasOwn(diagnostic, 'partial')) error.partial = diagnostic.partial
  return error
}

async function httpErrorWithDiagnostic(response: Response, label: string): Promise<Error> {
  const message = `${label} returned HTTP ${response.status}`
  const payload = await readResponseRecord(response)
  if (!payload) return new Error(message)
  return errorWithDiagnostic(message, payload)
}

async function readResponseRecord(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text()
    return parseRecord(text)
  } catch {
    return null
  }
}

function diagnosticFromEnvelope(value: unknown): Diagnostic | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const errorRecord = asRecord(record.error)
  const dataRecord = asRecord(record.data)
  const errorDataRecord = asRecord(errorRecord?.data)
  const candidates = [record, errorRecord, dataRecord, errorDataRecord]
    .filter((item): item is Record<string, unknown> => Boolean(item))
  const explicitDiagnostic = candidates
    .map((item) => normalizeDiagnosticEnvelope(item.diagnostic))
    .find(Boolean)
  const collectedDiagnostics = candidates.flatMap((item) => readRecordArray(item.diagnostics))
    .map(normalizeDiagnosticEnvelope)
    .filter((item): item is Diagnostic => Boolean(item))

  const problemDetails = candidates
    .filter(hasProblemDetailsSignal)
    .map(normalizeDiagnosticEnvelope)
    .find(Boolean)
  const requestId = candidates.map(readRequestId).find(Boolean) || ''
  const traceId = candidates.map(readTraceId).find(Boolean) || ''
  const steps = candidates
    .map((item) => normalizeDiagnosticSteps(item.steps))
    .find((items) => items.length) || []
  const partialRecord = candidates.find((item) => Object.hasOwn(item, 'partial'))
  const partial = partialRecord ? partialRecord.partial : undefined

  return diagnosticFromParts({
    diagnostic: mergeDiagnosticList([problemDetails, explicitDiagnostic, ...collectedDiagnostics]),
    requestId,
    traceId,
    steps,
    partial,
  })
}

function mergeDiagnosticList(items: Array<Diagnostic | undefined>): Diagnostic | undefined {
  return items.reduce<Diagnostic | undefined>((current, item) => mergeDiagnostics(current, item), undefined)
}

function mergeDiagnostics(base?: Diagnostic, overlay?: Diagnostic): Diagnostic | undefined {
  if (!base) return overlay
  if (!overlay) return base
  const merged: Diagnostic = {
    ...base,
    ...overlay,
    title: base.title || overlay.title,
    detail: base.detail || overlay.detail,
    requestId: overlay.requestId || base.requestId,
    traceId: overlay.traceId || base.traceId,
    type: overlay.type || base.type,
    instance: overlay.instance || base.instance,
    status: overlay.status ?? base.status,
    observations: mergeStringLists(base.observations, overlay.observations),
    remediation: mergeStringLists(base.remediation, overlay.remediation),
    steps: overlay.steps?.length ? overlay.steps : base.steps,
  }
  if (Object.hasOwn(overlay, 'partial')) {
    merged.partial = overlay.partial
  } else if (Object.hasOwn(base, 'partial')) {
    merged.partial = base.partial
  }
  return merged
}

function mergeStringLists(left?: string[], right?: string[]): string[] | undefined {
  const merged = [...(left || []), ...(right || [])].filter(Boolean)
  return merged.length ? Array.from(new Set(merged)) : undefined
}

function diagnosticFromParts({
  diagnostic,
  requestId,
  traceId,
  steps,
  partial,
}: {
  diagnostic?: Diagnostic
  requestId?: string
  traceId?: string
  steps?: DiagnosticStep[]
  partial?: unknown
}): Diagnostic | undefined {
  const next: Diagnostic = { ...(diagnostic || {}) }
  if (requestId && !next.requestId) next.requestId = requestId
  if (traceId && !next.traceId) next.traceId = traceId
  if (steps?.length && !next.steps?.length) next.steps = steps
  if (partial !== undefined && !Object.hasOwn(next, 'partial')) next.partial = partial
  return hasDiagnosticContent(next) ? next : undefined
}

function hasProblemDetailsSignal(record: Record<string, unknown>): boolean {
  return Object.hasOwn(record, 'type')
    || Object.hasOwn(record, 'title')
    || Object.hasOwn(record, 'status')
    || Object.hasOwn(record, 'detail')
    || Object.hasOwn(record, 'instance')
    || Object.hasOwn(record, 'observations')
    || Object.hasOwn(record, 'observation')
    || Object.hasOwn(record, 'remediation')
    || Object.hasOwn(record, 'remediations')
}

function hasDiagnosticContent(diagnostic: Diagnostic): boolean {
  return Boolean(
    diagnostic.title
    || diagnostic.detail
    || diagnostic.schemaVersion
    || diagnostic.severity
    || diagnostic.scope
    || diagnostic.phase
    || diagnostic.protocol
    || diagnostic.subject
    || diagnostic.retryable
    || diagnostic.redacted !== undefined
    || diagnostic.observations?.length
    || diagnostic.remediation?.length
    || diagnostic.requestId
    || diagnostic.traceId
    || diagnostic.type
    || diagnostic.instance
    || diagnostic.status !== undefined
    || diagnostic.steps?.length
    || Object.hasOwn(diagnostic, 'partial'),
  )
}

function normalizeDiagnosticSteps(value: unknown): DiagnosticStep[] {
  return readRecordArray(value).map((item, index) => {
    const errorRecord = asRecord(item.error)
    const error = readStringValue(item.error)
      || (errorRecord ? readString(errorRecord, 'message') || readString(errorRecord, 'detail') : '')
    const id = readString(item, 'id') || readString(item, 'stepId') || readString(item, 'step_id')
    return {
      id: id || undefined,
      label: readString(item, 'label')
        || readString(item, 'name')
        || readString(item, 'title')
        || id
        || `Diagnostic step ${index + 1}`,
      status: normalizeDiagnosticStepStatus(readString(item, 'status') || readString(item, 'state')),
      detail: readString(item, 'detail') || readString(item, 'description') || readString(item, 'message'),
      error: error || undefined,
    }
  })
}

function normalizeDiagnosticStepStatus(value: string): AgentStepStatus | undefined {
  const clean = value.toLowerCase()
  if (clean === 'pending' || clean === 'running' || clean === 'done' || clean === 'error') return clean
  if (clean === 'completed' || clean === 'complete' || clean === 'success') return 'done'
  if (clean === 'failed' || clean === 'failure' || clean === 'rejected') return 'error'
  if (clean === 'in_progress' || clean === 'started') return 'running'
  return undefined
}

function readTraceId(record: Record<string, unknown>): string {
  return readString(record, 'traceId')
    || readString(record, 'trace_id')
    || readString(record, 'traceID')
    || readString(record, 'trace-id')
}

function readRequestId(record: Record<string, unknown>): string {
  return readString(record, 'requestId')
    || readString(record, 'request_id')
    || readString(record, 'requestID')
    || readString(record, 'request-id')
    || readString(record, 'xRequestId')
    || readString(record, 'x_request_id')
    || readString(record, 'x-request-id')
}

function readDiagnosticFactList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) {
    return value.map(formatDiagnosticFact).filter(Boolean)
  }
  const record = asRecord(value)
  if (!record) return []
  return Object.entries(record)
    .map(([name, item]) => formatDiagnosticNameValue(name, item))
    .filter(Boolean)
}

function readDiagnosticActionList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.map(formatDiagnosticAction).filter(Boolean)
  const record = asRecord(value)
  if (!record) return []
  const actions = Array.isArray(record.actions) ? record.actions.map(formatDiagnosticAction).filter(Boolean) : []
  const summary = readString(record, 'message') || readString(record, 'detail') || readString(record, 'action')
  return summary ? [summary, ...actions] : actions
}

function formatDiagnosticFact(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const record = asRecord(value)
  if (!record) return readStringValue(value)
  const name = readString(record, 'name') || readString(record, 'key') || readString(record, 'field')
  const factValue = readStringValue(record.value ?? record.message ?? record.detail)
  if (name && factValue) return `${name}: ${factValue}`
  if (name) return name
  const entries = Object.entries(record)
    .map(([key, item]) => formatDiagnosticNameValue(key, item))
    .filter(Boolean)
  return entries.join(', ')
}

function formatDiagnosticNameValue(name: string, value: unknown): string {
  const text = readStringValue(value)
  if (!name || !text) return ''
  return `${name}: ${text}`
}

function formatDiagnosticAction(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const record = asRecord(value)
  if (!record) return readStringValue(value)
  const type = readString(record, 'type') || readString(record, 'action')
  const label = readString(record, 'label') || readString(record, 'message') || readString(record, 'detail')
  const target = readString(record, 'targetId') || readString(record, 'target_id') || readString(record, 'href')
  return [label || type, target ? `(${target})` : ''].filter(Boolean).join(' ')
}

function readDiagnosticSubject(value: unknown): string {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (!record) return readStringValue(value)
  return readString(record, 'name')
    || readString(record, 'id')
    || readString(record, 'type')
}

function readRetryable(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return readStringValue(value)
}

function readBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(clean)) return true
    if (['false', '0', 'no', 'off'].includes(clean)) return false
  }
  return undefined
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchWithTimeout(url, init, label, timeoutMs)
  if (!response.ok) throw await httpErrorWithDiagnostic(response, label)
  return response.json() as Promise<T>
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number,
): Promise<Response> {
  const parentSignal = init.signal
  if (parentSignal?.aborted) throw new Error(`${label} request was canceled.`)

  const controller = new AbortController()
  const timeoutMessage = `${label} timed out after ${formatTimeout(timeoutMs)}.`
  const cancelMessage = `${label} request was canceled.`
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let didTimeout = false
  let abortRequest: ((error: Error) => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    abortRequest = reject
  })
  const forwardAbort = () => {
    controller.abort()
    abortRequest?.(new Error(cancelMessage))
  }

  parentSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true
      controller.abort()
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
      abortPromise,
    ])
  } catch (error) {
    if (didTimeout) throw new Error(timeoutMessage)
    if (parentSignal?.aborted && isAbortError(error)) throw new Error(`${label} request was canceled.`)
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    parentSignal?.removeEventListener('abort', forwardAbort)
  }
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function readableMarkdown(value: string): string {
  return value
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function encodePageIdPath(pageId: string): string {
  return pageId.split('/').map((part) => encodeURIComponent(part)).join('/')
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

function emptyKnowledgeGraph(): KnowledgeGraph {
  return { nodes: [], edges: [] }
}

class UnsupportedProtocolClient implements KnowledgeEndpointClient {
  constructor(private readonly protocol: string) {}

  async discover(connection: Connection): Promise<Connection> {
    throw new Error(unsupportedProtocolMessage(this.protocol, connection.name))
  }

  async query(): Promise<KnowledgeQueryResult> {
    throw new Error(unsupportedProtocolMessage(this.protocol))
  }

  async readPage(connection?: Connection): Promise<KnowledgePage> {
    throw new Error(unsupportedProtocolMessage(this.protocol, connection?.name))
  }

  async read(connection?: Connection): Promise<KnowledgePage> {
    throw new Error(unsupportedProtocolMessage(this.protocol, connection?.name))
  }

  async graph(): Promise<KnowledgeGraph> {
    throw new Error(unsupportedProtocolMessage(this.protocol))
  }
}

function unsupportedProtocolMessage(protocol: string, name = 'this source'): string {
  return `${protocol.toUpperCase()} adapter is not implemented in llmwiki-chat; choose llmwiki-http, mcp, or a2a for ${name}.`
}

function unsupportedReadMessage(protocol: string, name = 'this source'): string {
  return `${protocol.toUpperCase()} page read is not implemented in llmwiki-chat; choose llmwiki-http or mcp for ${name}.`
}
