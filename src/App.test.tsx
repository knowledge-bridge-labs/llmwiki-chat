import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { localIoLogStorageKey } from './localIoLog'
import { isReachablePublicHttpsSourceUrl } from './urlPolicy'

const externalRuntimeSourceUrlAdvisoryMessage = 'Warning: selected ready Knowledge Source URLs include HTTP, private, or non-public hosts. External runtimes may not be able to reach them; public or strict deployments should use public HTTPS sources or enforce runtime/proxy allowlists.'
const customA2aRuntimeUrl = 'http://127.0.0.1:8770'
const publicSourceUrl = 'https://wiki.example.test'
const sampleAskButtonName = 'Ask selected source'
const sampleHeadingName = 'Ask Sample Wiki'
const knowledgeSourceStorageKey = 'llmwiki-chat:knowledge-source-connections:v1'
const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'

function queryPayload() {
  return {
    wiki_title: 'Sample Wiki',
    orientation: [{ title: 'Current Focus', role: 'hot', snippet: 'Required copy.' }],
    evidence: [
      {
        page_id: 'hot',
        title: 'Current Focus',
        path: 'hot.md',
        snippet: 'Required copy and release readiness are current focus items.',
        source_refs: ['SRC-HOT'],
      },
    ],
    graph: graphPayload(),
  }
}

function queryPayloadWithoutGraph() {
  const payload = queryPayload()
  return {
    wiki_title: payload.wiki_title,
    orientation: payload.orientation,
    evidence: payload.evidence,
  }
}

function alternateQueryPayload() {
  return {
    wiki_title: 'Sample Wiki',
    orientation: [{ title: 'Later Focus', role: 'topic', snippet: 'Later copy.' }],
    evidence: [
      {
        page_id: 'later-focus',
        title: 'Later Focus',
        path: 'later-focus.md',
        snippet: 'Later evidence should not replace earlier answer evidence.',
        source_refs: ['SRC-LATER'],
      },
    ],
    graph: {
      nodes: [
        { id: 'page:later-focus', label: 'Later Focus', kind: 'topic', path: 'later-focus.md' },
        { id: 'source:SRC-LATER', label: 'SRC-LATER', kind: 'source_ref' },
      ],
      edges: [
        { source: 'page:later-focus', target: 'source:SRC-LATER', relation: 'cites' },
      ],
    },
  }
}

function graphPayload() {
  return {
    nodes: [
      { id: 'page:hot', label: 'Current Focus', kind: 'hot', path: 'hot.md' },
      { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic', path: 'artwork-review.md' },
      { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
    ],
    edges: [
      { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
      { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
    ],
  }
}

function stubFetch(
  queryResponse: () => Promise<Response> | Response = () => Response.json(queryPayload()),
  extra?: (url: string, init?: RequestInit) => Promise<Response | undefined> | Response | undefined,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const extraResponse = await extra?.(url, init)
    if (extraResponse) return extraResponse
    if (url === 'http://127.0.0.1:8788/.well-known/agent-card.json') {
      return Response.json({
        name: 'Local Agent Bridge',
        description: 'Default local bridge',
        url: '/message:send',
        settingsUrl: '/settings',
        capabilities: { streaming: false },
      })
    }
    if (url.endsWith('/query')) return queryResponse()
    if (url.includes('/graph')) return Response.json(graphPayload())
    if (url.endsWith('/manifest')) {
      return Response.json({
        title: 'Sample Wiki',
        description: 'Demo',
        adapter: 'llmwiki-markdown',
        implementation: 'atomicstrata/llm-wiki-compiler',
        page_count: 3,
        approved_page_count: 2,
      })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<Response>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function a2aAgentResultResponse(
  answer: string,
  result: {
    citations?: Array<Record<string, unknown>>
    graph?: Record<string, unknown>
    steps?: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
  } = {},
) {
  return Response.json({
    status: { state: 'completed' },
    artifacts: [
      {
        name: 'llmwiki_agent_result',
        parts: [
          {
            kind: 'data',
            data: {
              answer,
              citations: result.citations || [],
              graph: result.graph || { nodes: [], edges: [] },
              steps: result.steps || [
                {
                  id: 'runtime-answer',
                  label: 'Compose answer',
                  status: 'done',
                  detail: 'Returned a structured markdown answer.',
                },
              ],
              ...(result.metadata || {}),
            },
          },
        ],
      },
    ],
  })
}

function setInputValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
  expect(input).toHaveValue(value)
}

async function askCustomA2aAnswer(
  answer: string,
  result: {
    citations?: Array<Record<string, unknown>>
    graph?: Record<string, unknown>
    steps?: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
  } = {},
  question = 'Render the custom runtime answer',
  options: { disableLocalIoLogging?: boolean } = {},
) {
  const user = userEvent.setup()
  stubFetch(() => Response.json(queryPayload()), async (url) => {
    if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
      return Response.json({
        name: 'External Runtime',
        description: 'Runtime card',
        url: '/message:send',
        capabilities: { streaming: false },
      })
    }
    if (url === `${customA2aRuntimeUrl}/message:send`) return a2aAgentResultResponse(answer, result)
    return undefined
  })

  render(<App />)
  expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

  const sourceCard = screen.getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
  expect(sourceCard).toBeTruthy()
  await openSourceSetup(user, sourceCard as HTMLElement)
  setInputValue(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
  await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))
  expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()

  const runtimeCard = await addRuntime(user, 'Custom A2A')
  await openRuntimeSetup(user, runtimeCard as HTMLElement)
  setInputValue(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
  await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
  expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

  await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))
  if (options.disableLocalIoLogging) {
    await user.click(screen.getByRole('checkbox', { name: /Local I\/O logging/ }))
  }
  setInputValue(screen.getByLabelText('Question'), question)
  await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

  return screen.getByRole('region', { name: 'Chat' })
}

function assistantMessageFor(element: HTMLElement) {
  const message = element.closest('article')
  expect(message).toHaveClass('message', 'assistant')
  return message as HTMLElement
}

async function openRuntimeSetup(user: ReturnType<typeof userEvent.setup>, runtimeCard: HTMLElement) {
  const toggle = runtimeCard.querySelector<HTMLButtonElement>('.runtime-card-toggle')
  expect(toggle).toBeTruthy()
  const toggleButton = toggle as HTMLButtonElement
  if (toggleButton.getAttribute('aria-expanded') !== 'true') {
    await user.click(toggleButton)
  }
}

async function openSourceSetup(user: ReturnType<typeof userEvent.setup>, sourceCard: HTMLElement) {
  const setup = within(sourceCard).getByText('Source setup').closest('details')
  expect(setup).toBeTruthy()
  if (!setup?.hasAttribute('open')) {
    await user.click(within(sourceCard).getByText('Source setup'))
  }
}

async function openAddSource(user: ReturnType<typeof userEvent.setup>) {
  const addSource = screen.getByText('Add source').closest('details')
  expect(addSource).toBeTruthy()
  if (!addSource?.hasAttribute('open')) {
    await user.click(screen.getByText('Add source'))
  }
}

async function openAddRuntime(user: ReturnType<typeof userEvent.setup>) {
  const addRuntime = screen.getByText('Add runtime', { selector: 'span' }).closest('details') as HTMLDetailsElement | null
  expect(addRuntime).toBeTruthy()
  if (!addRuntime?.open) {
    await user.click(screen.getByText('Add runtime', { selector: 'span' }))
  }
  return addRuntime as HTMLDetailsElement
}

async function openInspectorDetails(user: ReturnType<typeof userEvent.setup>) {
  const inspectButton = screen.getByRole('button', { name: /(?:Inspect|Hide) map, pages, and details/ })
  if (inspectButton.getAttribute('aria-expanded') !== 'true') {
    await user.click(inspectButton)
  }
  expect(await screen.findByRole('region', { name: 'Graph' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Pages' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Details' })).toBeInTheDocument()
}

function runtimeCardFor(runtimeName: RegExp | string) {
  const name = typeof runtimeName === 'string' ? new RegExp(runtimeName) : runtimeName
  const runtimeCard = screen.getByRole('radio', { name }).closest('article')
  expect(runtimeCard).toBeTruthy()
  return runtimeCard as HTMLElement
}

async function addRuntime(user: ReturnType<typeof userEvent.setup>, runtimeName: string) {
  await openAddRuntime(user)
  await user.selectOptions(screen.getByLabelText('Runtime type'), screen.getByRole('option', { name: runtimeName }))
  await user.click(screen.getByRole('button', { name: 'Add runtime' }))
  return runtimeCardFor(runtimeName)
}

async function selectLocalDevelopmentRuntime(user: ReturnType<typeof userEvent.setup>) {
  const testingRuntime = screen.getByText('Test-only local runtime').closest('details') as HTMLDetailsElement | null
  expect(testingRuntime).toBeTruthy()
  if (!testingRuntime?.open) {
    await user.click(screen.getByText('Test-only local runtime'))
  }
  await user.click(screen.getByRole('radio', { name: /Local Development Runtime/ }))
}

function writeStoredConnections(
  connections: Array<{
    id: string
    name: string
    nameOverride?: boolean
    protocol: 'llmwiki-http' | 'mcp' | 'a2a'
    url: string
    selected: boolean
  }>,
) {
  window.localStorage.setItem(knowledgeSourceStorageKey, JSON.stringify({ version: 1, connections }))
}

function readStoredConnections() {
  return JSON.parse(window.localStorage.getItem(knowledgeSourceStorageKey) || '{"connections":[]}') as {
    connections: Array<Record<string, unknown>>
  }
}

function writeStoredAgents(
  agents: Array<{
    id: string
    name: string
    protocol: 'bridge-a2a' | 'bridge-mcp' | 'mock-agent' | 'hermes' | 'deepagents' | 'copilot' | 'custom-a2a'
    url: string
    selected: boolean
  }>,
) {
  window.localStorage.setItem(agentRuntimeStorageKey, JSON.stringify({ version: 1, agents }))
}

function writeSelectedLocalBridgeAgent() {
  writeStoredAgents([{
    id: 'bridge-a2a',
    name: 'Local Agent Bridge (A2A)',
    protocol: 'bridge-a2a',
    url: 'http://127.0.0.1:8788',
    selected: true,
  }])
}

function readStoredAgents() {
  return JSON.parse(window.localStorage.getItem(agentRuntimeStorageKey) || '{"agents":[]}') as {
    agents: Array<Record<string, unknown>>
  }
}

function requestHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

function storageDump(storage: Storage): string {
  return Array.from({ length: storage.length }, (_value, index) => storage.key(index) || '')
    .map((key) => `${key}\n${storage.getItem(key) || ''}`)
    .join('\n')
}

function readLocalIoLogEntries(): Array<Record<string, unknown>> {
  const raw = window.localStorage.getItem(localIoLogStorageKey) || ''
  return raw.trim()
    ? raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
    : []
}

function stubA2aRuntimeDiscovery(runtimeUrl = customA2aRuntimeUrl, runtimeName = 'Custom Runtime') {
  return stubFetch(() => Response.json(queryPayload()), async (url) => {
    if (url === `${runtimeUrl}/.well-known/agent-card.json`) {
      return Response.json({
        name: runtimeName,
        description: 'Runtime card',
        runtime: runtimeName,
        url: '/message:send',
        capabilities: { streaming: false },
      })
    }
    return undefined
  })
}

describe('LLMWiki Chat', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it.each([
    'not a url',
    'http://wiki.example.com',
    'http://localhost:8765',
    'https://localhost:8765',
    'http://docs.local',
    'https://docs.local',
    'https://wiki.internal',
    'https://wiki',
    'http://127.0.0.1:8765',
    'https://127.0.0.1:8765',
    'http://10.1.2.3:8765',
    'http://172.16.0.10',
    'http://172.31.255.255',
    'http://192.168.1.20',
    'http://169.254.1.1',
    'http://0.0.0.0:8765',
    'https://100.64.0.1',
    'https://100.127.255.255',
    'https://192.0.0.1',
    'https://192.0.2.1',
    'https://198.18.0.1',
    'https://198.19.255.255',
    'https://198.51.100.1',
    'https://203.0.113.1',
    'https://224.0.0.1',
    'https://239.255.255.255',
    'https://240.0.0.1',
    'https://255.255.255.255',
    'http://[::1]:8765',
    'http://[fd00::1]',
    'http://[fe80::1]',
    'https://[::]',
    'https://[::1]:8765',
    'https://[fc00::1]',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://[ff00::1]',
    'https://[2001:db8::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:192.168.1.1]',
    'https://[::ffff:100.64.0.1]',
    'https://[::ffff:198.18.0.1]',
  ])('classifies %s as unavailable to external runtimes', (url) => {
    expect(isReachablePublicHttpsSourceUrl(url)).toBe(false)
  })

  it.each([
    'https://wiki.example.com',
    'https://knowledge.example.test',
    'https://172.32.0.1',
    'https://[2001:4860:4860::8888]',
  ])('allows public-looking HTTPS source URL %s before runtime validation', (url) => {
    expect(isReachablePublicHttpsSourceUrl(url)).toBe(true)
  })

  it('renders connection inventory and composer', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getAllByText('LLMWiki Chat').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).not.toBeChecked()
    expect(await screen.findByRole('heading', { name: sampleHeadingName })).toBeInTheDocument()
    const localSummary = screen.getByLabelText('Local sample source and runtime')
    expect(within(localSummary).getByText('Sample Wiki')).toBeInTheDocument()
    expect(within(localSummary).getByText('local sample endpoint · 1 ready')).toBeInTheDocument()
    expect(within(localSummary).getByText('Runtime and endpoint details')).toBeInTheDocument()
    expect(within(localSummary).getByText('Local Development Runtime')).toBeInTheDocument()
    expect(within(localSummary).getByText(/http:\/\/127\.0\.0\.1:8765/)).toBeInTheDocument()
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const agentRuntime = screen.getByRole('region', { name: 'Agent runtime' })
    expect(sources.compareDocumentPosition(agentRuntime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(agentRuntime).getByRole('heading', { name: 'Agent Runtime' })).toBeInTheDocument()
    const bridgeCard = within(agentRuntime).getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ }).closest('article')
    expect(bridgeCard).toBeTruthy()
    const mcpBridgeCard = within(agentRuntime).getByRole('radio', { name: /Local Agent Bridge \(MCP\)/ }).closest('article')
    expect(mcpBridgeCard).toBeTruthy()
    expect(within(mcpBridgeCard as HTMLElement).getByRole('radio', { name: /Local Agent Bridge \(MCP\)/ })).not.toBeChecked()
    const bridgeSetupToggle = (bridgeCard as HTMLElement).querySelector<HTMLButtonElement>('.runtime-card-toggle')
    const mcpSetupToggle = (mcpBridgeCard as HTMLElement).querySelector<HTMLButtonElement>('.runtime-card-toggle')
    expect(bridgeSetupToggle).toBeTruthy()
    expect(mcpSetupToggle).toBeTruthy()
    const bridgeSetupButton = bridgeSetupToggle as HTMLButtonElement
    const mcpSetupButton = mcpSetupToggle as HTMLButtonElement
    expect(bridgeSetupButton).toHaveAttribute('aria-expanded', 'false')
    expect(within(bridgeCard as HTMLElement).queryByText(/Agent Bridge A2A/)).not.toBeInTheDocument()
    expect(within(bridgeCard as HTMLElement).queryByRole('button', { name: 'Test bridge' })).not.toBeInTheDocument()
    expect(mcpSetupButton).toHaveAttribute('aria-expanded', 'false')
    expect(within(mcpBridgeCard as HTMLElement).queryByText(/Agent Bridge MCP/)).not.toBeInTheDocument()
    await openRuntimeSetup(user, bridgeCard as HTMLElement)
    expect(bridgeSetupButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(bridgeCard as HTMLElement).getByText(/Agent Bridge A2A/)).toBeInTheDocument()
    expect(within(bridgeCard as HTMLElement).getByRole('button', { name: 'Test bridge' })).toBeInTheDocument()
    expect(within(bridgeCard as HTMLElement).getByRole('link', { name: 'Open bridge settings' })).toHaveAttribute('href', 'http://127.0.0.1:8788/settings')
    const testingRuntime = within(agentRuntime).getByText('Test-only local runtime').closest('details') as HTMLDetailsElement | null
    expect(testingRuntime).toBeTruthy()
    expect(testingRuntime?.open).toBe(true)
    expect(within(agentRuntime).getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    const addRuntime = screen.getByText('Add runtime', { selector: 'span' }).closest('details') as HTMLDetailsElement | null
    expect(addRuntime).toBeTruthy()
    expect(addRuntime?.open).toBe(false)
    expect(screen.getByLabelText('Runtime type')).not.toBeVisible()
    expect(screen.queryByRole('radio', { name: /Hermes/ })).not.toBeInTheDocument()
    const knowledgeMap = screen.getByRole('region', { name: 'Knowledge map' })
    expect(within(knowledgeMap).getAllByText('Sample Wiki').length).toBeGreaterThan(0)
    expect(within(knowledgeMap).getByText('2')).toBeInTheDocument()
    expect(within(knowledgeMap).getByText('pages')).toBeInTheDocument()
    expect(within(knowledgeMap).getByRole('button', { name: 'Inspect map, pages, and details' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(knowledgeMap).queryByRole('button', { name: 'Ask selected' })).not.toBeInTheDocument()
    expect(within(knowledgeMap).queryByRole('button', { name: 'Write question' })).not.toBeInTheDocument()
    expect(within(knowledgeMap).queryByRole('button', { name: 'Explore source graph' })).not.toBeInTheDocument()
    expect(within(knowledgeMap).queryByText(/fallback/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Inspector scope' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Graph' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Details' })).not.toBeInTheDocument()
    await openInspectorDetails(user)
    expect(within(knowledgeMap).getByRole('button', { name: 'Hide map, pages, and details' })).toHaveAttribute('aria-expanded', 'true')
    expect(sources).toBeInTheDocument()
    expect(screen.getByLabelText('Question')).toBeInTheDocument()
    expect(screen.getByLabelText('Question')).toHaveValue('')
    expect(within(sources).getByText('Sample Wiki')).toBeInTheDocument()
    expect(within(sources).getByLabelText('Source selection selected')).toBeInTheDocument()
  })

  it('progressively reveals quickstart source, runtime, and optional bridge steps', async () => {
    const user = userEvent.setup()
    let sourceAvailable = false
    const bridgeAvailable = false
    const fetchMock = stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url === 'http://127.0.0.1:8765/manifest' && !sourceAvailable) {
        return new Response('source missing', { status: 404 })
      }
      if (url === 'http://127.0.0.1:8788/.well-known/agent-card.json' && !bridgeAvailable) {
        return new Response('bridge missing', { status: 404 })
      }
      return undefined
    })

    render(<App />)

    expect(screen.queryByRole('region', { name: 'Quickstart' })).not.toBeInTheDocument()
    const quickstartToggle = screen.getByRole('button', { name: 'Show Quickstart' })
    expect(quickstartToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(quickstartToggle)

    expect(quickstartToggle).toHaveAttribute('aria-expanded', 'true')
    const quickstart = await screen.findByRole('region', { name: 'Quickstart' })
    await waitFor(() => {
      expect(quickstart).toHaveFocus()
    })
    expect(within(quickstart).getByRole('heading', {
      name: 'Step 1: connect llmwiki-serve.',
    })).toBeInTheDocument()
    expect(within(quickstart).getByText(/cannot install packages, start local processes/)).toBeInTheDocument()
    expect(within(quickstart).getByText(/For a first pass, you only need/)).toBeInTheDocument()
    const sourceStep = within(quickstart).getByRole('region', { name: 'Step 1 source setup' })
    const sourceStatus = within(sourceStep).getByLabelText('Quickstart source status')
    expect(within(sourceStatus).getByText('Sample source')).toBeInTheDocument()
    expect(within(sourceStatus).getByText('http://127.0.0.1:8765')).toBeInTheDocument()
    expect(within(sourceStep).getByText(/If this check fails or stays unknown/)).toBeInTheDocument()
    expect(within(sourceStep).getByRole('button', { name: 'Test sample source' })).toBeInTheDocument()
    expect(within(quickstart).queryByRole('region', { name: 'Step 2 runtime choice' })).not.toBeInTheDocument()
    expect(within(quickstart).queryByRole('button', { name: 'Use Local Development Runtime' })).not.toBeInTheDocument()
    expect(within(quickstart).queryByRole('button', { name: 'Test local bridge' })).not.toBeInTheDocument()
    expect(within(quickstart).queryByText(/Hermes|DeepAgents|llmwiki-agent-bridge@0\.1\.0/)).not.toBeInTheDocument()
    expect(within(quickstart).getByText(/llmwiki-serve==0\.2\.0/)).toBeInTheDocument()
    expect(within(quickstart).getByText('/path/to/wiki')).toBeInTheDocument()

    fetchMock.mockClear()
    sourceAvailable = true
    await user.click(within(sourceStep).getByRole('button', { name: 'Test sample source' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('http://127.0.0.1:8765/manifest'))).toBe(true)
    })
    const runtimeStep = await within(quickstart).findByRole('region', { name: 'Step 2 runtime choice' })
    expect(within(runtimeStep).getByText(/Default: use Local Development Runtime/)).toBeInTheDocument()
    expect(within(runtimeStep).getByText(/needs no external LLM endpoint/)).toBeInTheDocument()
    expect(within(runtimeStep).getByText(/Serve-only path is ready/)).toBeInTheDocument()
    expect(within(runtimeStep).getByRole('button', { name: 'Continue serve-only' })).toBeEnabled()
    expect(within(runtimeStep).getByRole('button', { name: 'Show optional bridge/runtime steps' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(runtimeStep).queryByRole('button', { name: 'Test local bridge' })).not.toBeInTheDocument()
    expect(within(runtimeStep).queryByText(/Hermes|DeepAgents|llmwiki-agent-bridge@0\.1\.0/)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()

    await user.click(within(runtimeStep).getByRole('button', { name: 'Show optional bridge/runtime steps' }))
    const advancedRuntime = within(runtimeStep).getByRole('region', { name: 'Optional bridge runtime steps' })
    expect(within(advancedRuntime).getByText(/No bridge or LLM endpoint\? Skip this/)).toBeInTheDocument()
    expect(within(advancedRuntime).getByText(/Hermes, DeepAgents, or OpenAI-compatible runtimes/)).toBeInTheDocument()
    expect(within(advancedRuntime).getByRole('link', { name: 'Quickstart docs' })).toHaveAttribute(
      'href',
      'https://knowledge-bridge-labs.github.io/llmwiki-docs/quickstart',
    )
    expect(within(advancedRuntime).getByRole('link', { name: 'Runtime adapter notes' })).toHaveAttribute(
      'href',
      'https://knowledge-bridge-labs.github.io/llmwiki-docs/runtime-adapters',
    )
    expect(within(advancedRuntime).getByRole('link', { name: 'Agent Bridge README' })).toHaveAttribute(
      'href',
      'https://github.com/knowledge-bridge-labs/llmwiki-agent-bridge#readme',
    )
    expect(within(advancedRuntime).getByRole('button', { name: 'Test local bridge' })).toBeInTheDocument()
    expect(within(advancedRuntime).getByText(/llmwiki-agent-bridge@0\.1\.0/)).toBeInTheDocument()

    fetchMock.mockClear()
    await user.click(within(advancedRuntime).getByRole('button', { name: 'Test local bridge' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('http://127.0.0.1:8788/.well-known/agent-card.json'))).toBe(true)
    })
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).toBeChecked()
    expect(await within(advancedRuntime).findByText(/Bridge test failed/)).toBeInTheDocument()
    expect(within(advancedRuntime).getByText(/Start or restart/)).toBeInTheDocument()
    expect(within(advancedRuntime).getAllByText(/http:\/\/127\.0\.0\.1:8788/).length).toBeGreaterThan(0)
    expect(within(advancedRuntime).getByText(/skip\/continue serve-only/)).toBeInTheDocument()
    expect(within(advancedRuntime).getByText(/No bridge or LLM endpoint\? Skip this/)).toBeInTheDocument()
    expect(within(runtimeStep).getByRole('button', { name: 'Use Local Development Runtime' })).toBeEnabled()
    await user.click(within(runtimeStep).getByRole('button', { name: 'Use Local Development Runtime' }))
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()

    await user.click(within(advancedRuntime).getByRole('button', { name: 'Skip and close' }))
    expect(screen.queryByRole('region', { name: 'Quickstart' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Quickstart' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('auto-collapses ready sidebar sections and allows manual expansion for editing', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === 'http://127.0.0.1:8788/.well-known/agent-card.json') {
        return Response.json({
          name: 'Local Agent Bridge',
          description: 'Bridge card',
          url: '/message:send',
          settingsUrl: '/settings',
          capabilities: { streaming: false },
        })
      }
      return undefined
    })

    render(<App />)

    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const sourceToggle = within(sources).getByRole('button', { name: /Knowledge Sources/ })
    await waitFor(() => {
      expect(sourceToggle).toHaveAttribute('aria-expanded', 'false')
    })

    await user.click(sourceToggle)
    expect(sourceToggle).toHaveAttribute('aria-expanded', 'true')
    const sourceCard = within(sources).getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
    expect(sourceCard).toBeTruthy()
    await openSourceSetup(user, sourceCard as HTMLElement)
    await user.clear(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'))
    await user.type(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
    await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))
    expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()
    await waitFor(() => {
      expect(sourceToggle).toHaveAttribute('aria-expanded', 'false')
    })

    const agentBridge = screen.getByRole('region', { name: 'Agent runtime' })
    const bridgeToggleElement = agentBridge.querySelector<HTMLButtonElement>('.sidebar-section-toggle')
    expect(bridgeToggleElement).toBeTruthy()
    const bridgeToggle = bridgeToggleElement as HTMLButtonElement
    expect(bridgeToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(bridgeToggle)
    expect(bridgeToggle).toHaveAttribute('aria-expanded', 'true')
    const bridgeCard = within(agentBridge).getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ }).closest('article')
    expect(bridgeCard).toBeTruthy()

    await openRuntimeSetup(user, bridgeCard as HTMLElement)
    await user.click(within(bridgeCard as HTMLElement).getByRole('button', { name: 'Test bridge' }))

    expect(await within(bridgeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
    expect(bridgeToggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('selects an explicitly added Custom A2A runtime', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).not.toBeChecked()

    const runtimeCard = await addRuntime(user, 'Custom A2A')

    expect(within(runtimeCard).getByRole('radio', { name: /Custom A2A/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(MCP\)/ })).not.toBeChecked()
    expect(within(runtimeCard).getByLabelText('Agent runtime status unavailable')).toBeInTheDocument()
  })

  it('lets users rename a registered Knowledge Source and keeps that name after discovery', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const sourceCard = screen.getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
    expect(sourceCard).toBeTruthy()

    await openSourceSetup(user, sourceCard as HTMLElement)
    await user.clear(within(sourceCard as HTMLElement).getByLabelText('Source display label'))
    await user.type(within(sourceCard as HTMLElement).getByLabelText('Source display label'), 'Renamed Project Wiki')

    expect(within(sourceCard as HTMLElement).getByRole('checkbox', { name: 'Renamed Project Wiki' })).toBeChecked()
    await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))

    expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()
    expect(within(sourceCard as HTMLElement).getByRole('checkbox', { name: 'Renamed Project Wiki' })).toBeChecked()
    await waitFor(() => {
      expect(readStoredConnections().connections).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'local-demo',
          name: 'Renamed Project Wiki',
          nameOverride: true,
        }),
      ]))
    })
  })

  it('updates the bridge settings link from discovered A2A metadata', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === 'http://127.0.0.1:8788/.well-known/agent-card.json') {
        return Response.json({
          name: 'Local Agent Bridge',
          description: 'Bridge card',
          url: '/message:send',
          settingsUrl: '/bridge-settings',
          capabilities: { streaming: false },
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const bridgeCard = screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ }).closest('article')
    expect(bridgeCard).toBeTruthy()

    await openRuntimeSetup(user, bridgeCard as HTMLElement)
    await user.click(within(bridgeCard as HTMLElement).getByRole('button', { name: 'Test bridge' }))

    expect(await within(bridgeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
    expect(within(bridgeCard as HTMLElement).getByRole('link', { name: 'Open bridge settings' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:8788/bridge-settings',
    )
    await waitFor(() => {
      expect(readStoredAgents().agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'bridge-a2a',
          settingsUrl: 'http://127.0.0.1:8788/bridge-settings',
        }),
      ]))
    })
  })

  it('shows Agent Bridge registered sources in Knowledge Sources without persisting them as direct sources', async () => {
    writeSelectedLocalBridgeAgent()
    const fetchMock = stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-wiki',
                    name: 'Bridge Wiki',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19870',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 1,
              },
            },
          },
        })
      }
      return undefined
    })

    render(<App />)

    const bridgeSource = await screen.findByRole('checkbox', { name: 'Bridge Wiki' })
    expect(bridgeSource).toBeChecked()
    const sourceCard = bridgeSource.closest('article')
    expect(sourceCard).toBeTruthy()
    expect(within(sourceCard as HTMLElement).getByText('Bridge source')).toBeInTheDocument()
    expect(within(sourceCard as HTMLElement).getByText('Managed by Local Agent Bridge (A2A)')).toBeInTheDocument()
    expect(within(sourceCard as HTMLElement).queryByRole('button', { name: 'Test source' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8788/mcp',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    await waitFor(() => {
      expect(readStoredConnections().connections.some((connection) => connection.name === 'Bridge Wiki')).toBe(false)
    })
  })

  it('uses a bridge-managed source when it duplicates an unavailable default direct endpoint', async () => {
    writeSelectedLocalBridgeAgent()
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8765/manifest') {
        return new Response('not found', { status: 404 })
      }
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-sample',
                    name: 'Bridge Sample',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:8765',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 1,
              },
            },
          },
        })
      }
      return undefined
    })

    render(<App />)

    const bridgeSource = await screen.findByRole('checkbox', { name: 'Bridge Sample' })
    expect(bridgeSource).toBeChecked()
    const summary = screen.getByRole('group', { name: 'Active knowledge source summary' })
    await waitFor(() => {
      expect(within(summary).getAllByText('Bridge Sample').length).toBeGreaterThan(0)
      expect(within(summary).getByText('1 selected · 1 ready available')).toBeInTheDocument()
      expect(within(summary).getByText('Selected sources tested successfully.')).toBeInTheDocument()
    })

    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const directSource = within(sources).getByRole('checkbox', { name: 'Local sample LLMWiki' })
    expect(directSource).not.toBeChecked()
    const bridgeCard = bridgeSource.closest('article')
    expect(bridgeCard).toBeTruthy()
    expect(within(bridgeCard as HTMLElement).getByText('Bridge source')).toBeInTheDocument()
    expect(within(bridgeCard as HTMLElement).getByText('Managed by Local Agent Bridge (A2A)')).toBeInTheDocument()
  })

  it('drops bridge-managed source selection after users edit a direct source for a custom runtime', async () => {
    const user = userEvent.setup()
    writeSelectedLocalBridgeAgent()
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-sample',
                    name: 'Bridge Sample',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:8765',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 1,
              },
            },
          },
        })
      }
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      return undefined
    })

    render(<App />)

    expect(await screen.findByRole('checkbox', { name: 'Bridge Sample' })).toBeChecked()
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const directSource = await within(sources).findByRole('checkbox', { name: 'Sample Wiki' })
    expect(directSource).not.toBeChecked()
    const directCard = directSource.closest('article')
    expect(directCard).toBeTruthy()
    await openSourceSetup(user, directCard as HTMLElement)
    await user.clear(within(directCard as HTMLElement).getByLabelText('Sample Wiki URL'))
    await user.type(within(directCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
    await user.click(within(directCard as HTMLElement).getByRole('button', { name: 'Test source' }))
    expect(await within(directCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()
    expect(within(sources).getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    expect(within(sources).getByRole('checkbox', { name: 'Bridge Sample' })).not.toBeChecked()
    expect(within(sources).getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()
    const summary = screen.getByRole('group', { name: 'Active knowledge source summary' })
    expect(within(summary).getAllByText('Sample Wiki').length).toBeGreaterThan(0)
    expect(within(summary).getByText('1 selected · 1 ready available')).toBeInTheDocument()
  })

  it('keeps a bridge run alive through no-op source selection and duplicate discovery refreshes', async () => {
    const user = userEvent.setup()
    writeSelectedLocalBridgeAgent()
    const messageSend = deferredResponse()
    let messageSendCalls = 0
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-sample',
                    name: 'Bridge Sample',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:8765',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 1,
              },
            },
          },
        })
      }
      if (url === 'http://127.0.0.1:8788/message:send') {
        messageSendCalls += 1
        const signal = init?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => {
          messageSend.reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
        return messageSend.promise
      }
      return undefined
    })

    render(<App />)

    const bridgeSource = await screen.findByRole('checkbox', { name: 'Bridge Sample' })
    expect(bridgeSource).toBeChecked()
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    await waitFor(() => {
      expect(messageSendCalls).toBe(1)
    })

    const bridgeSourceCard = bridgeSource.closest('article')
    expect(bridgeSourceCard).toBeTruthy()
    await user.click(within(bridgeSourceCard as HTMLElement).getByRole('button', { name: 'Use only this source' }))

    const agentBridge = screen.getByRole('region', { name: 'Agent runtime' })
    const bridgeCard = within(agentBridge).getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ }).closest('article')
    expect(bridgeCard).toBeTruthy()
    await openRuntimeSetup(user, bridgeCard as HTMLElement)
    await user.click(within(bridgeCard as HTMLElement).getByRole('button', { name: 'Test bridge' }))

    messageSend.resolve(a2aAgentResultResponse('Bridge completed after refresh.'))

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('Bridge completed after refresh.')).toBeInTheDocument()
    expect(within(chat).queryByText(/Canceled because the selected scope changed/)).not.toBeInTheDocument()
    expect(messageSendCalls).toBe(1)
  })

  it('keeps the ready Knowledge Sources section open while users change selected sources', async () => {
    const user = userEvent.setup()
    writeSelectedLocalBridgeAgent()
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-alpha',
                    name: 'Bridge Alpha',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19871',
                    status: 'ready',
                    selected: true,
                  },
                  {
                    id: 'bridge-beta',
                    name: 'Bridge Beta',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19872',
                    status: 'ready',
                    selected: true,
                  },
                  {
                    id: 'bridge-gamma',
                    name: 'Bridge Gamma',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19873',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 3,
              },
            },
          },
        })
      }
      return undefined
    })

    render(<App />)

    expect(await screen.findByRole('checkbox', { name: 'Bridge Alpha' })).toBeChecked()
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const sourceToggle = within(sources).getByRole('button', { name: /Knowledge Sources/ })
    await waitFor(() => {
      expect(sourceToggle).toHaveAttribute('aria-expanded', 'false')
    })

    await user.click(sourceToggle)
    expect(sourceToggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(sources).getByRole('checkbox', { name: 'Bridge Beta' }))
    expect(sourceToggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(sources).getByRole('checkbox', { name: 'Bridge Gamma' }))
    expect(sourceToggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Alpha' })).toBeChecked()
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Beta' })).not.toBeChecked()
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Gamma' })).not.toBeChecked()
  })

  it('deduplicates Agent Bridge sources by endpoint when switching A2A and MCP bridge runtimes', async () => {
    const user = userEvent.setup()
    writeSelectedLocalBridgeAgent()
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/mcp') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        if (body.method === 'tools/list') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [{ name: 'llmwiki_agent_run' }, { name: 'llmwiki_list_sources' }],
              settingsUrl: 'http://127.0.0.1:8788/settings/agents',
            },
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              llmwiki_sources: {
                sources: [
                  {
                    id: 'bridge-alpha',
                    name: 'Bridge Alpha',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19871',
                    status: 'ready',
                    selected: true,
                  },
                  {
                    id: 'bridge-beta',
                    name: 'Bridge Beta',
                    protocol: 'llmwiki-http',
                    url: 'http://127.0.0.1:19872',
                    status: 'ready',
                    selected: true,
                  },
                ],
                readySourceCount: 2,
              },
            },
          },
        })
      }
      return undefined
    })

    render(<App />)

    expect(await screen.findByRole('checkbox', { name: 'Bridge Alpha' })).toBeChecked()
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const sourceToggle = within(sources).getByRole('button', { name: /Knowledge Sources/ })
    await user.click(sourceToggle)
    await user.click(within(sources).getByRole('checkbox', { name: 'Bridge Beta' }))
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Beta' })).not.toBeChecked()

    const agentBridge = screen.getByRole('region', { name: 'Agent runtime' })
    const bridgeToggleElement = agentBridge.querySelector<HTMLButtonElement>('.sidebar-section-toggle')
    expect(bridgeToggleElement).toBeTruthy()
    const bridgeToggle = bridgeToggleElement as HTMLButtonElement
    if (bridgeToggle.getAttribute('aria-expanded') !== 'true') {
      await user.click(bridgeToggle)
    }
    const mcpCard = within(agentBridge).getByRole('radio', { name: /Local Agent Bridge \(MCP\)/ }).closest('article')
    expect(mcpCard).toBeTruthy()
    await user.click(within(mcpCard as HTMLElement).getByRole('button', { name: 'Use Local Agent Bridge (MCP) runtime' }))

    await waitFor(() => {
      expect(within(agentBridge).getByRole('radio', { name: /Local Agent Bridge \(MCP\)/ })).toBeChecked()
      expect(screen.getAllByRole('checkbox', { name: 'Bridge Alpha' })).toHaveLength(1)
      expect(screen.getAllByRole('checkbox', { name: 'Bridge Beta' })).toHaveLength(1)
    })
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Alpha' })).toBeChecked()
    expect(within(sources).getByRole('checkbox', { name: 'Bridge Beta' })).not.toBeChecked()
  })

  it('shows bridge settings for Hermes when the discovered runtime is an Agent Bridge profile', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'LLMWiki Agent Bridge for Hermes',
          description: 'Local A2A-compatible bridge for Hermes.',
          runtime: 'hermes',
          url: '/message:send',
          capabilities: { streaming: false, localBridge: true },
          metadata: { settingsUrl: '/settings' },
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const runtimeCard = await addRuntime(user, 'Hermes')

    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Hermes runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))

    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
    expect(within(runtimeCard as HTMLElement).getByRole('link', { name: 'Open bridge settings' })).toHaveAttribute(
      'href',
      `${customA2aRuntimeUrl}/settings`,
    )
  })

  it('keeps the Hermes add path visible after Local Development Runtime is selected', async () => {
    const user = userEvent.setup()
    writeStoredAgents([
      {
        id: 'mock-agent',
        name: 'Local Development Runtime',
        protocol: 'mock-agent',
        url: '',
        selected: true,
      },
    ])

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const agentBridge = screen.getByRole('region', { name: 'Agent runtime' })
    await user.click(within(agentBridge).getByRole('button', { name: /Configure Agent Runtime/ }))

    const addRuntime = screen.getByText('Add runtime', { selector: 'span' }).closest('details') as HTMLDetailsElement | null
    expect(addRuntime).toBeTruthy()
    expect(addRuntime?.open).toBe(false)
    expect(screen.getByLabelText('Runtime type')).not.toBeVisible()
    expect(within(agentBridge).getByText(/Local deterministic runtime/)).toBeInTheDocument()
    expect(within(agentBridge).getByText('Testing/developer mock for UI, trace, citation, and graph checks.')).toBeInTheDocument()
    await openAddRuntime(user)
    expect(screen.getByRole('option', { name: 'Hermes' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Runtime type'), screen.getByRole('option', { name: 'Hermes' }))
    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    expect(screen.getByRole('radio', { name: /Hermes/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).not.toBeChecked()
  })

  it('keeps Hermes explicitly selectable across repeated add and remove cycles', async () => {
    const user = userEvent.setup()
    stubA2aRuntimeDiscovery(customA2aRuntimeUrl, 'Hermes')

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    let hermesCard = await addRuntime(user, 'Hermes')
    expect(within(hermesCard).getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()

    await openRuntimeSetup(user, hermesCard as HTMLElement)
    await user.click(within(hermesCard as HTMLElement).getByRole('button', { name: 'Remove runtime' }))
    expect(screen.queryByRole('radio', { name: /Hermes/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Runtime type')).toHaveValue('hermes')

    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    hermesCard = runtimeCardFor(/Hermes/)
    expect(within(hermesCard).getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()

    await openRuntimeSetup(user, hermesCard)
    await user.click(within(hermesCard).getByRole('button', { name: 'Remove runtime' }))
    expect(screen.queryByRole('radio', { name: /Hermes/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Runtime type')).toHaveValue('hermes')

    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    hermesCard = runtimeCardFor(/Hermes/)
    expect(within(hermesCard).getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()
    await openRuntimeSetup(user, hermesCard)
    await user.type(within(hermesCard).getByLabelText('Hermes runtime URL'), customA2aRuntimeUrl)
    await user.tab()
    expect(await within(hermesCard).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use Local Agent Bridge (A2A) runtime' }))
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).toBeChecked()
    hermesCard = runtimeCardFor(/Hermes/)
    await user.click(within(hermesCard).getByRole('button', { name: 'Use Hermes runtime' }))
    expect(within(hermesCard).getByRole('radio', { name: /Hermes/ })).toBeChecked()
  })

  it('keeps bridge bearer tokens in tab state only', async () => {
    const user = userEvent.setup()
    writeSelectedLocalBridgeAgent()
    const authHeaders: Array<string | null> = []
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === 'http://127.0.0.1:8788/.well-known/agent-card.json') {
        authHeaders.push(requestHeader(init, 'authorization'))
        return Response.json({
          name: 'Local Agent Bridge',
          description: 'Bridge card',
          url: '/message:send',
          settingsUrl: '/settings',
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const bridgeCard = screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ }).closest('article')
    expect(bridgeCard).toBeTruthy()

    await openRuntimeSetup(user, bridgeCard as HTMLElement)
    await user.type(within(bridgeCard as HTMLElement).getByLabelText('Local Agent Bridge (A2A) bearer token'), 'bridge-secret')
    expect(within(bridgeCard as HTMLElement).getByText('Bearer token set for this tab only.')).toBeInTheDocument()
    await waitFor(() => {
      const raw = window.localStorage.getItem(agentRuntimeStorageKey) || ''
      expect(raw).not.toContain('bridge-secret')
      expect(raw).not.toContain('bearerToken')
    })

    await user.click(within(bridgeCard as HTMLElement).getByRole('button', { name: 'Test bridge' }))
    expect(await within(bridgeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
    expect(authHeaders).toEqual([null, 'Bearer bridge-secret'])
    await waitFor(() => {
      const raw = window.localStorage.getItem(agentRuntimeStorageKey) || ''
      expect(raw).not.toContain('bridge-secret')
      expect(raw).not.toContain('bearerToken')
    })
  })

  it('restores a selected Custom A2A config without overwriting it with the default runtime', async () => {
    stubA2aRuntimeDiscovery()
    writeStoredAgents([
      {
        id: 'custom-a2a',
        name: 'Custom A2A',
        protocol: 'custom-a2a',
        url: customA2aRuntimeUrl,
        selected: true,
      },
    ])

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const runtimeCard = screen.getByRole('radio', { name: /Custom A2A/ }).closest('article')
    expect(runtimeCard).toBeTruthy()
    expect(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ })).toBeChecked()
    await openRuntimeSetup(userEvent.setup(), runtimeCard as HTMLElement)
    expect(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL')).toHaveValue(customA2aRuntimeUrl)
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await waitFor(() => {
      expect(readStoredAgents().agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-a2a',
          protocol: 'custom-a2a',
          url: customA2aRuntimeUrl,
          selected: true,
        }),
      ]))
    })
  })

  it('prioritizes page-level map nodes and keeps lower-level nodes in Details', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.includes('/graph')) {
        return Response.json({
          nodes: [
            { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic', path: 'artwork-review.md' },
            { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
            { id: 'heading:hot-release', label: 'Release checklist heading', kind: 'heading', path: 'hot.md' },
            { id: 'page:index', label: 'Sample Index', kind: 'index', path: 'index.md' },
            { id: 'page:hot', label: 'Current Focus', kind: 'hot', path: 'hot.md' },
          ],
          edges: [
            { source: 'page:index', target: 'page:hot', relation: 'links_to' },
            { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
            { source: 'page:hot', target: 'heading:hot-release', relation: 'contains' },
            { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
          ],
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    const nodes = await screen.findByRole('region', { name: 'Pages' })
    const pageButtons = within(nodes).getAllByRole('button')
    expect(pageButtons[0]).toHaveAccessibleName(/Current Focus hot/)
    expect(pageButtons[1]).toHaveAccessibleName(/Sample Index index/)
    expect(pageButtons[2]).toHaveAccessibleName(/Artwork Review Process topic/)
    expect(within(nodes).queryByText('SRC-HOT')).not.toBeInTheDocument()
    expect(within(nodes).queryByText('Release checklist heading')).not.toBeInTheDocument()

    await user.click(within(nodes).getByRole('button', { name: /Current Focus hot/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByText('Release checklist heading')).toBeInTheDocument()
    expect(within(details).getByText('SRC-HOT')).toBeInTheDocument()
  })

  it('lazy loads and renders the selected page full markdown in Details', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.endsWith('/read/hot.md')) {
        return Response.json({
          id: 'hot',
          title: 'Current Focus',
          path: 'hot.md',
          role: 'hot',
          text: [
            '# Current Focus Full Markdown',
            '',
            'Full body content from the page read endpoint.',
            '',
            'Related page: [[Artwork Review Process|artwork process]] and [[Research - Pi Terminal Agent Harness]].',
            '[[Research - Pi Terminal Agent Harness]] — synthesis notes should read as a page link chip.',
            '...[[Research - Pi Terminal Agent Harness]] — synthesis: Pi (badlogic, 39.8k stars), oh-my-pi (can1357), TTSR, JSONL session tree',
            '[[overview]] | [[log]] | [[hot]]',
            '',
            '| Field | Value |',
            '| --- | --- |',
            '| State | Ready |',
          ].join('\n'),
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    const nodes = screen.getByRole('region', { name: 'Pages' })
    await user.click(within(nodes).getByRole('button', { name: /Current Focus hot/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    const markdown = await within(details).findByLabelText('Selected page markdown')
    expect(within(markdown).getByRole('heading', { name: 'Current Focus Full Markdown' })).toBeInTheDocument()
    expect(within(markdown).getByText('Full body content from the page read endpoint.')).toBeInTheDocument()
    expect(within(markdown).queryByText('[[Artwork Review Process|artwork process]]')).not.toBeInTheDocument()
    expect(within(markdown).queryByText('[[overview]] | [[log]] | [[hot]]')).not.toBeInTheDocument()
    expect(markdown).not.toHaveTextContent('[[')
    expect(within(markdown).getByRole('button', { name: 'artwork process' })).toHaveClass('wiki-link-button')
    const researchChips = within(markdown).getAllByText('Research - Pi Terminal Agent Harness')
    expect(researchChips.length).toBeGreaterThan(0)
    expect(researchChips[0]).toHaveClass('wiki-link')
    expect(markdown).toHaveTextContent('synthesis notes should read as a page link chip.')
    expect(markdown).toHaveTextContent('synthesis: Pi (badlogic, 39.8k stars), oh-my-pi (can1357), TTSR, JSONL session tree')
    expect(within(markdown).queryByText(/\[\[Research - Pi Terminal Agent Harness\]\]/)).not.toBeInTheDocument()
    const linkRow = within(markdown).getByRole('navigation', { name: 'Page links' })
    expect(linkRow).toHaveClass('wiki-link-row')
    expect(linkRow).not.toHaveTextContent('|')
    expect(within(linkRow).getByText('overview')).toHaveClass('wiki-link')
    expect(within(linkRow).getByText('log')).toHaveClass('wiki-link')
    expect(within(linkRow).getByRole('button', { name: 'hot' })).toHaveClass('wiki-link-button')
    expect(within(markdown).getByRole('table')).toBeInTheDocument()
    expect(within(markdown).getByRole('cell', { name: 'Ready' })).toBeInTheDocument()

    await user.click(within(markdown).getByRole('button', { name: 'artwork process' }))
    expect(within(details).getByLabelText('Selected page metadata')).toHaveTextContent('Artwork Review Process')

    await user.click(within(nodes).getByRole('button', { name: /Artwork Review Process topic/ }))
    await user.click(within(nodes).getByRole('button', { name: /Current Focus hot/ }))

    const hotReadCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = input instanceof Request ? input.url : String(input)
      return url.endsWith('/read/hot.md')
    })
    expect(hotReadCalls).toHaveLength(1)
  })

  it('does not render selected page markdown html or images', async () => {
    const user = userEvent.setup()
    const xssState = { fired: false }
    vi.stubGlobal('__pageMarkdownXss', () => {
      xssState.fired = true
    })
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.endsWith('/read/hot.md')) {
        return Response.json({
          id: 'hot',
          title: 'Current Focus',
          path: 'hot.md',
          role: 'hot',
          text: [
            '# Unsafe Page Markdown',
            '',
            'Safe page copy.',
            '',
            '![tracking](https://example.com/pixel.png)',
            '<script>globalThis.__pageMarkdownXss()</script>',
            '<img src="x" alt="page tracker" onerror="globalThis.__pageMarkdownXss()">',
            '<a href="javascript:globalThis.__pageMarkdownXss()" onclick="globalThis.__pageMarkdownXss()">unsafe link</a>',
          ].join('\n'),
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    const nodes = screen.getByRole('region', { name: 'Pages' })
    await user.click(within(nodes).getByRole('button', { name: /Current Focus hot/ }))

    const markdown = await within(screen.getByRole('region', { name: 'Details' })).findByLabelText('Selected page markdown')
    expect(within(markdown).getByRole('heading', { name: 'Unsafe Page Markdown' })).toBeInTheDocument()
    expect(within(markdown).getByText('Safe page copy.')).toBeInTheDocument()
    expect(xssState.fired).toBe(false)
    expect(markdown.querySelector('script')).not.toBeInTheDocument()
    expect(markdown.querySelector('img')).not.toBeInTheDocument()
    expect(markdown.querySelector('[onerror]')).not.toBeInTheDocument()
    expect(markdown.querySelector('[onclick]')).not.toBeInTheDocument()
    expect(within(markdown).queryByRole('link', { name: 'unsafe link' })).not.toBeInTheDocument()
    expect(within(markdown).queryByAltText('tracking')).not.toBeInTheDocument()
    expect(within(markdown).queryByAltText('page tracker')).not.toBeInTheDocument()
  })

  it('uses Links in buttons to navigate to the source page node', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    const nodes = screen.getByRole('region', { name: 'Pages' })
    await user.click(within(nodes).getByRole('button', { name: /Artwork Review Process topic/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    const linksIn = within(details).getByText('Links in').closest('.detail-list')
    expect(linksIn).toBeTruthy()
    await user.click(within(linksIn as HTMLElement).getByRole('button', { name: /Current Focus hot/ }))

    await waitFor(() => {
      expect(within(nodes).getByRole('button', { name: /Current Focus hot/ })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(within(details).getByLabelText('Selected page metadata')).toHaveTextContent('Current Focus')
  })

  it('shows more than the old compact graph cap in the page list', async () => {
    const user = userEvent.setup()
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `page:topic-${index + 1}`,
      label: `Topic ${index + 1}`,
      kind: 'topic',
      path: `topic-${index + 1}.md`,
    }))
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.includes('/graph')) {
        return Response.json({
          nodes,
          edges: nodes.slice(1).map((node, index) => ({
            source: nodes[index].id,
            target: node.id,
            relation: 'links_to',
          })),
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    expect(screen.getByRole('region', { name: 'Graph' })).toHaveTextContent('25 pages')
    expect(within(screen.getByRole('region', { name: 'Pages' })).getByRole('button', { name: 'Topic 25 topic' })).toBeInTheDocument()
  })

  it('falls back to the starter connection when stored source config is corrupted', async () => {
    window.localStorage.setItem(knowledgeSourceStorageKey, '{corrupted json')

    render(<App />)

    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    expect(within(sources).getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()
    expect(within(sources).queryByRole('checkbox', { name: 'Team Wiki' })).not.toBeInTheDocument()
  })

  it('keeps the app usable when browser storage is inaccessible', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })

    render(<App />)

    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()
  })

  it('persists added source config and restores it after remount', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Team Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    expect(screen.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
    await waitFor(() => {
      expect(readStoredConnections().connections).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Team Wiki',
          protocol: 'llmwiki-http',
          url: 'http://127.0.0.1:9999',
          selected: true,
        }),
      ]))
    })
    const storedTeamConnection = readStoredConnections().connections.find((connection) => connection.name === 'Team Wiki')
    expect(storedTeamConnection).toEqual({
      id: expect.any(String),
      name: 'Team Wiki',
      nameOverride: true,
      protocol: 'llmwiki-http',
      url: 'http://127.0.0.1:9999',
      selected: true,
    })
    expect(storedTeamConnection).not.toHaveProperty('graph')
    expect(storedTeamConnection).not.toHaveProperty('status')
    expect(storedTeamConnection).not.toHaveProperty('adapter')

    firstRender.unmount()
    render(<App />)

    const reloadedTeamCheckbox = await screen.findByRole('checkbox', { name: 'Team Wiki' })
    expect(reloadedTeamCheckbox).toBeChecked()
    const reloadedTeamCard = reloadedTeamCheckbox.closest('article')
    expect(reloadedTeamCard).toBeTruthy()
    await openSourceSetup(user, reloadedTeamCard as HTMLElement)
    expect(within(reloadedTeamCard as HTMLElement).getByLabelText('Team Wiki URL')).toHaveValue('http://127.0.0.1:9999')
    expect(await within(reloadedTeamCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()
  })

  it('removes added source connections from the current view and persisted config', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Team Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    const teamCard = screen.getByRole('checkbox', { name: 'Team Wiki' }).closest('article')
    expect(teamCard).toBeTruthy()
    await user.click(within(teamCard as HTMLElement).getByRole('button', { name: 'Remove source' }))

    expect(screen.queryByRole('checkbox', { name: 'Team Wiki' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(readStoredConnections().connections.some((connection) => connection.name === 'Team Wiki')).toBe(false)
    })
  })

  it('redacts token-shaped fields from persisted source config on restore', async () => {
    window.localStorage.setItem(knowledgeSourceStorageKey, JSON.stringify({
      version: 1,
      connections: [
        {
          id: 'team-wiki',
          name: 'Team Wiki',
          protocol: 'llmwiki-http',
          url: 'http://127.0.0.1:9999',
          selected: true,
          bearerToken: 'legacy-source-secret',
          token: 'legacy-token',
        },
      ],
    }))

    render(<App />)

    expect(await screen.findByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
    await waitFor(() => {
      const raw = window.localStorage.getItem(knowledgeSourceStorageKey) || ''
      expect(raw).not.toContain('legacy-source-secret')
      expect(raw).not.toContain('legacy-token')
      expect(raw).not.toContain('bearerToken')
    })
    const storedTeamConnection = readStoredConnections().connections.find((connection) => connection.name === 'Team Wiki')
    expect(storedTeamConnection).not.toHaveProperty('bearerToken')
    expect(storedTeamConnection).not.toHaveProperty('token')
  })

  it('persists external runtime config and restores it after remount', async () => {
    const user = userEvent.setup()
    stubA2aRuntimeDiscovery()
    const firstRender = render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))

    await waitFor(() => {
      expect(readStoredAgents().agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-a2a',
          name: 'Custom A2A',
          protocol: 'custom-a2a',
          url: customA2aRuntimeUrl,
          selected: true,
        }),
      ]))
    })
    const storedCustomRuntime = readStoredAgents().agents.find((agent) => agent.id === 'custom-a2a')
    expect(storedCustomRuntime).toEqual(expect.objectContaining({
      id: 'custom-a2a',
      name: 'Custom A2A',
      protocol: 'custom-a2a',
      url: customA2aRuntimeUrl,
      selected: true,
    }))
    expect(storedCustomRuntime).not.toHaveProperty('bearerToken')
    expect(storedCustomRuntime).not.toHaveProperty('capabilities')
    expect(storedCustomRuntime).not.toHaveProperty('status')

    firstRender.unmount()
    render(<App />)
    const reloadedRuntimeCard = screen.getByRole('radio', { name: /Custom A2A/ }).closest('article')
    expect(reloadedRuntimeCard).toBeTruthy()
    expect(within(reloadedRuntimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ })).toBeChecked()
    await openRuntimeSetup(user, reloadedRuntimeCard as HTMLElement)
    expect(within(reloadedRuntimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL')).toHaveValue(customA2aRuntimeUrl)
    expect(await within(reloadedRuntimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
  })

  it('clears external runtime config and returns selection to the default local development runtime', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))

    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Remove runtime' }))

    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).not.toBeChecked()
    expect(screen.queryByRole('radio', { name: /Custom A2A/ })).not.toBeInTheDocument()
    await waitFor(() => {
      const storedCustomRuntime = readStoredAgents().agents.find((agent) => agent.id === 'custom-a2a')
      expect(storedCustomRuntime).toEqual(expect.objectContaining({ url: '', selected: false }))
    })
  })

  it('redacts bearer token and runtime test result fields from persisted runtime config on restore', async () => {
    stubA2aRuntimeDiscovery(customA2aRuntimeUrl, 'Hermes')
    writeStoredAgents([
      {
        id: 'hermes',
        name: 'Hermes',
        protocol: 'hermes',
        url: customA2aRuntimeUrl,
        selected: true,
      },
    ])
    const legacy = JSON.parse(window.localStorage.getItem(agentRuntimeStorageKey) || '{}')
    legacy.agents[0].bearerToken = 'legacy-runtime-secret'
    legacy.agents[0].status = 'ready'
    legacy.agents[0].capabilities = ['legacy-capability']
    window.localStorage.setItem(agentRuntimeStorageKey, JSON.stringify(legacy))

    render(<App />)

    const runtimeCard = screen.getByRole('radio', { name: /Hermes/ }).closest('article')
    expect(runtimeCard).toBeTruthy()
    expect(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Hermes/ })).toBeChecked()
    await openRuntimeSetup(userEvent.setup(), runtimeCard as HTMLElement)
    expect(within(runtimeCard as HTMLElement).getByLabelText('Hermes runtime URL')).toHaveValue(customA2aRuntimeUrl)
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await waitFor(() => {
      const raw = window.localStorage.getItem(agentRuntimeStorageKey) || ''
      expect(raw).not.toContain('legacy-runtime-secret')
      expect(raw).not.toContain('bearerToken')
      expect(raw).not.toContain('legacy-capability')
    })
    const storedHermesRuntime = readStoredAgents().agents.find((agent) => agent.id === 'hermes')
    expect(storedHermesRuntime).not.toHaveProperty('bearerToken')
    expect(storedHermesRuntime).not.toHaveProperty('status')
    expect(storedHermesRuntime).not.toHaveProperty('capabilities')
  })

  it('merges the starter connection when stored state only contains user sources', async () => {
    writeStoredConnections([
      {
        id: 'team-wiki',
        name: 'Team Wiki',
        protocol: 'llmwiki-http',
        url: 'http://127.0.0.1:9999',
        selected: true,
      },
    ])

    render(<App />)

    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
  })

  it('restores starter selection from stored source config', async () => {
    writeStoredConnections([
      {
        id: 'local-demo',
        name: 'Saved sample source',
        protocol: 'llmwiki-http',
        url: 'http://127.0.0.1:8765',
        selected: false,
      },
      {
        id: 'team-wiki',
        name: 'Team Wiki',
        protocol: 'llmwiki-http',
        url: 'http://127.0.0.1:9999',
        selected: true,
      },
    ])

    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review sources' }))
    const starterCheckbox = await screen.findByRole('checkbox', { name: 'Local sample LLMWiki' })
    expect(starterCheckbox).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
    const starterCard = starterCheckbox.closest('article')
    expect(starterCard).toBeTruthy()
    expect(within(starterCard as HTMLElement).getByLabelText('Source selection not selected')).toBeInTheDocument()
  })

  it('allows Local Development Runtime to ask with a local source URL', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    expect(screen.getByLabelText('Question')).toHaveValue('')
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeDisabled()

    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeEnabled()
    expect(screen.getByText('Ready to ask Sample Wiki.')).toBeInTheDocument()
  })

  it('shows manifest metadata loaded from serve endpoints', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    const sourceDetails = within(sources).getByText('Source details').closest('details')
    expect(sourceDetails).not.toHaveAttribute('open')
    expect(screen.getByText('llmwiki-markdown')).toBeInTheDocument()
    expect(screen.getByText('atomicstrata/llm-wiki-compiler')).toBeInTheDocument()
    expect(screen.getByText('2/3 approved')).toBeInTheDocument()

    await user.click(within(sources).getByText('Source details'))
    expect(sourceDetails).toHaveAttribute('open')
  })

  it('does not restore source selection from a late source test response', async () => {
    const user = userEvent.setup()
    const manifest = deferredResponse()
    const graph = deferredResponse()
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.endsWith('/manifest')) return manifest.promise
      if (url.includes('/graph')) return graph.promise
      return undefined
    })

    render(<App />)
    await user.click(screen.getByRole('checkbox', { name: 'Local sample LLMWiki' }))
    expect(screen.getByLabelText('Source selection not selected')).toBeInTheDocument()

    manifest.resolve(Response.json({
      title: 'Late Wiki',
      description: 'Late manifest',
      adapter: 'llmwiki-markdown',
      implementation: 'atomicstrata/llm-wiki-compiler',
      page_count: 3,
      approved_page_count: 2,
    }))
    graph.resolve(Response.json(graphPayload()))

    expect(await screen.findByText('Late Wiki')).toBeInTheDocument()
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    expect(within(sources).getByRole('checkbox', { name: 'Late Wiki' })).not.toBeChecked()
    expect(within(sources).getByLabelText('Source selection not selected')).toBeInTheDocument()
  })

  it('times out stalled source discovery and returns to a retryable error state', async () => {
    vi.useFakeTimers()
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.endsWith('/manifest') || url.includes('/graph')) return new Promise<Response>(() => {})
      return undefined
    })

    render(<App />)
    expect(screen.getByLabelText('Connection status checking')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(screen.getByLabelText('Connection status error')).toBeInTheDocument()
    expect(screen.getByText(/timed out after 10s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test source' })).toBeEnabled()
  })

  it('keeps source review and testing secondary while preserving feedback', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const summary = screen.getByRole('group', { name: 'Active knowledge source summary' })
    expect(within(summary).getByText('1 selected · 1 ready available')).toBeInTheDocument()
    expect(within(summary).getByText('Selected sources tested successfully.')).toBeInTheDocument()
    expect(within(summary).getAllByText('Sample Wiki').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Source tested successfully/).length).toBeGreaterThan(0)
    const statusDetails = screen.getByText('Connection status').closest('details')
    expect(statusDetails).toBeTruthy()
    expect(statusDetails).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Review sources' })).not.toBeVisible()
    await user.click(screen.getByText('Connection status'))
    expect(screen.getByRole('button', { name: 'Review sources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test selected sources' })).toBeInTheDocument()
  })

  it('uses one unavailable-runtime reason for ask button, Enter, and suggested prompts', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const runtimeCard = await addRuntime(user, 'Hermes')
    await user.click(within(runtimeCard).getByRole('radio', { name: /Hermes/ }))

    const reason = 'Select or configure Hermes so it can be checked, or choose a ready runtime.'
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeDisabled()
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0)
    const prompts = within(screen.getByRole('group', { name: 'Suggested prompts' }))
    expect(prompts.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeDisabled()
    prompts.getAllByRole('button').forEach((button) => {
      expect(button).toBeDisabled()
    })

    await user.click(screen.getByLabelText('Question'))
    await user.keyboard('{Enter}')
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Hermes run details')).not.toBeInTheDocument()
  })

  it('labels suggested prompts as immediate ask actions and clears the composer', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await user.clear(screen.getByLabelText('Question'))
    await user.type(screen.getByLabelText('Question'), 'Draft question')

    await user.click(
      within(screen.getByRole('group', { name: 'Suggested prompts' })).getByRole('button', {
        name: 'Ask: Show current focus',
      }),
    )

    expect(screen.getByLabelText('Question')).toHaveValue('')
    expect(await within(screen.getByRole('region', { name: 'Chat' })).findByText(/Required copy and release readiness/)).toBeInTheDocument()
    expect(screen.getByText('Show current focus')).toBeInTheDocument()
  })

  it('runs the selected agent over the selected llmwiki endpoint and renders trace plus citations', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    expect(screen.getByLabelText('Question')).toHaveValue('')

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText(/Required copy and release readiness/)).toBeInTheDocument()
    const assistantMessage = assistantMessageFor(within(chat).getByText(/Required copy and release readiness/))
    const runDetails = within(assistantMessage).getByLabelText('Local Development Runtime run details') as HTMLDetailsElement
    expect(runDetails.open).toBe(false)
    const answerTop = [...assistantMessage.querySelectorAll('p, h1, h2, h3, ol, ul')]
      .find((element) => element.textContent?.includes('Local Development Runtime used'))
    expect(answerTop?.textContent).toContain('Local Development Runtime used')
    expect([...assistantMessage.children].indexOf(runDetails)).toBeLessThan([...assistantMessage.children].indexOf(answerTop as Element))
    const inlineCitation = within(assistantMessage).getAllByRole('button', { name: 'Citation 1: Current Focus' })[0]
    expect(inlineCitation).toHaveClass('inline-citation')
    expect(within(runDetails).getAllByText('ready').length).toBeGreaterThan(0)
    expect(within(runDetails).getByText('4 steps · 1 tool call')).toBeInTheDocument()
    expect(runDetails.open).toBe(false)
    await user.click(within(runDetails).getByText('Run details'))
    expect(runDetails.open).toBe(true)
    expect(within(runDetails).getByLabelText('Answer context')).toHaveTextContent('Runtime: Local Development Runtime')
    expect(within(runDetails).getByText('Planning')).toBeInTheDocument()
    expect(within(runDetails).getByText('Evidence read')).toBeInTheDocument()
    expect(within(runDetails).getByText('Final answer')).toBeInTheDocument()
    const toolTrace = within(runDetails).getByLabelText('Tool call trace')
    expect(within(toolTrace).getByText('Sample Wiki')).toBeInTheDocument()
    const citationButton = screen.getByRole('button', { name: /\[1\] Current Focus/ })
    expect(citationButton).toBeInTheDocument()

    fireEvent.click(inlineCitation)
    await waitFor(() => {
      expect(within(assistantMessage).getAllByRole('button', { name: 'Citation 1: Current Focus' })[0]).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: /\[1\] Current Focus/ })).toHaveAttribute('aria-pressed', 'true')
    })
    await user.click(screen.getByRole('button', { name: /\[1\] Current Focus/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\[1\] Current Focus/ })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(document.querySelectorAll('.selected-node')).toHaveLength(1)
    const graphPanel = screen.getByRole('region', { name: 'Graph' })
    expect(within(graphPanel).getByLabelText('Map legend')).toHaveTextContent('Page link')
    expect(within(graphPanel).getByText(/Selected: Current Focus/)).toBeInTheDocument()
    const nodes = screen.getByRole('region', { name: 'Pages' })
    expect(within(nodes).getByRole('button', { name: /Current Focus hot/ })).toHaveAttribute('aria-pressed', 'true')
    const details = screen.getByRole('region', { name: 'Details' })
    const citationEvidence = within(details).getByLabelText('Citation evidence')
    expect(citationEvidence).toHaveTextContent('Required copy and release readiness')
    expect(citationEvidence).toHaveTextContent('hot.md')
    expect(citationEvidence).toHaveTextContent('Sample Wiki · llmwiki-http · ready')
    const referenceDetails = within(citationEvidence).getByText('Citation reference details').closest('details') as HTMLDetailsElement | null
    expect(referenceDetails).toBeTruthy()
    expect(referenceDetails).not.toHaveAttribute('open')
    await user.click(within(citationEvidence).getByText('Citation reference details'))
    expect(referenceDetails).toHaveAttribute('open')
    expect(within(citationEvidence).getByText('SRC-HOT')).toBeInTheDocument()
  })

  it('renders redacted in-memory turn audit metadata without prompt, answer, or endpoint URLs', async () => {
    const user = userEvent.setup()
    const sensitivePrompt = 'audit-secret-prompt should stay out of turn audit'
    const sensitiveAnswer = 'audit-secret-answer cites [Runtime Focus](#citation-1).'
    const chat = await askCustomA2aAnswer(
      sensitiveAnswer,
      {
        citations: [
          {
            id: 'local-demo:runtime-focus',
            title: 'Runtime Focus',
            path: 'runtime-focus.md',
            snippet: 'Runtime evidence.',
            connectionId: 'local-demo',
            sourceRefs: ['RUNTIME-SRC'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime-focus.md' },
            { id: 'source:RUNTIME-SRC', label: 'RUNTIME-SRC', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:runtime-focus', target: 'source:RUNTIME-SRC', relation: 'cites' },
          ],
        },
        steps: [
          {
            id: 'runtime-tool-wiki',
            label: 'Call selected source',
            status: 'completed',
            connection_id: 'local-demo',
            tool_name: 'llmwiki_context__local_demo',
            citation_ids: ['local-demo:runtime-focus'],
            request_id: 'req-safe-123',
            trace_id: 'https://private.runtime.invalid/trace-secret',
            detail: 'Read selected source.',
          },
        ],
        metadata: {
          traceId: 'trace-safe-456',
          requestId: 'https://private.runtime.invalid/request-secret',
          sourceUrl: 'https://private-source.invalid/wiki',
          promptEcho: sensitivePrompt,
          answerEcho: sensitiveAnswer,
        },
      },
      sensitivePrompt,
    )

    const answerText = await within(chat).findByText(/audit-secret-answer/)
    const assistantMessage = assistantMessageFor(answerText)
    const runDetails = within(assistantMessage).getByLabelText('Custom A2A run details') as HTMLDetailsElement
    await user.click(within(runDetails).getByText('Run details'))

    const audit = within(runDetails).getByLabelText('Turn audit')
    expect(audit).toHaveTextContent('Live A2A runtime')
    expect(audit).toHaveTextContent('custom-a2a')
    expect(audit).toHaveTextContent('ready')
    expect(audit).toHaveTextContent('1 selected · 1 ready · 1 used')
    expect(audit).toHaveTextContent('citations 1')
    expect(audit).toHaveTextContent('req-safe-123')
    expect(audit).toHaveTextContent('trace-safe-456')
    expect(audit).not.toHaveTextContent(sensitivePrompt)
    expect(audit).not.toHaveTextContent(sensitiveAnswer)
    expect(audit).not.toHaveTextContent(customA2aRuntimeUrl)
    expect(audit).not.toHaveTextContent(publicSourceUrl)
    expect(audit).not.toHaveTextContent('private.runtime.invalid')
    expect(audit).not.toHaveTextContent('private-source.invalid')
    expect(audit).not.toHaveTextContent('request-secret')
    expect(audit).not.toHaveTextContent('trace-secret')

    const persistedConfig = [
      window.localStorage.getItem(knowledgeSourceStorageKey) || '',
      window.localStorage.getItem(agentRuntimeStorageKey) || '',
    ].join('\n')
    expect(persistedConfig).not.toContain('req-safe-123')
    expect(persistedConfig).not.toContain('trace-safe-456')
    expect(persistedConfig).not.toContain(sensitivePrompt)
    expect(persistedConfig).not.toContain(sensitiveAnswer)
  })

  it('stores local I/O log entries by default with prompt and answer canaries', async () => {
    const user = userEvent.setup()
    const debugPrompt = 'local-io-default prompt canary is stored'
    const debugAnswer = 'local-io-default answer canary is stored'

    const chat = await askCustomA2aAnswer(debugAnswer, {}, debugPrompt)

    expect((await within(chat).findAllByText(debugAnswer)).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: /Local I\/O logging/ })).toBeChecked()
    const localLog = screen.getByRole('region', { name: 'Local I/O log' })
    await user.click(within(localLog).getByText('Local I/O log'))
    expect(within(localLog).getByDisplayValue(debugPrompt)).toBeInTheDocument()
    expect(within(localLog).getByDisplayValue(debugAnswer)).toBeInTheDocument()
    expect(within(localLog).getByText('completed')).toBeInTheDocument()

    await waitFor(() => {
      const raw = window.localStorage.getItem(localIoLogStorageKey) || ''
      expect(raw).toContain(debugPrompt)
      expect(raw).toContain(debugAnswer)
      const entries = readLocalIoLogEntries()
      expect(entries).toHaveLength(1)
      const entry = entries[0] as {
        prompt: string
        status: string
        request?: { transport: string; body?: { data?: { query?: string } } }
        response?: { answer?: string; metadata?: { status?: string; citationCount?: number } }
      }
      expect(entry.prompt).toBe(debugPrompt)
      expect(entry.status).toBe('completed')
      expect(entry.request?.transport).toBe('a2a-message:send')
      expect(entry.request?.body?.data?.query).toBe(debugPrompt)
      expect(entry.response?.answer).toBe(debugAnswer)
      expect(entry.response?.metadata?.status).toBe('ready')
      expect(entry.response?.metadata?.citationCount).toBe(0)
    })
  })

  it('suppresses local I/O storage when the user opts out', async () => {
    const debugPrompt = 'local-io-opt-out prompt canary must not be stored'
    const debugAnswer = 'local-io-opt-out answer canary must not be stored'

    const chat = await askCustomA2aAnswer(debugAnswer, {}, debugPrompt, { disableLocalIoLogging: true })

    expect((await within(chat).findAllByText(debugAnswer)).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: /Local I\/O logging/ })).not.toBeChecked()
    expect(screen.queryByRole('region', { name: 'Local I/O log' })).not.toBeInTheDocument()
    const persisted = [
      storageDump(window.localStorage),
      storageDump(window.sessionStorage),
    ].join('\n')
    expect(persisted).not.toContain(debugPrompt)
    expect(persisted).not.toContain(debugAnswer)
    expect(readLocalIoLogEntries()).toEqual([])
  })

  it('clears persisted local I/O log entries', async () => {
    const user = userEvent.setup()
    const debugPrompt = 'local-io-clear prompt canary'
    const debugAnswer = 'local-io-clear answer canary'

    const chat = await askCustomA2aAnswer(debugAnswer, {}, debugPrompt)

    expect((await within(chat).findAllByText(debugAnswer)).length).toBeGreaterThan(0)
    expect(readLocalIoLogEntries()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Clear local I/O log' }))

    await waitFor(() => {
      expect(window.localStorage.getItem(localIoLogStorageKey)).toBeNull()
    })
    const localLog = screen.getByRole('region', { name: 'Local I/O log' })
    await user.click(within(localLog).getByText('Local I/O log'))
    expect(within(localLog).getByText('No local I/O entries collected yet.')).toBeInTheDocument()
    const persisted = storageDump(window.localStorage)
    expect(persisted).not.toContain(debugPrompt)
    expect(persisted).not.toContain(debugAnswer)
  })

  it('redacts credential and token canaries from persisted local I/O logs', async () => {
    const safePromptCanary = 'local-io-redaction safe prompt canary'
    const safeAnswerCanary = 'local-io-redaction safe answer canary'
    const secretPromptToken = 'sk-proj-prompt-secret-canary'
    const secretAnswerToken = 'sk-answersecret123456'
    const bearerCanary = 'Bearer runtime-token-canary'
    const metadataToken = 'metadata-token-canary'
    const basicCanary = 'bG9jYWwtaW8tYmFzaWMtc2VjcmV0'
    const cookieCanary = 'local-io-cookie-secret'
    const setCookieCanary = 'local-io-set-cookie-secret'
    const clientSecretCanary = 'local-io-client-secret'
    const codeCanary = 'local-io-code-secret'
    const signatureCanary = 'local-io-signature-secret'
    const windowsPathCanary = 'C:\\Users\\angel\\local-io-secret.txt'
    const uncPathCanary = '\\\\server\\share\\local-io-secret.txt'
    const posixPathCanary = '/home/angel/local-io-secret.txt'
    const varPathCanary = '/var/tmp/local-io-secret.txt'

    const chat = await askCustomA2aAnswer(
      `${safeAnswerCanary} ${secretAnswerToken}`,
      {
        steps: [
          {
            id: 'runtime-sensitive-step',
            label: 'Sensitive diagnostic step',
            status: 'completed',
            detail: `Authorization: ${bearerCanary}`,
            diagnostic: {
              observations: [`token=${metadataToken}`],
              partial: {
                token: metadataToken,
                sourceUrl: (
                  'https://user:pass@wiki.example.test/context?'
                  + `api_key=url-secret-canary&client_secret=${clientSecretCanary}`
                  + `&code=${codeCanary}&signature=${signatureCanary}&ok=1`
                ),
              },
            },
          },
        ],
      },
      [
        safePromptCanary,
        secretPromptToken,
        bearerCanary,
        `Basic ${basicCanary}`,
        `Cookie: session=${cookieCanary}`,
        `Set-Cookie: session=${setCookieCanary}`,
        windowsPathCanary,
        uncPathCanary,
        posixPathCanary,
        varPathCanary,
      ].join(' '),
    )

    expect((await within(chat).findAllByText(/local-io-redaction safe answer canary/)).length).toBeGreaterThan(0)
    const raw = window.localStorage.getItem(localIoLogStorageKey) || ''
    expect(raw).toContain(safePromptCanary)
    expect(raw).toContain(safeAnswerCanary)
    expect(raw).toContain('[redacted-api-key]')
    expect(raw).toContain('Bearer [redacted]')
    expect(raw).toContain('"token":"[redacted]"')
    expect(raw).toContain('Basic [redacted]')
    expect(raw).not.toContain(secretPromptToken)
    expect(raw).not.toContain(secretAnswerToken)
    expect(raw).not.toContain('runtime-token-canary')
    expect(raw).not.toContain(metadataToken)
    expect(raw).not.toContain('user:pass')
    expect(raw).not.toContain('url-secret-canary')
    expect(raw).not.toContain(customA2aRuntimeUrl)
    expect(raw).not.toContain(publicSourceUrl)
    expect(raw).not.toContain(basicCanary)
    expect(raw).not.toContain(cookieCanary)
    expect(raw).not.toContain(setCookieCanary)
    expect(raw).not.toContain(clientSecretCanary)
    expect(raw).not.toContain(codeCanary)
    expect(raw).not.toContain(signatureCanary)
    expect(raw).not.toContain(windowsPathCanary)
    expect(raw).not.toContain(uncPathCanary)
    expect(raw).not.toContain(posixPathCanary)
    expect(raw).not.toContain(varPathCanary)
  })

  it('sends bounded conversation messages and stable session metadata to the selected runtime', async () => {
    const user = userEvent.setup()
    const runtimeBodies: Array<Record<string, unknown>> = []
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      if (url === `${customA2aRuntimeUrl}/message:send`) {
        runtimeBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
        return a2aAgentResultResponse(`Runtime answer ${runtimeBodies.length}.`)
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const sourceCard = screen.getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
    expect(sourceCard).toBeTruthy()
    await openSourceSetup(user, sourceCard as HTMLElement)
    setInputValue(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
    await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))
    expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    setInputValue(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()
    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))

    await user.type(screen.getByLabelText('Question'), 'First runtime history question')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    expect((await screen.findAllByText('Runtime answer 1.')).length).toBeGreaterThan(0)

    await user.type(screen.getByLabelText('Question'), 'Second runtime history question')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    expect((await screen.findAllByText('Runtime answer 2.')).length).toBeGreaterThan(0)

    const firstData = runtimeBodies[0].data as Record<string, unknown>
    const secondData = runtimeBodies[1].data as Record<string, unknown>
    const firstContext = firstData.runtimeContext as { conversation: Record<string, unknown> }
    const secondContext = secondData.runtimeContext as { conversation: Record<string, unknown> }

    expect(firstData.messages).toEqual([
      { role: 'user', content: 'First runtime history question' },
    ])
    expect(secondData.messages).toEqual([
      { role: 'user', content: 'First runtime history question' },
      { role: 'assistant', content: 'Runtime answer 1.' },
      { role: 'user', content: 'Second runtime history question' },
    ])
    expect(secondData.query).toBe('Second runtime history question')
    expect(secondData.sessionId).toEqual(firstData.sessionId)
    expect(secondData.threadId).toEqual(firstData.threadId)
    expect(secondData.turnId).not.toEqual(firstData.turnId)
    expect(secondContext.conversation).toMatchObject({
      schemaVersion: 'llmwiki-chat.conversation.v1',
      sessionId: secondData.sessionId,
      threadId: secondData.threadId,
      turnId: secondData.turnId,
      historyLength: 2,
      messagesIncluded: 3,
      latestRole: 'user',
    })
    expect(firstContext.conversation).toMatchObject({
      historyLength: 0,
      messagesIncluded: 1,
      latestRole: 'user',
    })
  })

  it('resets the chat thread while preserving selected source and runtime setup', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    const chatActions = screen.getByRole('group', { name: 'Chat actions' })
    const resetButton = within(chatActions).getByRole('button', { name: 'Refresh chat' })
    expect(resetButton).toBeDisabled()

    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText(/Required copy and release readiness/)).toBeInTheDocument()
    expect(resetButton).toBeEnabled()

    await user.click(resetButton)

    expect(chat.querySelectorAll('.message')).toHaveLength(0)
    expect(screen.getByRole('checkbox', { name: 'Sample Wiki' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
    expect(screen.getByLabelText('Question')).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByLabelText('Question')).toHaveFocus()
    })
    expect(within(screen.getByRole('group', { name: 'Suggested prompts' })).getByRole('button', {
      name: 'Ask: What is in this wiki?',
    })).toBeEnabled()
  })

  it('turns inline markdown citation anchors into graph-synchronizing evidence actions', async () => {
    const user = userEvent.setup()
    const chat = await askCustomA2aAnswer(
      'External runtime answer cites [Runtime Focus](#citation-1).',
      {
        citations: [
          {
            id: 'local-demo:runtime-focus',
            title: 'Runtime Focus',
            path: 'runtime-focus.md',
            snippet: 'Runtime evidence should be inspectable from an inline citation.',
            connectionId: 'local-demo',
            sourceRefs: ['RUNTIME-SRC'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime-focus.md' },
            { id: 'source:RUNTIME-SRC', label: 'RUNTIME-SRC', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:runtime-focus', target: 'source:RUNTIME-SRC', relation: 'cites' },
          ],
        },
      },
    )

    const inlineCitation = await within(chat).findByRole('button', { name: 'Citation 1: Runtime Focus' })
    expect(inlineCitation).toHaveClass('inline-citation')
    const answerText = within(chat).getByText(/External runtime answer cites/)
    expect(assistantMessageFor(answerText)).not.toHaveTextContent('Evidence was returned, but the answer body does not include inline citation anchors.')
    fireEvent.click(inlineCitation)

    await waitFor(() => {
      expect(within(chat).getByRole('button', { name: /\[1\] Runtime Focus/ })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByRole('region', { name: 'Pages' })).not.toBeInTheDocument()
    await openInspectorDetails(user)
    const nodes = await screen.findByRole('region', { name: 'Pages' })
    expect(within(nodes).getByRole('button', { name: /Runtime Focus topic/ })).toHaveAttribute('aria-pressed', 'true')
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByLabelText('Citation evidence')).toHaveTextContent('Runtime evidence should be inspectable')
    expect(document.querySelectorAll('.selected-node')).toHaveLength(1)
  })

  it('maps source-ref citation anchors to returned evidence', async () => {
    const user = userEvent.setup()
    const chat = await askCustomA2aAnswer(
      'External runtime answer cites a source ref [SRC-HOT](#ref-SRC-HOT).',
      {
        citations: [
          {
            id: 'local-demo:runtime-focus',
            title: 'Runtime Focus',
            path: 'runtime-focus.md',
            snippet: 'Runtime evidence with a source ref anchor.',
            connectionId: 'local-demo',
            sourceRefs: ['SRC-HOT'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime-focus.md' },
            { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:runtime-focus', target: 'source:SRC-HOT', relation: 'cites' },
          ],
        },
      },
    )

    const answerText = await within(chat).findByText(/External runtime answer cites a source ref/)
    const assistantMessage = assistantMessageFor(answerText)
    const inlineCitation = within(assistantMessage).getByRole('button', { name: 'Citation 1: Runtime Focus' })
    expect(inlineCitation).toHaveClass('inline-citation')
    expect(assistantMessage).not.toHaveTextContent('Evidence was returned, but the answer body does not include inline citation anchors.')

    await user.click(inlineCitation)

    await waitFor(() => {
      expect(inlineCitation).toHaveAttribute('aria-pressed', 'true')
    })
    expect(await screen.findByRole('region', { name: 'Details' })).toHaveTextContent('Runtime evidence with a source ref anchor.')
  })

  it('detects raw HTML citation anchors without tag-stripping sanitization', async () => {
    const chat = await askCustomA2aAnswer(
      'External runtime answer cites <a href="#citation-1"><span>1</span></a>.',
      {
        citations: [
          {
            id: 'local-demo:runtime-focus',
            title: 'Runtime Focus',
            path: 'runtime-focus.md',
            snippet: 'Runtime evidence referenced through raw HTML anchor text.',
            connectionId: 'local-demo',
            sourceRefs: ['RUNTIME-SRC'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime-focus.md' },
            { id: 'source:RUNTIME-SRC', label: 'RUNTIME-SRC', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:runtime-focus', target: 'source:RUNTIME-SRC', relation: 'cites' },
          ],
        },
      },
    )

    const answerText = await within(chat).findByText(/External runtime answer cites/)
    const assistantMessage = assistantMessageFor(answerText)
    expect(assistantMessage).not.toHaveTextContent('Evidence was returned, but the answer body does not include inline citation anchors.')
  })

  it('shows a quiet notice when returned evidence is not mapped to inline citation anchors', async () => {
    const chat = await askCustomA2aAnswer(
      'External runtime returned an uncited summary.',
      {
        citations: [
          {
            id: 'local-demo:runtime-focus',
            title: 'Runtime Focus',
            path: 'runtime-focus.md',
            snippet: 'Runtime evidence was returned without an inline anchor.',
            connectionId: 'local-demo',
            sourceRefs: ['RUNTIME-SRC'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime-focus.md' },
            { id: 'source:RUNTIME-SRC', label: 'RUNTIME-SRC', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:runtime-focus', target: 'source:RUNTIME-SRC', relation: 'cites' },
          ],
        },
      },
    )

    const answerText = await within(chat).findByText('External runtime returned an uncited summary.')
    const assistantMessage = assistantMessageFor(answerText)
    expect(within(assistantMessage).getByText('Evidence was returned, but the answer body does not include inline citation anchors.')).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('button', { name: /\[1\] Runtime Focus/ })).toBeInTheDocument()
    expect(within(assistantMessage).queryByRole('button', { name: 'Citation 1: Runtime Focus' })).not.toBeInTheDocument()
  })

  it('orders runtime evidence by step citation ids while preserving inline citation references', async () => {
    const user = userEvent.setup()
    const chat = await askCustomA2aAnswer(
      'Runtime answer cites [3](#citation-3), [2](#citation-2), and [1](#citation-1).',
      {
        citations: [
          {
            id: 'local-demo:topic',
            title: 'Topic Page',
            path: 'topic.md',
            snippet: 'Topic evidence.',
            connectionId: 'local-demo',
            sourceRefs: ['SRC-TOPIC'],
          },
          {
            id: 'local-demo:index',
            title: 'Wiki Index',
            path: 'index.md',
            snippet: 'Index evidence.',
            connectionId: 'local-demo',
            sourceRefs: ['SRC-INDEX'],
          },
          {
            id: 'local-demo:hot',
            title: 'Current Focus',
            path: 'hot.md',
            snippet: 'Hot evidence.',
            connectionId: 'local-demo',
            sourceRefs: ['SRC-HOT'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:topic', label: 'Topic Page', kind: 'topic', path: 'topic.md' },
            { id: 'page:index', label: 'Wiki Index', kind: 'index', path: 'index.md' },
            { id: 'page:hot', label: 'Current Focus', kind: 'hot', path: 'hot.md' },
            { id: 'source:SRC-TOPIC', label: 'SRC-TOPIC', kind: 'source_ref' },
            { id: 'source:SRC-INDEX', label: 'SRC-INDEX', kind: 'source_ref' },
            { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:topic', target: 'source:SRC-TOPIC', relation: 'cites' },
            { source: 'page:index', target: 'source:SRC-INDEX', relation: 'cites' },
            { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
          ],
        },
        steps: [
          {
            id: 'read-wiki-context',
            label: 'Call Wiki Index',
            status: 'done',
            detail: 'Read 3 citation(s) from Wiki Index.',
            citation_ids: ['local-demo:hot', 'local-demo:index', 'local-demo:topic'],
          },
        ],
      },
    )

    const answerIntro = await within(chat).findByText(/Runtime answer cites/)
    const assistantMessage = assistantMessageFor(answerIntro)
    const citationButtons = within(within(assistantMessage).getByLabelText('Citations')).getAllByRole('button')
    expect(citationButtons.map((button) => button.textContent?.trim())).toEqual([
      '[1] Current Focus',
      '[2] Wiki Index',
      '[3] Topic Page',
    ])

    const inlineCurrentFocus = within(assistantMessage).getByRole('button', { name: 'Citation 1: Current Focus' })
    const inlineWikiIndex = within(assistantMessage).getByRole('button', { name: 'Citation 2: Wiki Index' })
    expect(inlineCurrentFocus).toHaveTextContent('1')
    expect(inlineWikiIndex).toHaveTextContent('2')

    await user.click(inlineCurrentFocus)
    await waitFor(() => {
      expect(within(chat).getByRole('button', { name: 'Citation 1: Current Focus' })).toHaveAttribute('aria-pressed', 'true')
    })
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByLabelText('Citation evidence')).toHaveTextContent('hot.md')
    expect(within(details).getByLabelText('Citation evidence')).toHaveTextContent('Hot evidence.')
  })

  it('shows selected graph page details without prompt shortcut actions', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    const nodes = screen.getByRole('region', { name: 'Pages' })
    await user.click(within(nodes).getByRole('button', { name: /Current Focus hot/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByLabelText('Selected page metadata')).toHaveTextContent('Sample Wiki · llmwiki-http · ready')
    expect(within(details).getByText('SRC-HOT')).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Artwork Review Process topic' })).toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'Write question' })).not.toBeInTheDocument()
    expect(within(details).queryByText(/Draft question will include/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Question')).toHaveValue('')
    expect(document.querySelectorAll('.message.user')).toHaveLength(0)
  })

  it('keeps source identity when showing details from a second selected graph', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.endsWith('127.0.0.1:9999/manifest')) {
        return Response.json({
          title: 'Team Knowledge Wiki',
          description: 'Team-specific packaging notes.',
          adapter: 'llmwiki-markdown',
          implementation: 'team/wiki',
          page_count: 1,
          approved_page_count: 1,
        })
      }
      if (url.includes('127.0.0.1:9999/graph')) {
        return Response.json({
          nodes: [
            { id: 'page:team-focus', label: 'Team Focus', kind: 'topic', path: 'team-focus.md' },
            { id: 'source:TEAM-SRC', label: 'TEAM-SRC', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:team-focus', target: 'source:TEAM-SRC', relation: 'cites' },
          ],
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openInspectorDetails(user)

    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Team Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    const teamCard = screen.getByRole('checkbox', { name: 'Team Wiki' }).closest('article')
    expect(teamCard).toBeTruthy()
    await user.click(within(teamCard as HTMLElement).getByRole('button', { name: 'Test source' }))

    expect(await screen.findByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
    const nodes = screen.getByRole('region', { name: 'Pages' })
    await user.click(within(nodes).getByRole('button', { name: /Team Focus topic/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByLabelText('Selected page metadata')).toHaveTextContent('Team Wiki · llmwiki-http · ready')
    expect(within(details).getByText('TEAM-SRC')).toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'Write question' })).not.toBeInTheDocument()
    expect(within(details).queryByText(/Draft question will include/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Question')).toHaveValue('')
  })

  it('restores an older answer evidence graph when its citation is selected after a later answer', async () => {
    const user = userEvent.setup()
    let queryCount = 0
    stubFetch(() => Response.json(queryCount++ ? alternateQueryPayload() : queryPayload()))

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)

    await user.type(screen.getByLabelText('Question'), 'First question')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    expect(await screen.findByText(/For "First question"/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Question'), 'Second question')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    expect(await screen.findByText(/For "Second question"/)).toBeInTheDocument()
    await openInspectorDetails(user)
    expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent('Later evidence should not replace')

    const chat = screen.getByRole('region', { name: 'Chat' })
    const firstAssistant = chat.querySelectorAll<HTMLElement>('.message.assistant')[0]
    expect(firstAssistant).toBeTruthy()
    await user.click(within(firstAssistant).getByRole('button', { name: /\[1\] Current Focus/ }))

    const details = screen.getByRole('region', { name: 'Details' })
    expect(details).toHaveTextContent('Required copy and release readiness are current focus items.')
    expect(details).not.toHaveTextContent('Later evidence should not replace')
    const nodes = screen.getByRole('region', { name: 'Pages' })
    expect(within(nodes).getByRole('button', { name: /Current Focus hot/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders assistant markdown links, code blocks, and GFM tables', async () => {
    const chat = await askCustomA2aAnswer([
      'Review the [release checklist](https://docs.example.test/release) before publishing.',
      '',
      '```ts',
      "const status = 'ready'",
      '```',
      '',
      '| Item | State |',
      '| --- | --- |',
      '| Markdown answer | Rendered |',
    ].join('\n'))

    const link = await within(chat).findByRole('link', { name: 'release checklist' })
    expect(link).toHaveAttribute('href', 'https://docs.example.test/release')
    const assistantMessage = assistantMessageFor(link)
    expect(within(assistantMessage).getByText("const status = 'ready'")).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('table')).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('columnheader', { name: 'Item' })).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('cell', { name: 'Rendered' })).toBeInTheDocument()
  })

  it('renders flattened local-runtime source tables as GFM tables', async () => {
    const user = userEvent.setup()
    const pipeHeavyPrefix = Array.from({ length: 80 }, (_, index) => `field_${index}`).join(' | ')
    stubFetch(() => Response.json({
      wiki_title: 'Sample Wiki',
      orientation: [
        {
          title: 'Data Quality',
          role: 'topic',
          snippet: `Any analysis should account for missing fields in ${pipeHeavyPrefix}. | Field | Missing rows | | --- | --- | | species | 0 | | bill_length_mm | 2 |`,
        },
      ],
      evidence: [],
      limitations: [],
      graph: graphPayload(),
    }))

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)

    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    const table = await within(chat).findByRole('table')
    const assistantMessage = assistantMessageFor(table)
    expect(within(assistantMessage).getByRole('columnheader', { name: 'Field' })).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('columnheader', { name: 'Missing rows' })).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('cell', { name: 'species' })).toBeInTheDocument()
    expect(within(assistantMessage).getByRole('cell', { name: '2' })).toBeInTheDocument()
  })

  it('does not render assistant markdown image syntax as auto-loading images', async () => {
    const chat = await askCustomA2aAnswer([
      'Safe answer with blocked markdown images.',
      '',
      '![tracking](https://example.com/pixel.png)',
      '![local](http://127.0.0.1:9/x.png)',
    ].join('\n'))

    const safeText = await within(chat).findByText('Safe answer with blocked markdown images.')
    const assistantMessage = assistantMessageFor(safeText)
    expect(within(assistantMessage).queryByAltText('tracking')).not.toBeInTheDocument()
    expect(within(assistantMessage).queryByAltText('local')).not.toBeInTheDocument()
    expect(assistantMessage.querySelector('img')).not.toBeInTheDocument()
  })

  it('does not render or execute malicious assistant HTML', async () => {
    const xssState = { fired: false }
    vi.stubGlobal('__markdownXss', () => {
      xssState.fired = true
    })

    const chat = await askCustomA2aAnswer([
      'Safe answer after unsafe HTML.',
      '<script>globalThis.__markdownXss()</script>',
      '<img src="x" alt="malicious image" onerror="globalThis.__markdownXss()">',
      '<a href="javascript:globalThis.__markdownXss()" onclick="globalThis.__markdownXss()">unsafe link</a>',
    ].join('\n'))

    const safeText = await within(chat).findByText('Safe answer after unsafe HTML.')
    const assistantMessage = assistantMessageFor(safeText)
    expect(xssState.fired).toBe(false)
    expect(assistantMessage.querySelector('script')).not.toBeInTheDocument()
    expect(within(assistantMessage).queryByAltText('malicious image')).not.toBeInTheDocument()
    expect(assistantMessage.querySelector('img[onerror]')).not.toBeInTheDocument()
    expect(assistantMessage.querySelector('[onclick]')).not.toBeInTheDocument()
    expect(within(assistantMessage).queryByRole('link', { name: 'unsafe link' })).not.toBeInTheDocument()
  })

  it('keeps discovery graph and nodes when the query result omits graph', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayloadWithoutGraph()))

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await openInspectorDetails(user)
    const nodesPanel = screen.getByRole('region', { name: 'Pages' })
    expect(within(nodesPanel).getByRole('button', { name: /Current Focus hot/ })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText(/Required copy and release readiness/)).toBeInTheDocument()
    const graphPanel = screen.getByRole('region', { name: 'Graph' })
    expect(within(graphPanel).getByLabelText('Knowledge graph overview')).toBeInTheDocument()
    expect(within(graphPanel).queryByText('No map loaded yet.')).not.toBeInTheDocument()
    expect(within(nodesPanel).getByRole('button', { name: /Current Focus hot/ })).toBeInTheDocument()
    expect(within(nodesPanel).getByRole('button', { name: /Artwork Review Process topic/ })).toBeInTheDocument()
  })

  it('queries when crypto.randomUUID is unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', {})

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText(/Required copy and release readiness/)).toBeInTheDocument()
  })

  it('uses source-centered running state while the agent is active', async () => {
    const user = userEvent.setup()
    let resolveQuery: ((response: Response) => void) | undefined
    stubFetch(() => new Promise<Response>((resolve) => {
      resolveQuery = resolve
    }))

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    expect(screen.getByRole('button', { name: 'Running agent...' })).toBeDisabled()
    resolveQuery?.(Response.json(queryPayload()))
    expect(await screen.findByRole('button', { name: sampleAskButtonName })).toBeDisabled()
    expect(screen.getByText('Enter a question to ask the selected source.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Question'), 'Next question')
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeEnabled()
  })

  it('cancels an active run when source selection changes and allows the next turn', async () => {
    const user = userEvent.setup()
    let stallFirstQuery = true
    let resolveFirstQuery: ((response: Response) => void) | undefined
    stubFetch(() => {
      if (!stallFirstQuery) return Response.json(queryPayload())
      return new Promise<Response>((resolve) => {
        resolveFirstQuery = resolve
      })
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await user.type(screen.getByLabelText('Question'), 'First stalled question')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    expect(screen.getByRole('button', { name: 'Running agent...' })).toBeDisabled()
    expect(screen.getByText('Gathering evidence from the selected Knowledge Sources...')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Sample Wiki' }))
    resolveFirstQuery?.(Response.json(queryPayload()))
    expect(
      await screen.findByText('Canceled because the selected scope changed. Ask again when the intended sources and runtime are selected.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Agent run canceled because source or runtime selection changed.')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask selected source' })).toBeDisabled()
    })
    await user.click(screen.getByRole('checkbox', { name: 'Sample Wiki' }))
    stallFirstQuery = false
    await user.type(screen.getByLabelText('Question'), 'Second question after switching')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    expect(await screen.findByText(/For "Second question after switching"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[1\] Current Focus/ })).toBeInTheDocument()
  })

  it('warns but allows an external A2A runtime when the selected ready source is not a public HTTPS URL', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      if (url === `${customA2aRuntimeUrl}/message:send`) {
        return a2aAgentResultResponse('External runtime accepted the selected local source.')
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)

    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeDisabled()
    expect(screen.getAllByText(externalRuntimeSourceUrlAdvisoryMessage).length).toBeGreaterThan(0)

    const prompts = within(screen.getByRole('group', { name: 'Suggested prompts' }))
    prompts.getAllByRole('button').forEach((button) => {
      expect(button).toBeEnabled()
    })

    await user.type(screen.getByLabelText('Question'), 'Use the external runtime with the local source')
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeEnabled()
    expect(document.getElementById('ask-status')).toHaveTextContent(externalRuntimeSourceUrlAdvisoryMessage)

    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))
    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('External runtime accepted the selected local source.')).toBeInTheDocument()
    expect(await within(chat).findByLabelText('Custom A2A run details')).toBeInTheDocument()
  })

  it('renders bridge HTTP problem diagnostics in failed run details', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      if (url === `${customA2aRuntimeUrl}/message:send`) {
        return Response.json({
          type: 'https://llmwiki.test/problems/bridge',
          title: 'Bridge request failed',
          detail: 'Bridge could not reach the selected source.',
          error: {
            diagnostic: {
              observations: ['The selected source refused the bridge connection.'],
              remediation: ['Test the source URL from the bridge host.'],
            },
            traceId: 'bridge-trace-502',
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
        }, { status: 502 })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)

    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))
    await user.type(screen.getByLabelText('Question'), 'Trigger bridge diagnostics')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    const failure = await within(chat).findByText('Agent run failed: Custom A2A message:send returned HTTP 502')
    const assistantMessage = assistantMessageFor(failure)
    const runDetails = within(assistantMessage).getByLabelText('Custom A2A run details') as HTMLDetailsElement
    expect(runDetails.open).toBe(true)
    expect(within(runDetails).getAllByText('Bridge could not reach the selected source.').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText('bridge-trace-502').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText('The selected source refused the bridge connection.').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText('Test the source URL from the bridge host.').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText('Reach selected source').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText('ECONNREFUSED').length).toBeGreaterThan(0)
    expect(within(runDetails).getAllByText(/Partial bridge answer/).length).toBeGreaterThan(0)
  })

  it('allows an external A2A runtime when the selected ready source uses public HTTPS', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), async (url) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const sourceCard = screen.getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
    expect(sourceCard).toBeTruthy()
    await openSourceSetup(user, sourceCard as HTMLElement)
    await user.clear(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'))
    await user.type(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
    await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))
    expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeDisabled()
    await user.type(screen.getByLabelText('Question'), 'Use the external runtime')
    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeEnabled()
    expect(screen.queryByText(externalRuntimeSourceUrlAdvisoryMessage)).not.toBeInTheDocument()
  })

  it('uses a runtime bearer token for discovery and message send without persisting it', async () => {
    const user = userEvent.setup()
    const runtimeCardAuthHeaders: Array<string | null> = []
    let runtimeMessageAuthHeader: string | null = null
    stubFetch(() => Response.json(queryPayload()), async (url, init) => {
      if (url === `${customA2aRuntimeUrl}/.well-known/agent-card.json`) {
        runtimeCardAuthHeaders.push(requestHeader(init, 'authorization'))
        return Response.json({
          name: 'External Runtime',
          description: 'Runtime card',
          url: '/message:send',
          capabilities: { streaming: false },
        })
      }
      if (url === `${customA2aRuntimeUrl}/message:send`) {
        runtimeMessageAuthHeader = requestHeader(init, 'authorization')
        return a2aAgentResultResponse('Authenticated runtime answer.')
      }
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

    const sourceCard = screen.getByRole('checkbox', { name: 'Sample Wiki' }).closest('article')
    expect(sourceCard).toBeTruthy()
    await openSourceSetup(user, sourceCard as HTMLElement)
    await user.clear(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'))
    await user.type(within(sourceCard as HTMLElement).getByLabelText('Sample Wiki URL'), publicSourceUrl)
    await user.click(within(sourceCard as HTMLElement).getByRole('button', { name: 'Test source' }))
    expect(await within(sourceCard as HTMLElement).findByLabelText('Connection status ready')).toBeInTheDocument()

    const runtimeCard = await addRuntime(user, 'Custom A2A')
    await openRuntimeSetup(user, runtimeCard as HTMLElement)
    await user.clear(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'))
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A runtime URL'), customA2aRuntimeUrl)
    await user.type(within(runtimeCard as HTMLElement).getByLabelText('Custom A2A bearer token'), 'runtime-secret')
    expect(within(runtimeCard as HTMLElement).getByText('Bearer token set for this tab only.')).toBeInTheDocument()

    await user.click(within(runtimeCard as HTMLElement).getByRole('button', { name: 'Test runtime' }))
    expect(await within(runtimeCard as HTMLElement).findByLabelText('Agent runtime status ready')).toBeInTheDocument()

    const storedAfterDiscovery = window.localStorage.getItem(agentRuntimeStorageKey) || ''
    expect(storedAfterDiscovery).not.toContain('runtime-secret')
    expect(storedAfterDiscovery).not.toContain('bearerToken')

    await user.click(within(runtimeCard as HTMLElement).getByRole('radio', { name: /Custom A2A/ }))
    await user.type(screen.getByLabelText('Question'), 'Use the authenticated runtime')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    expect(await within(chat).findByText('Authenticated runtime answer.')).toBeInTheDocument()
    expect(runtimeCardAuthHeaders).toEqual([
      null,
      'Bearer runtime-secret',
      'Bearer runtime-secret',
    ])
    expect(runtimeMessageAuthHeader).toBe('Bearer runtime-secret')
    const storedAfterRun = window.localStorage.getItem(agentRuntimeStorageKey) || ''
    expect(storedAfterRun).not.toContain('runtime-secret')
    expect(storedAfterRun).not.toContain('bearerToken')
  })

  it('only lists selected knowledge sources in the tool call trace', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Team Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))
    await user.click(screen.getByRole('checkbox', { name: 'Team Wiki' }))
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    await user.click(screen.getByRole('button', { name: sampleAskButtonName }))

    const chat = screen.getByRole('region', { name: 'Chat' })
    const trace = await within(chat).findByLabelText('Local Development Runtime run details')
    await user.click(within(trace).getByText('Run details'))
    const toolTrace = within(trace).getByLabelText('Tool call trace')
    expect(within(toolTrace).getByText('Sample Wiki')).toBeInTheDocument()
    expect(within(toolTrace).queryByText('Team Wiki')).not.toBeInTheDocument()
  })

  it('blocks asking until every selected knowledge source is ready', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.includes('127.0.0.1:9999/manifest')) return new Response('not found', { status: 404 })
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await selectLocalDevelopmentRuntime(user)
    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Unready Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))
    await user.type(screen.getByLabelText('Question'), 'What is in this wiki?')
    const unreadyCard = screen.getByRole('checkbox', { name: 'Unready Wiki' }).closest('article')
    expect(unreadyCard).toBeTruthy()
    expect(await within(unreadyCard as HTMLElement).findByLabelText('Connection status error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled()
    expect(document.getElementById('ask-status')).toHaveTextContent('Some selected Knowledge Sources need attention. Review the error, retry failed sources, or deselect them.')

    await user.click(screen.getByRole('button', { name: 'Ask selected sources' }))

    const calledUrls = fetchMock.mock.calls.map(([input]) => input instanceof Request ? input.url : String(input))
    expect(calledUrls).not.toContain('http://127.0.0.1:8765/query')
    expect(calledUrls).not.toContain('http://127.0.0.1:9999/query')
  })

  it('disables asking when only selected knowledge sources are unready', async () => {
    const user = userEvent.setup()
    stubFetch(() => Response.json(queryPayload()), (url) => {
      if (url.includes('127.0.0.1:9999/manifest')) return new Response('not found', { status: 404 })
      return undefined
    })

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Unready Wiki')
    await user.clear(screen.getByLabelText('New connection URL'))
    await user.type(screen.getByLabelText('New connection URL'), 'http://127.0.0.1:9999')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    const unreadyCard = screen.getByRole('checkbox', { name: 'Unready Wiki' }).closest('article')
    expect(unreadyCard).toBeTruthy()
    await user.click(within(unreadyCard as HTMLElement).getByRole('button', { name: 'Use only this source' }))
    expect(await within(unreadyCard as HTMLElement).findByLabelText('Connection status error')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: sampleAskButtonName })).toBeDisabled()
    expect(document.getElementById('ask-status')).toHaveTextContent('Some selected Knowledge Sources need attention. Review the error, retry failed sources, or deselect them.')
  })

  it('shows a specific graph empty state when no source is selected', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('checkbox', { name: 'Sample Wiki' }))
    await openInspectorDetails(user)

    const graphPanel = screen.getByRole('region', { name: 'Graph' })
    expect(within(graphPanel).getByText('No map loaded yet.')).toBeInTheDocument()
    expect(within(graphPanel).getByText('Select and test a Knowledge Source to load page links.')).toBeInTheDocument()
    expect(within(graphPanel).queryByLabelText('Knowledge graph overview')).not.toBeInTheDocument()
  })

  it('keeps added source actions isolated when multiple connections are created in one timestamp', async () => {
    const user = userEvent.setup()
    const now = vi.spyOn(Date, 'now').mockReturnValue(123456)
    let generatedId = 0
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `connection-${++generatedId}`),
    })

    try {
      render(<App />)
      expect((await screen.findAllByText('Sample Wiki')).length).toBeGreaterThan(0)

      await openAddSource(user)
      await user.clear(screen.getByLabelText('Name'))
      await user.type(screen.getByLabelText('Name'), 'Team Wiki')
      await user.click(screen.getByRole('button', { name: 'Create source' }))
      await user.clear(screen.getByLabelText('Name'))
      await user.type(screen.getByLabelText('Name'), 'Docs Wiki')
      await user.click(screen.getByRole('button', { name: 'Create source' }))

      const teamCard = screen.getByRole('checkbox', { name: 'Team Wiki' }).closest('article')
      const docsCard = screen.getByRole('checkbox', { name: 'Docs Wiki' }).closest('article')
      expect(teamCard).toBeTruthy()
      expect(docsCard).toBeTruthy()

      await user.click(within(docsCard as HTMLElement).getByRole('button', { name: 'Use only this source' }))

      expect(within(teamCard as HTMLElement).getByRole('checkbox', { name: 'Team Wiki' })).not.toBeChecked()
      expect(within(docsCard as HTMLElement).getByRole('checkbox', { name: 'Docs Wiki' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Sample Wiki' })).not.toBeChecked()
    } finally {
      now.mockRestore()
    }
  })

  it('adds another connection from the inventory form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await openAddSource(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Team Wiki')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    expect(screen.getByRole('checkbox', { name: 'Team Wiki' })).toBeInTheDocument()
  })
})
