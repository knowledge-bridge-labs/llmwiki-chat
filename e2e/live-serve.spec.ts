import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

declare const process: {
  env: {
    LLMWIKI_LIVE_SERVE_URL?: string
    LLMWIKI_LIVE_SERVE_URL_2?: string
    LLMWIKI_LIVE_SERVE_URLS?: string
  }
}

const liveServeUrls = normalizeServeUrls([
  process.env.LLMWIKI_LIVE_SERVE_URL,
  process.env.LLMWIKI_LIVE_SERVE_URL_2,
  ...(process.env.LLMWIKI_LIVE_SERVE_URLS || '').split(','),
])
const liveServeUrl = liveServeUrls[0] || ''
const multiSourceQuery = 'release readiness current focus'
const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'
const knowledgeSourceStorageKey = 'llmwiki-chat:knowledge-source-connections:v1'

interface LiveSourceInfo {
  url: string
  title: string
  pageNodes: LivePageNode[]
  citations: LiveCitation[]
}

interface LivePageNode {
  id: string
  label: string
  kind: string
}

interface LiveCitation {
  sourceRefs: string[]
}

type SelectedLiveSourceInfo = LiveSourceInfo & {
  connectionId: string
}

test.describe('live llmwiki-serve integration', () => {
  test.skip(!liveServeUrl, 'Set LLMWIKI_LIVE_SERVE_URL or LLMWIKI_LIVE_SERVE_URLS to run against a real llmwiki-serve process.')

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

  test('queries a live HTTP knowledge source through the chat UI', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const defaultCard = page.locator('.connection-card').first()
    await openSourceSetup(defaultCard)
    await defaultCard.getByLabel('Local sample LLMWiki URL').fill(liveServeUrl)
    await defaultCard.getByRole('button', { name: 'Test source' }).click()

    const httpCard = connectionCard(page, 'llmwiki-http')
    await expect(httpCard.getByLabel('Connection status ready')).toBeVisible()
    await expect(httpCard).toContainText('Sample Packaging LLMWiki')
    await openSourceSetup(httpCard)
    await httpCard.getByRole('button', { name: 'Use only this source' }).click()

    await openInspectorDetails(page)
    await expect(page.getByRole('region', { name: 'Pages' }).getByRole('button', { name: /Artwork Review Process topic/ })).toBeVisible()

    await askQuestion(page)

    const toolTrace = await expandedLocalDevelopmentTrace(page)
    await expect(toolTrace.locator('li > span', { hasText: 'Sample Packaging LLMWiki' })).toBeVisible()
    await expect(toolTrace.getByText(/llmwiki-http · done/)).toBeVisible()
    await expect(page.getByText('Grounded answer', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /\[1\] Artwork Review Process/ })).toBeVisible()
    await closeInspectorDetails(page)
    await page.getByRole('button', { name: /\[1\] Artwork Review Process/ }).click()
    await expect(page.getByRole('button', { name: /Hide map, pages, and details/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
    await page.getByLabel('Citation evidence').getByText('Citation reference details').click()
    await expect(page.getByLabel('Citation evidence').getByText('SRC-ART-001')).toBeVisible()
  })

  test('keeps two live HTTP sources namespaced when selected together', async ({ page, request }) => {
    test.skip(
      liveServeUrls.length < 2,
      'Set LLMWIKI_LIVE_SERVE_URL and LLMWIKI_LIVE_SERVE_URL_2, or LLMWIKI_LIVE_SERVE_URLS=url1,url2.',
    )

    const [primary, secondary] = await Promise.all(
      liveServeUrls.slice(0, 2).map((url) => loadLiveSourceInfo(request, url)),
    )
    const collision = overlappingPage(primary, secondary)
    expect(
      collision,
      'The two live source graphs should share at least one page label/kind so the test can catch collapsed graph nodes.',
    ).not.toBeNull()
    expect(primary.citations.length, `${primary.title} should return citation evidence for "${multiSourceQuery}"`).toBeGreaterThan(0)
    expect(secondary.citations.length, `${secondary.title} should return citation evidence for "${multiSourceQuery}"`).toBeGreaterThan(0)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const primaryCard = page.locator('.connection-card').nth(0)
    await openSourceSetup(primaryCard)
    await primaryCard.getByLabel('Local sample LLMWiki URL').fill(primary.url)
    await primaryCard.getByRole('button', { name: 'Test source' }).click()
    await expect(primaryCard.getByLabel('Connection status ready')).toBeVisible()
    await expect(primaryCard).toContainText(primary.title)

    await addConnection(page, 'Second live LLMWiki', 'llmwiki-http', secondary.url)
    const secondaryCard = page.locator('.connection-card').nth(1)
    await expect(secondaryCard.getByLabel('Connection status ready')).toBeVisible()
    await expect(secondaryCard).toContainText('Synthetic packaging operations knowledge base.')

    const activeSources = page.getByRole('group', { name: 'Active knowledge source summary' })
    await expect(activeSources.locator('strong').first()).toHaveText('2 selected LLMWiki sources')
    await expect(activeSources).toContainText('2 selected · 2 ready available')
    await expect(activeSources.locator('.source-chip')).toHaveCount(2)
    await expect(activeSources.locator('.source-chip').nth(0)).toContainText(primary.title)
    await expect(activeSources.locator('.source-chip').nth(1)).toContainText('Second live LLMWiki')
    await expect(activeSources.locator('.source-chip small')).toHaveText(['ready', 'ready'])
    await expectSelectedEndpointUrls(page, [primary.url, secondary.url])

    const [primaryConnectionId, secondaryConnectionId] = await connectionIdsForUrls(page, [primary.url, secondary.url])
    expect(primaryConnectionId).toBe('local-demo')
    expect(new Set([primaryConnectionId, secondaryConnectionId]).size).toBe(2)
    const selectedSources: SelectedLiveSourceInfo[] = [
      { ...primary, connectionId: primaryConnectionId },
      { ...secondary, title: 'Second live LLMWiki', connectionId: secondaryConnectionId },
    ]

    const collisionButtonName = pageButtonName(collision as LivePageNode)
    await expectSourcesForPageButton(page, collisionButtonName, selectedSources)

    await askQuestion(page, multiSourceQuery)

    const latestAssistant = page.locator('.message.assistant').last()
    await expect(latestAssistant).toContainText(`used 2 knowledge source(s): ${primary.title}, Second live LLMWiki`)
    await expect(latestAssistant).toContainText('Grounded answer')

    const toolTrace = await expandedLocalDevelopmentTrace(page)
    await expect(toolTrace.locator('li')).toHaveCount(2)
    await expect(toolTrace.locator('li > span')).toHaveText([primary.title, 'Second live LLMWiki'])
    await expect(toolTrace.getByText(/llmwiki-http · done/)).toHaveCount(2)

    const citationButtons = latestAssistant.getByLabel('Citations').getByRole('button')
    await expect(citationButtons).toHaveCount(primary.citations.length + secondary.citations.length)
    await expectCitationIdsForSources(citationButtons, selectedSources)
    await expectCitationEvidenceSources(page, citationButtons, [primary.title, 'Second live LLMWiki'])

    await expect(page.getByRole('button', { name: 'Answer evidence' })).toHaveAttribute('aria-pressed', 'true')
    await expectSourcesForPageButton(page, collisionButtonName, selectedSources)
  })

  test('queries a live MCP knowledge source through the chat UI', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await addConnection(page, 'Live MCP', 'mcp')
    const readyMcpCard = connectionCard(page, 'Live MCP')
    await expect(readyMcpCard.getByLabel('Connection status ready')).toBeVisible()
    await expect(readyMcpCard).toContainText('Synthetic packaging operations knowledge base.')
    await openSourceSetup(readyMcpCard)
    await readyMcpCard.getByRole('button', { name: 'Use only this source' }).click()

    await askQuestion(page)

    const toolTrace = await expandedLocalDevelopmentTrace(page)
    await expect(toolTrace.locator('li > span', { hasText: 'Live MCP' })).toBeVisible()
    await expect(toolTrace.getByText(/mcp · done/)).toBeVisible()
    await expect(page.getByRole('button', { name: /\[1\] Artwork Review Process/ })).toBeVisible()
  })

  test('does not expose live A2A knowledge sources in the default chat source picker', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await openAddSource(page)
    await expect(page.getByLabel('Protocol').locator('option')).toHaveText(['LLMWiki HTTP', 'MCP'])
  })
})

async function addConnection(page: Page, name: string, protocol: string, url = liveServeUrl): Promise<void> {
  await openAddSource(page)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Protocol').selectOption(protocol)
  await page.getByLabel('New connection URL').fill(url)
  await page.getByRole('button', { name: 'Create source' }).click()
}

async function openAddSource(page: Page): Promise<void> {
  await openKnowledgeSourcesSection(page)
  const addSource = page.locator('.add-connection')
  if (!(await addSource.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await addSource.locator('summary').click()
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

async function openKnowledgeSourcesSection(page: Page): Promise<void> {
  await openSidebarSection(page.getByRole('region', { name: 'Knowledge sources' }))
}

async function openSidebarSection(section: Locator): Promise<void> {
  const toggle = section.locator('.sidebar-section-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

async function askQuestion(page: Page, question = 'What needs review?'): Promise<void> {
  await page.getByLabel('Question').fill(question)
  await page.getByRole('button', { name: /^Ask / }).click()
  await expect(page.getByLabel('Local Development Runtime run details')).toBeVisible()
}

async function expandedLocalDevelopmentTrace(page: Page): Promise<Locator> {
  const trace = page.getByLabel('Local Development Runtime run details')
  await expect(trace.locator('summary')).toContainText(/tool call/)
  if ((await trace.getAttribute('open')) === null) {
    await trace.locator('summary').click()
  }
  await expect(trace).toHaveAttribute('open', '')
  const toolTrace = trace.getByLabel('Tool call trace')
  await expect(toolTrace).toBeVisible()
  return toolTrace
}

async function openInspectorDetails(page: Page): Promise<void> {
  const inspect = page.getByRole('button', { name: /(?:Inspect|Hide) map, pages, and details/ })
  if ((await inspect.getAttribute('aria-expanded')) !== 'true') {
    await inspect.click()
  }
  await expect(page.getByRole('region', { name: 'Graph' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pages' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
}

async function closeInspectorDetails(page: Page): Promise<void> {
  const inspect = page.getByRole('button', { name: /(?:Inspect|Hide) map, pages, and details/ })
  if ((await inspect.getAttribute('aria-expanded')) === 'true') {
    await inspect.click()
  }
  await expect(inspect).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0)
}

function connectionCard(page: Page, text: string) {
  return page.locator('.connection-card').filter({ hasText: text }).first()
}

async function loadLiveSourceInfo(request: APIRequestContext, url: string): Promise<LiveSourceInfo> {
  const [manifestResponse, graphResponse, queryResponse] = await Promise.all([
    request.get(joinUrl(url, '/manifest')),
    request.get(joinUrl(url, '/graph?limit=500')),
    request.post(joinUrl(url, '/query'), { data: { query: multiSourceQuery, limit: 8 } }),
  ])
  expect(manifestResponse.ok(), `${url} /manifest should return OK`).toBe(true)
  expect(graphResponse.ok(), `${url} /graph should return OK`).toBe(true)
  expect(queryResponse.ok(), `${url} /query should return OK`).toBe(true)

  const manifest = await manifestResponse.json() as Record<string, unknown>
  const graph = await graphResponse.json() as Record<string, unknown>
  const query = await queryResponse.json() as Record<string, unknown>
  return {
    url,
    title: readString(manifest, 'title') || readString(query, 'wiki_title') || url,
    pageNodes: readRecordArray(graph.nodes).map((node) => ({
      id: readString(node, 'id'),
      label: readString(node, 'label') || readString(node, 'title') || readString(node, 'id'),
      kind: readString(node, 'kind') || readString(node, 'role') || 'node',
    })).filter((node) => node.id.startsWith('page:') && node.label && ['hot', 'index', 'overview', 'topic'].includes(node.kind)),
    citations: readRecordArray(query.evidence).map((item) => ({
      sourceRefs: readStringArray(item.source_refs ?? item.sourceRefs),
    })),
  }
}

async function expectSelectedEndpointUrls(page: Page, urls: string[]): Promise<void> {
  const details = page.locator('.connection-status-details')
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').click()
  }
  for (const url of urls) {
    await expect(details).toContainText(url)
  }
}

async function connectionIdsForUrls(page: Page, urls: string[]): Promise<string[]> {
  const handle = await page.waitForFunction(
    ([storageKey, expectedUrls]) => {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as { connections?: Array<{ id?: string; url?: string; selected?: boolean }> }
        const connections = Array.isArray(parsed.connections) ? parsed.connections : []
        const ids = expectedUrls.map((url) => {
          const connection = connections.find((item) => item.url === url && item.selected === true)
          return connection?.id || ''
        })
        return ids.every(Boolean) ? ids : null
      } catch {
        return null
      }
    },
    [knowledgeSourceStorageKey, urls],
  )
  return await handle.jsonValue() as string[]
}

async function expectSourcesForPageButton(
  page: Page,
  buttonName: string,
  sources: SelectedLiveSourceInfo[],
): Promise<void> {
  await openInspectorDetails(page)
  expect(new Set(sources.map((source) => source.connectionId)).size).toBe(sources.length)
  const graphButtonName = buttonName.replace(/ (hot|index|overview|topic)$/, ' ($1)')
  await expect(
    page.getByRole('region', { name: 'Graph' }).getByRole('button', { name: exactName(`Select graph node ${graphButtonName}`) }),
  ).toHaveCount(sources.length)
  const buttons = page.getByRole('region', { name: 'Pages' }).getByRole('button', { name: exactName(buttonName) })
  await expect(buttons).toHaveCount(sources.length)

  const seenTitles: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    await buttons.nth(index).click()
    const metadata = page.getByLabel('Selected page metadata')
    await expect(metadata).toBeVisible()
    const text = await metadata.textContent()
    const matchingSource = sources.find((source) => text?.includes(`${source.title} · llmwiki-http · ready`))
    expect(matchingSource, `Expected selected page metadata to identify one of ${sources.map((source) => source.title).join(', ')}`).toBeTruthy()
    seenTitles.push(matchingSource?.title || '')
  }
  expect(seenTitles.sort()).toEqual(sources.map((source) => source.title).sort())
}

async function expectCitationIdsForSources(citationButtons: Locator, sources: SelectedLiveSourceInfo[]): Promise<void> {
  const citationIds = await citationButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('data-citation-id') || ''),
  )
  for (const source of sources) {
    const ids = citationIds.filter((id) => id.startsWith(`${source.connectionId}:`))
    expect(ids.length).toBe(source.citations.length)
    expect(
      ids.every((id) => id.startsWith(`${source.connectionId}:`)),
      `Expected citation ids ${ids.join(', ')} to be prefixed with ${source.connectionId}:`,
    ).toBe(true)
  }
}

async function expectCitationEvidenceSources(page: Page, citationButtons: Locator, expectedSourceNames: string[]): Promise<void> {
  const seen = new Set<string>()
  const count = await citationButtons.count()
  for (let index = 0; index < count; index += 1) {
    await citationButtons.nth(index).click()
    const evidence = page.getByLabel('Citation evidence')
    await expect(evidence).toBeVisible()
    const text = await evidence.textContent()
    for (const sourceName of expectedSourceNames) {
      if (text?.includes(`${sourceName} · llmwiki-http · ready`)) seen.add(sourceName)
    }
  }

  expect([...seen].sort()).toEqual([...expectedSourceNames].sort())
}

function overlappingPage(primary: LiveSourceInfo, secondary: LiveSourceInfo): LivePageNode | null {
  const secondaryKeys = new Set(secondary.pageNodes.map(pageNodeKey))
  return primary.pageNodes.find((node) => secondaryKeys.has(pageNodeKey(node))) || null
}

function pageNodeKey(node: LivePageNode): string {
  return pageButtonName(node).toLowerCase()
}

function pageButtonName(node: LivePageNode): string {
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

function normalizeServeUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '')
}

function normalizeServeUrls(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(normalizeServeUrl).filter(Boolean))]
}
