import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

declare const process: {
  env: {
    LLMWIKI_SAMPLE_MATRIX_SOURCES?: string
    LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL?: string
  }
}

const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'
const sampleSources = parseSampleSources(process.env.LLMWIKI_SAMPLE_MATRIX_SOURCES)
const bridgeUrl = normalizeUrl(process.env.LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL)
const sampleStackLabel = bridgeUrl ? 'llmwiki-serve, chat, and bridge' : 'llmwiki-serve and chat'

interface SampleSource {
  id: string
  name: string
  query: string
  url: string
}

interface SourceInfo {
  title: string
  adapter: string
  pageCount: number
  approvedPageCount: number
  pageNodes: PageNode[]
  citationCount: number
  firstSourceRef: string
}

interface PageNode {
  id: string
  label: string
  kind: string
}

test.describe('sample knowledge graph matrix', () => {
  if (!sampleSources.length) {
    test.skip('requires sample source endpoints', async () => {
      // Run `npm run test:e2e:sample-matrix` to start local llmwiki-serve samples.
    })
    return
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([storageKey]) => {
      window.localStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        agents: [
          {
            id: 'mock-agent',
            name: 'Local Development Runtime',
            protocol: 'mock-agent',
            url: '',
            selected: true,
          },
        ],
      }))
    }, [agentRuntimeStorageKey])
  })

  for (const source of sampleSources) {
    test(`${source.id} serves through ${sampleStackLabel}`, async ({ page, request }) => {
      const sourceInfo = await loadSourceInfo(request, source)

      expect(sourceInfo.title, `${source.id} should expose a manifest title`).toBeTruthy()
      expect(sourceInfo.adapter, `${source.id} should expose an adapter`).toBeTruthy()
      expect(sourceInfo.pageCount, `${source.id} should expose pages`).toBeGreaterThan(0)
      expect(sourceInfo.approvedPageCount, `${source.id} should expose approved pages`).toBeGreaterThan(0)
      expect(sourceInfo.pageNodes.length, `${source.id} graph should expose page nodes`).toBeGreaterThan(0)
      expect(sourceInfo.citationCount, `${source.id} query should return evidence`).toBeGreaterThan(0)

      await expectChatSourceFlow(page, source, sourceInfo)
      if (bridgeUrl) await expectBridgeEvidenceOnly(request, source, sourceInfo)
    })
  }
})

async function expectChatSourceFlow(page: Page, source: SampleSource, sourceInfo: SourceInfo): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const defaultCard = page.locator('.connection-card').first()
  await openSourceSetup(defaultCard)
  await defaultCard.getByLabel('Sample Packaging LLMWiki URL').fill(source.url)
  await defaultCard.getByRole('button', { name: 'Test source' }).click()

  const sourceCard = connectionCard(page, sourceInfo.title)
  await expect(sourceCard.getByLabel('Connection status ready')).toBeVisible()
  await expect(sourceCard).toContainText(sourceInfo.title)
  await openSourceSetup(sourceCard)
  await sourceCard.getByRole('button', { name: 'Use only this source' }).click()

  const firstPage = sourceInfo.pageNodes[0]
  await expect(page.getByRole('region', { name: 'Pages' }).getByRole('button', { name: exactName(pageButtonName(firstPage)) })).toBeVisible()
  await page.getByRole('region', { name: 'Pages' }).getByRole('button', { name: exactName(pageButtonName(firstPage)) }).click()
  await expect(page.getByLabel('Selected page metadata')).toContainText(`${sourceInfo.title} · llmwiki-http · ready`)

  await page.getByLabel('Question').fill(source.query)
  await page.getByRole('button', { name: /^Ask / }).click()

  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('Grounded answer')
  await expect(page.getByLabel('Local Development Runtime run details')).toBeVisible()
  const trace = await expandedLocalDevelopmentTrace(page)
  await expect(trace.locator('li > span', { hasText: sourceInfo.title })).toBeVisible()
  await expect(trace.getByText(/llmwiki-http · done/)).toBeVisible()
  await expect(latestAssistant.getByLabel('Citations').getByRole('button')).toHaveCount(sourceInfo.citationCount)
}

async function expectBridgeEvidenceOnly(
  request: APIRequestContext,
  source: SampleSource,
  sourceInfo: SourceInfo,
): Promise<void> {
  const response = await request.post(joinUrl(bridgeUrl, '/message:send'), {
    data: {
      data: {
        query: source.query,
        mode: 'evidence-only',
        knowledgeSources: [
          {
            id: source.id,
            name: sourceInfo.title,
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: source.url,
          },
        ],
      },
    },
  })
  expect(response.ok(), `${source.id} bridge evidence-only response should be OK`).toBe(true)
  const payload = await response.json() as Record<string, unknown>
  const artifact = extractAgentResult(payload)

  expect(readString(artifact, 'orchestrationMode')).toBe('evidence-only')
  expect(readString(artifact, 'answer')).toMatch(/^Evidence-only result:/)
  expect(readRecordArray(artifact.citations).length).toBe(sourceInfo.citationCount)
  expect(readRecordArray(artifact.steps).some((step) => readString(step, 'id') === 'runtime-chat-completions')).toBe(false)
  if (sourceInfo.firstSourceRef) {
    expect(JSON.stringify(artifact)).toContain(sourceInfo.firstSourceRef)
  }
}

async function loadSourceInfo(request: APIRequestContext, source: SampleSource): Promise<SourceInfo> {
  const [manifestResponse, graphResponse, queryResponse] = await Promise.all([
    request.get(joinUrl(source.url, '/manifest')),
    request.get(joinUrl(source.url, '/graph?limit=500')),
    request.post(joinUrl(source.url, '/query'), { data: { query: source.query, limit: 8 } }),
  ])
  expect(manifestResponse.ok(), `${source.id} /manifest should return OK`).toBe(true)
  expect(graphResponse.ok(), `${source.id} /graph should return OK`).toBe(true)
  expect(queryResponse.ok(), `${source.id} /query should return OK`).toBe(true)

  const manifest = await manifestResponse.json() as Record<string, unknown>
  const graph = await graphResponse.json() as Record<string, unknown>
  const query = await queryResponse.json() as Record<string, unknown>
  const evidence = readRecordArray(query.evidence)
  return {
    title: readString(manifest, 'title') || readString(query, 'wiki_title') || source.name,
    adapter: readString(manifest, 'adapter'),
    pageCount: readNumber(manifest, 'page_count') || readNumber(manifest, 'pageCount'),
    approvedPageCount: readNumber(manifest, 'approved_page_count') || readNumber(manifest, 'approvedPageCount'),
    pageNodes: readRecordArray(graph.nodes)
      .map((node, index) => ({
        id: readString(node, 'id') || `node:${index}`,
        label: readString(node, 'label') || readString(node, 'title') || readString(node, 'id'),
        kind: readString(node, 'kind') || readString(node, 'role') || 'node',
      }))
      .filter((node) => node.id.startsWith('page:') && node.label && ['hot', 'index', 'overview', 'topic'].includes(node.kind)),
    citationCount: evidence.length,
    firstSourceRef: readStringArray(evidence[0]?.source_refs ?? evidence[0]?.sourceRefs)[0] || '',
  }
}

async function openSourceSetup(sourceCard: Locator): Promise<void> {
  const sourceSection = sourceCard.locator('xpath=ancestor::section[contains(@class, "source-section")]')
  await openSidebarSection(sourceSection)
  const setup = sourceCard.locator('.source-setup-disclosure').first()
  if (!(await setup.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await setup.locator('summary').click()
  }
}

async function openSidebarSection(section: Locator): Promise<void> {
  const toggle = section.locator('.sidebar-section-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

async function expandedLocalDevelopmentTrace(page: Page): Promise<Locator> {
  const trace = page.getByLabel('Local Development Runtime run details')
  const isOpen = await trace.evaluate((node) => (node as HTMLDetailsElement).open)
  if (!isOpen) await trace.locator('summary').click()
  return trace.getByLabel('Tool call trace')
}

function connectionCard(page: Page, text: string): Locator {
  return page.locator('.connection-card').filter({ hasText: text }).first()
}

function extractAgentResult(payload: Record<string, unknown>): Record<string, unknown> {
  for (const artifact of readRecordArray(payload.artifacts)) {
    if (readString(artifact, 'name') !== 'llmwiki_agent_result') continue
    const parts = readRecordArray(artifact.parts)
    const data = parts.map((part) => asRecord(part.data)).find(Boolean)
    if (data) return data
  }
  throw new Error('Bridge response did not include a llmwiki_agent_result artifact.')
}

function parseSampleSources(value: string | undefined): SampleSource[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('LLMWIKI_SAMPLE_MATRIX_SOURCES must be a JSON array.')
  return parsed.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`LLMWIKI_SAMPLE_MATRIX_SOURCES[${index}] must be an object.`)
    const url = normalizeUrl(readString(record, 'url'))
    if (!url) throw new Error(`LLMWIKI_SAMPLE_MATRIX_SOURCES[${index}].url is required.`)
    return {
      id: readString(record, 'id') || `source-${index + 1}`,
      name: readString(record, 'name') || `Source ${index + 1}`,
      query: readString(record, 'query') || 'What is in this wiki?',
      url,
    }
  })
}

function pageButtonName(node: PageNode): string {
  return `${node.label} ${node.kind}`
}

function exactName(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) || 0 : 0
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizeUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '')
}
