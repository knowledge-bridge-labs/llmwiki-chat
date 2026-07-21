import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { routeSamplePackagingWiki } from './support/samplePackagingWiki'

const externalRuntimeSourceUrlAdvisoryMessage = 'Warning: selected ready Knowledge Source URLs include HTTP, private, or non-public hosts. External runtimes may not be able to reach them; public or strict deployments should use public HTTPS sources or enforce runtime/proxy allowlists.'
const knowledgeSourceStorageKey = 'llmwiki-chat:knowledge-source-connections:v1'
const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'
const localIoLogStorageKey = 'llmwiki-chat:local-io-log:v1'
const localIoLoggingPreferenceStorageKey = 'llmwiki-chat:local-io-logging-enabled:v1'
const coldStartStorageKeys = [
  knowledgeSourceStorageKey,
  agentRuntimeStorageKey,
  localIoLogStorageKey,
  localIoLoggingPreferenceStorageKey,
]

test.beforeEach(async ({ page }) => {
  await routeSamplePackagingWiki(page, 'http://127.0.0.1:8765')
  await page.addInitScript(() => {
    window.localStorage.setItem('llmwiki-chat:agent-runtime-connections:v1', JSON.stringify({
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
  })
})

test('cold-start no-services first-time screen stays calm', async ({ page }) => {
  await isolateColdStartNoLocalServices(page)
  await page.goto('/')
  await clearColdStartStorage(page)

  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ask Local sample LLMWiki' })).toBeVisible()
  await expect(page.locator('.message.user')).toHaveCount(0)
  await expect(page.locator('.message.assistant')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)

  const localSummary = page.getByLabel('Local sample source and runtime')
  await expect(localSummary).toContainText('Local sample LLMWiki')
  await expect(localSummary).toContainText('local sample endpoint · 0 ready')
  await expect(localSummary).toContainText('Local Development Runtime')
  await expect(page.getByRole('button', { name: 'Ask Local sample LLMWiki' })).toBeDisabled()
  await expect(page.locator('#ask-status')).toHaveText('Some selected Knowledge Sources need attention. Review the error, retry failed sources, or deselect them.')
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeDisabled()

  await expect(page.getByRole('button', { name: 'Inspect map, pages, and details' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Graph' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pages' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Local I\/O logging/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Copy JSONL' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Clear local I/O log' })).toBeHidden()
  await expect(page.getByRole('radio', { name: /Hermes/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /DeepAgents/ })).toHaveCount(0)

  await openKnowledgeSourcesSection(page)
  const sampleSource = page
    .getByRole('article')
    .filter({ has: page.getByRole('checkbox', { name: 'Local sample LLMWiki' }) })
  await expect(sampleSource.getByLabel('Connection status error')).toBeVisible()
  await expect(sampleSource).toContainText('Last source test failed. Review the error and test again.')
  await expect(sampleSource.getByRole('button', { name: 'Test source' })).toBeEnabled()

  await openAddSource(page)
  await expect(page.getByLabel('Name')).toBeVisible()
  await expect(page.getByLabel('Protocol')).toContainText('LLMWiki HTTP')
  await expect(page.getByLabel('New connection URL')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create source' })).toBeVisible()

  const quickstartToggle = page.getByRole('button', { name: 'Show Quickstart' })
  await expect(quickstartToggle).toHaveAttribute('aria-expanded', 'false')
  await quickstartToggle.click()
  const quickstart = page.getByRole('region', { name: 'Quickstart' })
  await expect(quickstart).toBeVisible()
  const sourceStep = quickstart.getByRole('region', { name: 'Step 1 source setup' })
  await expect(sourceStep).toContainText('If this check fails or stays unknown')
  await page.setViewportSize({ width: 500, height: 720 })
  await quickstart.getByText('Show llmwiki-serve commands').click()
  await expect(quickstart).toContainText('uvx --from llmwiki-serve==0.2.0')
  await expectQuickstartPanelNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(quickstart.getByRole('region', { name: 'Step 2 runtime choice' })).toHaveCount(0)
  await expect(quickstart.getByRole('region', { name: 'Optional bridge runtime steps' })).toHaveCount(0)
  await expect(quickstart.getByRole('button', { name: 'Use Local Development Runtime' })).toHaveCount(0)
  await expect(quickstart.getByRole('button', { name: 'Test local bridge' })).toHaveCount(0)
  await expect(quickstart).not.toContainText('Hermes')
  await expect(quickstart).not.toContainText('DeepAgents')
  await sourceStep.getByRole('button', { name: 'Test sample source' }).click()
  await expect(sampleSource.getByLabel('Connection status error')).toBeVisible()
  await expect(sourceStep.getByLabel('Quickstart source status')).toContainText('error')
  await expect(sourceStep).toContainText('If this check fails or stays unknown')
  await expect(quickstart.getByRole('region', { name: 'Step 2 runtime choice' })).toHaveCount(0)
  await sourceStep.getByRole('button', { name: 'Close Quickstart' }).click()
  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show Quickstart' })).toHaveAttribute('aria-expanded', 'false')
})

test('cold-start no-services advanced runtime accident recovers to serve-only', async ({ page }) => {
  let sourceAvailable = false
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  await page.addInitScript((storageKeys) => {
    for (const key of storageKeys as string[]) {
      window.localStorage.removeItem(key)
    }
  }, coldStartStorageKeys)
  await page.unroute('http://127.0.0.1:8765/manifest')
  await page.route('http://127.0.0.1:8765/manifest', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (!sourceAvailable) {
      await route.fulfill({ status: 404, headers: corsHeaders, body: 'source missing' })
      return
    }
    await route.fulfill({
      headers: corsHeaders,
      json: {
        title: 'Sample Packaging LLMWiki',
        description: 'Synthetic packaging operations knowledge base.',
        adapter: 'llmwiki-markdown',
        implementation: 'atomicstrata/llm-wiki-compiler',
        page_count: 4,
        approved_page_count: 4,
      },
    })
  })
  await routeLocalServiceUnavailable(page, 'http://127.0.0.1:8788/**')
  await routeLocalServiceUnavailable(page, 'http://localhost:8788/**')

  await page.goto('/')
  await clearColdStartStorage(page)
  await expect(page.getByRole('button', { name: 'Ask Local sample LLMWiki' })).toBeDisabled()

  await page.getByRole('button', { name: 'Show Quickstart' }).click()
  const quickstart = page.getByRole('region', { name: 'Quickstart' })
  const sourceStep = quickstart.getByRole('region', { name: 'Step 1 source setup' })
  await expect(sourceStep).toContainText('If this check fails or stays unknown')
  await expect(quickstart.getByRole('region', { name: 'Step 2 runtime choice' })).toHaveCount(0)

  sourceAvailable = true
  await sourceStep.getByRole('button', { name: 'Test sample source' }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' }).getByLabel('Connection status ready')).toBeVisible()
  const runtimeStep = quickstart.getByRole('region', { name: 'Step 2 runtime choice' })
  await expect(runtimeStep).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()
  await page.getByLabel('Question').fill('What is in this wiki?')
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeEnabled()

  const hermesCard = await addRuntime(page, 'Hermes')
  await selectRuntimeCard(hermesCard)
  const reason = 'Select or configure Hermes so it can be checked, or choose a ready runtime.'
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeDisabled()
  await expect(page.getByText(reason).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeDisabled()
  await expect(runtimeStep.getByRole('button', { name: 'Use Local Development Runtime' })).toBeEnabled()

  await runtimeStep.getByRole('button', { name: 'Use Local Development Runtime' }).click()
  await expect(page.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()
})

test('answers a selected LLMWiki query with citations and graph context', async ({ page, isMobile }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Ask Sample Packaging LLMWiki' })).toBeVisible()
  const localSummary = page.getByLabel('Local sample source and runtime')
  await expect(localSummary).toContainText('Sample Packaging LLMWiki')
  await expect(localSummary).toContainText('local sample endpoint · 1 ready')
  await expect(localSummary).toContainText('Local Development Runtime')
  const endpointMetadata = localSummary.locator('.local-session-details')
  await expect(endpointMetadata).not.toHaveAttribute('open', '')
  await localSummary.getByText('Runtime and endpoint details').click()
  await expect(localSummary.getByText('http://127.0.0.1:8765')).toBeVisible()
  await expect(page.locator('.add-runtime-disclosure')).not.toHaveAttribute('open', '')
  await expect(page.getByLabel('Runtime type')).toBeHidden()
  await expect(page.getByRole('radio', { name: /Hermes/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Local I\/O logging/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Copy JSONL' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Clear local I/O log' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Inspect map, pages, and details' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Graph' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pages' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0)
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await expect(page.getByText('llmwiki-markdown')).toHaveCount(1)
  await expect(page.getByText('atomicstrata/llm-wiki-compiler')).toHaveCount(1)
  const localDevelopmentRuntimeCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('radio', { name: /Local Development Runtime/ }) })
  await expect(localDevelopmentRuntimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Synthetic packaging operations knowledge base.' })
      .getByLabel('Connection status ready'),
  ).toBeVisible()
  const activeSources = page.getByRole('group', { name: 'Active knowledge source summary' })
  await expect(activeSources.getByText('1 selected · 1 ready available')).toBeVisible()
  await expect(activeSources.locator('strong').first()).toHaveText('Sample Packaging LLMWiki')
  await expect(activeSources.getByText('Selected sources tested successfully.')).toBeVisible()
  await expect(page.getByText(/Source tested successfully/).first()).toBeVisible()
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Synthetic packaging operations knowledge base.' })
      .getByLabel('Source selection selected'),
  ).toBeVisible()
  await openSourceRuntimeDetails(page)
  await page.getByRole('button', { name: 'Test selected sources' }).click()
  await expect(activeSources.getByText('Selected sources tested successfully.')).toBeVisible()
  await page.getByRole('button', { name: 'Review sources' }).click()
  await expect(page.getByRole('region', { name: 'Knowledge sources' })).toBeFocused()

  await page.getByLabel('Question').fill('이 지식창고에는 어떤 내용이 있나요?')
  await page.getByLabel('Question').press('Enter')
  await expect(page.getByLabel('Question')).toHaveValue('')

  const agentTrace = page.getByLabel('Local Development Runtime run details')
  await expect(agentTrace).toBeVisible()
  await expect(agentTrace.locator('.status-chip.ready')).toBeVisible()
  await expect(agentTrace.getByText('4 steps · 1 tool call')).toBeVisible()
  await expect(agentTrace.getByText('Planning')).toBeHidden()
  await expandAgentTrace(agentTrace)
  await expect(agentTrace.getByText('Planning')).toBeVisible()
  await expect(agentTrace.getByText('Evidence read')).toBeVisible()
  await expect(agentTrace.getByText('Final answer')).toBeVisible()
  await expect(agentTrace.getByLabel('Tool call trace').locator('li > span', { hasText: 'Sample Packaging LLMWiki' })).toBeVisible()
  await expect(page.getByText(/Local Development Runtime used 1 knowledge source/)).toBeVisible()
  await expect(page.getByText('Grounded answer', { exact: true })).toBeVisible()
  const latestAssistant = page.locator('.message.assistant').last()
  const inlineCitation = latestAssistant.getByRole('button', { name: 'Citation 1: Current Focus' }).first()
  await expect(inlineCitation).toBeVisible()
  await expect(page.getByRole('button', { name: /\[1\] Current Focus/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0)
  await inlineCitation.click()
  await expect(page.getByRole('button', { name: /\[1\] Current Focus/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.selected-node')).toHaveCount(1)
  if (!isMobile) await expectDetailsInsideInspectorViewport(page)
  const citationEvidence = page.getByLabel('Citation evidence')
  await expect(citationEvidence.getByText('Current Focus', { exact: true })).toBeVisible()
  await expect(citationEvidence.getByText('Required label copy and release readiness are current focus items.')).toBeVisible()
  await expect(citationEvidence.getByText('hot.md')).toBeVisible()
  await expect(citationEvidence.getByText('Sample Packaging LLMWiki · llmwiki-http · ready')).toBeVisible()
  await expect(citationEvidence.getByText('Citation reference details')).toBeVisible()
  const details = page.getByRole('region', { name: 'Details' })
  await expect(details.getByText('Related context')).toBeVisible()
  await details.getByText('Related context').click()
  await expect(details.getByRole('button', { name: /Artwork Review Process topic/ })).toBeVisible()

  await page.getByLabel('Select graph node Current Focus (hot)').click()
  await expect(page.getByRole('region', { name: 'Details' }).getByText('Headings')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' }).getByText('SRC-HOT')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' }).getByText('Sample Packaging LLMWiki · llmwiki-http · ready')).toBeVisible()
  const pageMarkdown = page.getByLabel('Selected page markdown')
  await expect(pageMarkdown.getByRole('heading', { name: 'Current Focus' })).toBeVisible()
  await expect(pageMarkdown.getByRole('table')).toBeVisible()
  await expect(pageMarkdown.getByRole('cell', { name: 'Ready' })).toBeVisible()
  await expect(page.locator('.selected-node')).toHaveCount(1)
  await expect(page.locator('.selected-edge')).toHaveCount(1)
  if (!isMobile) await expectDetailsInsideInspectorViewport(page)
  const graphPanel = page.getByRole('region', { name: 'Graph' })
  await expect(graphPanel.getByLabel('Map legend')).toContainText('Page link')
  await expect(graphPanel.getByText(/Selected: Current Focus/)).toBeVisible()

  const nodesPanel = page.getByRole('region', { name: 'Pages' })
  await expect(nodesPanel.getByRole('button', { name: /Current Focus hot/ })).toBeVisible()
  await expect(nodesPanel.getByText('SRC-HOT')).toHaveCount(0)
  await expect(nodesPanel.getByText('heading')).toHaveCount(0)

  await nodesPanel.getByRole('button', { name: /Artwork Review Process topic/ }).focus()
  await page.keyboard.press('Enter')
  await expect(nodesPanel.getByRole('button', { name: /Artwork Review Process topic/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Selected page metadata').getByText('Artwork Review Process', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /\[1\] Current Focus/ }).click()
  await expect(page.locator('.selected-node')).toHaveCount(1)
  await expect(nodesPanel.getByRole('button', { name: /Current Focus hot/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('Required label copy and release readiness')
  await expect(page.getByLabel('Citation evidence').locator('dl dt', { hasText: /^Path$/ })).toBeVisible()
})

test('keeps answer scope and evidence graph clear when source selection changes after a question', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' })).toBeVisible()

  await openAddSource(page)
  await page.getByLabel('Name').fill('Team Wiki')
  await page.getByLabel('New connection URL').fill('http://127.0.0.1:8766')
  await page.getByRole('button', { name: 'Create source' }).click()
  await expect(page.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Ask 2 sources' })).toBeDisabled()
  await expect(page.locator('#ask-status')).toHaveText('Some selected Knowledge Sources need attention. Review the error, retry failed sources, or deselect them.')
  await page.getByRole('checkbox', { name: 'Team Wiki' }).uncheck()

  await page.getByLabel('Question').fill('What is in this wiki?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

  const latestAssistant = page.locator('.message.assistant').last()
  const runDetails = latestAssistant.getByLabel('Local Development Runtime run details')
  await expect(latestAssistant).toContainText('Grounded answer')
  await expect(runDetails).not.toHaveAttribute('open', '')
  await expect(runDetails.locator('summary')).toContainText('test-only deterministic runtime')
  await runDetails.locator('summary').click()
  await expect(runDetails).toContainText('Runtime: Local Development Runtime')
  await expect(runDetails).toContainText('ready')
  await expect(runDetails).toContainText('mode: Local deterministic runtime')
  await expect(runDetails).toContainText('test-only deterministic runtime')
  await expect(runDetails).toContainText('1 selected / 1 used')
  await expect(runDetails).toContainText('Sample Packaging LLMWiki · llmwiki-http')

  await openKnowledgeSourcesSection(page)
  await page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' }).uncheck()
  const knowledgeMap = page.getByRole('region', { name: 'Knowledge map' })
  await expect(knowledgeMap).toContainText('Selected answer evidence')
  await expect(knowledgeMap).toContainText('Showing the selected answer evidence graph; current selected sources are different.')
  await openInspectorDetails(page)
  await expect(page.getByRole('region', { name: 'Graph' }).getByLabel('Knowledge graph overview')).toBeVisible()
  await expect(runDetails).toContainText('Sample Packaging LLMWiki · llmwiki-http')

  await latestAssistant.getByRole('button', { name: /\[1\] Current Focus/ }).click()
  const details = page.getByRole('region', { name: 'Details' })
  await expect(details).toContainText('Detail scope: selected answer evidence; current selected sources differ.')
  await expect(details.getByRole('button', { name: 'Write question' })).toHaveCount(0)
  await expect(details).not.toContainText('Switch to the current source map before writing a question for this page.')
})

test('reveals the start of a completed answer on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile viewport regression coverage.')

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await page.getByLabel('Question').fill('What needs review?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  await expect(page.getByLabel('Question')).toHaveValue('')

  await expect(page.locator('.message.assistant')).toContainText('Grounded answer')

  await page.getByLabel('Question').fill('Show current focus')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('Grounded answer')

  const placement = await latestAssistant.evaluate((node) => {
    const thread = node.closest('.thread')
    const composer = document.querySelector('.composer')
    const citation = node.querySelector('[data-citation-id]')
    const runDetails = node.querySelector('[aria-label="Local Development Runtime run details"]')
    if (!thread || !composer || !citation || !runDetails) return null
    const messageBox = node.getBoundingClientRect()
    const composerBox = composer.getBoundingClientRect()
    const citationBox = citation.getBoundingClientRect()
    const runDetailsBox = runDetails.getBoundingClientRect()
    return {
      composerTop: composerBox.top,
      composerBottom: composerBox.bottom,
      messageTop: messageBox.top,
      messageBottom: messageBox.bottom,
      citationTop: citationBox.top,
      runDetailsTop: runDetailsBox.top,
      runDetailsOpen: (runDetails as HTMLDetailsElement).open,
      threadOverflowY: window.getComputedStyle(thread).overflowY,
      viewportHeight: window.innerHeight,
    }
  })
  expect(placement).not.toBeNull()
  expect(placement?.threadOverflowY).toBe('visible')
  expect(placement?.messageTop ?? 999).toBeGreaterThanOrEqual(-1)
  expect(placement?.messageTop ?? 999).toBeLessThan(120)
  expect(placement?.messageBottom ?? 0).toBeGreaterThan(placement?.messageTop ?? 0)
  expect(placement?.citationTop ?? 0).toBeGreaterThan((placement?.messageTop ?? 0) + 80)
  expect(placement?.runDetailsOpen).toBe(false)
  expect(placement?.runDetailsTop ?? 999).toBeLessThan(placement?.citationTop ?? 0)
  expect(placement?.composerTop ?? 0).toBeGreaterThan(placement?.messageTop ?? 0)
  expect(placement?.composerBottom ?? 0).toBeGreaterThan(0)
  expect(placement?.viewportHeight ?? 0).toBeGreaterThan(0)

  await page.getByLabel('Question').fill('Follow up from the composer')
  await expect(page.getByLabel('Question')).toHaveValue('Follow up from the composer')
})

test('starts mobile Tab order in chat instead of source management', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile tab order regression coverage.')

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()

  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return {
      id: active?.id || '',
      text: active?.textContent?.trim() || '',
      inChat: Boolean(active?.closest('.chat-panel')),
      inSidebar: Boolean(active?.closest('.sidebar')),
    }
  })

  expect(focus.inSidebar).toBe(false)
  expect(focus.inChat).toBe(true)
  expect(focus.id === 'query' || /^(Connection status|Ask:)/.test(focus.text)).toBe(true)
})

test('prioritizes source-first mobile first viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile first viewport regression coverage.')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Ask Sample Packaging LLMWiki' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Suggested prompts' })).toBeVisible()
  await expect(page.locator('.connection-status-details')).not.toHaveAttribute('open', '')
  await expect(page.getByRole('button', { name: 'Review sources' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Test selected sources' })).toBeHidden()

  const firstViewport = await page.evaluate(() => {
    const heading = document.querySelector('.empty-state h1')
    const composer = document.querySelector('.composer')
    const prompts = document.querySelector('.prompt-row')
    const status = document.querySelector('.connection-status-details')
    const headingBox = heading?.getBoundingClientRect()
    const composerBox = composer?.getBoundingClientRect()
    const promptsBox = prompts?.getBoundingClientRect()
    const statusBox = status?.getBoundingClientRect()
    return {
      headingTop: headingBox?.top ?? Number.POSITIVE_INFINITY,
      composerTop: composerBox?.top ?? Number.POSITIVE_INFINITY,
      composerBottom: composerBox?.bottom ?? Number.POSITIVE_INFINITY,
      promptsTop: promptsBox?.top ?? Number.POSITIVE_INFINITY,
      statusTop: statusBox?.top ?? Number.POSITIVE_INFINITY,
      viewportHeight: window.innerHeight,
    }
  })

  expect(firstViewport.headingTop).toBeLessThan(firstViewport.viewportHeight)
  expect(firstViewport.composerBottom).toBeLessThanOrEqual(firstViewport.viewportHeight + 1)
  expect(firstViewport.promptsTop).toBeLessThan(firstViewport.viewportHeight)
  expect(firstViewport.headingTop).toBeLessThan(firstViewport.composerTop)
  expect(firstViewport.statusTop).toBeLessThan(firstViewport.viewportHeight)
})

test('moves mobile citation selection to the Details panel', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile citation detail regression coverage.')

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await page.getByLabel('Question').fill('Show current focus')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('Grounded answer')
  await latestAssistant.getByRole('button', { name: /\[1\] Current Focus/ }).click()

  const details = page.locator('#details-panel')
  await expect(details).toBeFocused()
  await expect(details).toContainText('Detail scope: selected answer evidence.')
  await expect(details).toContainText('Current Focus')
  await expect(details.getByRole('button', { name: 'Back to answer' })).toBeVisible()
  await expect(page.locator('.sidebar .mobile-management-heading')).toHaveText('Source management')
  const placement = await details.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar')
    const sidebarBox = sidebar?.getBoundingClientRect()
    return {
      top: box.top,
      bottom: box.bottom,
      sidebarTop: sidebarBox?.top ?? 0,
      viewportHeight: window.innerHeight,
    }
  })
  expect(placement.top).toBeGreaterThanOrEqual(-1)
  expect(placement.top).toBeLessThan(placement.viewportHeight)
  expect(placement.bottom).toBeGreaterThan(0)
  expect(placement.sidebarTop - placement.bottom).toBeGreaterThan(20)

  const citationButton = latestAssistant.getByRole('button', { name: /\[1\] Current Focus/ })
  await details.getByRole('button', { name: 'Back to answer' }).click()
  await expect(citationButton).toBeFocused()
  const answerPlacement = await citationButton.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return {
      top: box.top,
      bottom: box.bottom,
      viewportHeight: window.innerHeight,
    }
  })
  expect(answerPlacement.top).toBeGreaterThanOrEqual(-1)
  expect(answerPlacement.top).toBeLessThan(answerPlacement.viewportHeight)
  expect(answerPlacement.bottom).toBeGreaterThan(0)

  await openSourceRuntimeDetails(page)
  await page.getByRole('button', { name: 'Review sources' }).click()
  await expect(page.getByRole('region', { name: 'Knowledge sources' })).toBeFocused()
  await expect(page.getByRole('region', { name: 'Details' })).not.toBeFocused()
  await expect(page.getByRole('region', { name: 'Pages' })).not.toBeFocused()
})

test('keeps the tablet composer visible without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await page.getByLabel('Question').fill('What needs review?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  await expect(page.locator('.message.assistant').last()).toContainText('Grounded answer')

  const metrics = await page.evaluate(() => {
    const composer = document.querySelector('.composer')
    const box = composer?.getBoundingClientRect()
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      composerVisible: Boolean(box && box.bottom > 0 && box.top < window.innerHeight),
      composerLeft: box?.left ?? -1,
      composerRight: box?.right ?? Number.POSITIVE_INFINITY,
    }
  })
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.composerVisible).toBe(true)
  expect(metrics.composerLeft).toBeGreaterThanOrEqual(0)
  expect(metrics.composerRight).toBeLessThanOrEqual(metrics.clientWidth + 1)
})

test('disables suggested prompts with the same inline reason for an unavailable runtime', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  const runtimeCard = await addRuntime(page, 'Hermes')
  await selectRuntimeCard(runtimeCard)

  const reason = 'Select or configure Hermes so it can be checked, or choose a ready runtime.'
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeDisabled()
  await expect(page.getByText(reason).first()).toBeVisible()
  const promptButtons = page.getByRole('group', { name: 'Suggested prompts' }).getByRole('button')
  await expect(promptButtons).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeDisabled()
  for (const button of await promptButtons.all()) {
    await expect(button).toBeDisabled()
  }

  await page.getByLabel('Question').press('Enter')
  await expect(page.getByText(reason).first()).toBeVisible()
  await expect(page.getByLabel('Hermes run details')).toHaveCount(0)
})

test('shows browser-safe quickstart commands and reuses source checks', async ({ page }) => {
  let sourceAvailable = false
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  await page.unroute('http://127.0.0.1:8765/manifest')
  await page.route('http://127.0.0.1:8765/manifest', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (!sourceAvailable) {
      await route.fulfill({ status: 404, headers: corsHeaders, body: 'source missing' })
      return
    }
    await route.fulfill({
      headers: corsHeaders,
      json: {
        title: 'Sample Packaging LLMWiki',
        description: 'Synthetic packaging operations knowledge base.',
        adapter: 'llmwiki-markdown',
        implementation: 'atomicstrata/llm-wiki-compiler',
        page_count: 4,
        approved_page_count: 4,
      },
    })
  })
  await page.route('http://127.0.0.1:8788/.well-known/agent-card.json', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    await route.fulfill({ status: 404, headers: corsHeaders, body: 'bridge missing' })
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')

  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)
  const quickstartToggle = page.getByRole('button', { name: 'Show Quickstart' })
  await expect(quickstartToggle).toHaveAttribute('aria-expanded', 'false')
  await quickstartToggle.click()
  await expect(page.getByRole('button', { name: 'Hide Quickstart' })).toHaveAttribute('aria-expanded', 'true')

  const quickstart = page.getByRole('region', { name: 'Quickstart' })
  await expect(quickstart).toBeVisible()
  await expect(quickstart).toBeFocused()
  await expect(quickstart.getByRole('heading', {
    name: 'Step 1: connect llmwiki-serve.',
  })).toBeVisible()
  await expect(quickstart).toContainText('cannot install packages, start local processes')
  await expect(quickstart).toContainText('For a first pass, you only need llmwiki-serve')
  const sourceStep = quickstart.getByRole('region', { name: 'Step 1 source setup' })
  await expect(sourceStep).toBeVisible()
  await expect(sourceStep.getByRole('button', { name: 'Test sample source' })).toBeVisible()
  await expect(sourceStep).toContainText('If this check fails or stays unknown')
  await expect(quickstart.getByRole('region', { name: 'Step 2 runtime choice' })).toHaveCount(0)
  await expect(quickstart.getByRole('button', { name: 'Test local bridge' })).toHaveCount(0)
  await expect(quickstart).not.toContainText('Hermes')
  await expect(quickstart).not.toContainText('DeepAgents')
  await expect(quickstart).not.toContainText('llmwiki-agent-bridge@0.1.0')
  await expect(quickstart).toContainText('llmwiki-serve==0.2.0')
  await expect(quickstart).toContainText('/path/to/wiki')

  await page.setViewportSize({ width: 500, height: 720 })
  await quickstart.getByText('Show llmwiki-serve commands').click()
  await expectQuickstartPanelNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1280, height: 720 })

  sourceAvailable = true
  await sourceStep.getByRole('button', { name: 'Test sample source' }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' }).getByLabel('Connection status ready')).toBeVisible()
  const runtimeStep = quickstart.getByRole('region', { name: 'Step 2 runtime choice' })
  await expect(runtimeStep).toBeVisible()
  await expect(runtimeStep).toContainText('Default: use Local Development Runtime')
  await expect(runtimeStep).toContainText('Serve-only path is ready')
  await expect(runtimeStep.getByRole('button', { name: 'Continue serve-only' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()
  await expect(runtimeStep.getByRole('button', { name: 'Show optional bridge/runtime steps' })).toHaveAttribute('aria-expanded', 'false')
  await expect(runtimeStep.getByRole('button', { name: 'Test local bridge' })).toHaveCount(0)
  await expect(runtimeStep).not.toContainText('Hermes')
  await expect(runtimeStep).not.toContainText('DeepAgents')

  await runtimeStep.getByRole('button', { name: 'Show optional bridge/runtime steps' }).click()
  const advancedRuntime = runtimeStep.getByRole('region', { name: 'Optional bridge runtime steps' })
  await expect(advancedRuntime).toBeVisible()
  await expect(advancedRuntime).toContainText('No bridge or LLM endpoint? Skip this')
  await expect(advancedRuntime).toContainText('Hermes, DeepAgents, or OpenAI-compatible runtimes')
  await expect(advancedRuntime.getByRole('link', { name: 'Quickstart docs' })).toHaveAttribute(
    'href',
    'https://knowledge-bridge-labs.github.io/llmwiki-docs/quickstart',
  )
  await expect(advancedRuntime.getByRole('link', { name: 'Runtime adapter notes' })).toHaveAttribute(
    'href',
    'https://knowledge-bridge-labs.github.io/llmwiki-docs/runtime-adapters',
  )
  await expect(advancedRuntime.getByRole('link', { name: 'Agent Bridge README' })).toHaveAttribute(
    'href',
    'https://github.com/knowledge-bridge-labs/llmwiki-agent-bridge#readme',
  )
  await expect(advancedRuntime.getByRole('button', { name: 'Test local bridge' })).toBeVisible()
  await advancedRuntime.getByRole('button', { name: 'Test local bridge' }).click()
  await expect(page.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).toBeChecked()
  await expect(advancedRuntime).toContainText('Bridge test failed')
  await expect(advancedRuntime).toContainText('Start or restart llmwiki-agent-bridge')
  await expect(advancedRuntime).toContainText('confirm http://127.0.0.1:8788')
  await expect(advancedRuntime).toContainText('skip/continue serve-only')
  await expect(advancedRuntime).toContainText('No bridge or LLM endpoint? Skip this')
  await expect(runtimeStep.getByRole('button', { name: 'Use Local Development Runtime' })).toBeEnabled()
  await runtimeStep.getByRole('button', { name: 'Use Local Development Runtime' }).click()
  await expect(page.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()
  await expectQuickstartStatusInsidePanel(page)

  await page.setViewportSize({ width: 500, height: 720 })
  await expectQuickstartStatusInsidePanel(page)
  await advancedRuntime.getByRole('button', { name: 'Skip and close' }).click()
  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)
})

test('quickstart states pass focused accessibility scans', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)
  await expectNoAxeViolations(page, 'default app shell', '.app-shell')

  await openInspectorDetails(page)
  await expectNoAxeViolations(page, 'inspector details open', '.inspector')

  await openAgentBridgeSection(page)
  await page.locator('.add-runtime-disclosure summary').click()
  await expect(page.getByLabel('Runtime type')).toBeVisible()
  await expectNoAxeViolations(page, 'runtime add disclosure open', '.sidebar')

  await page.getByRole('region', { name: 'Local I/O log', exact: true }).locator('.local-io-log-panel-header').click()
  await expect(page.getByRole('button', { name: 'Copy JSONL' })).toBeVisible()
  await expectNoAxeViolations(page, 'local I/O log open', '.inspector')
  await page.setViewportSize({ width: 500, height: 720 })
  await expectAppShellNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.getByRole('button', { name: 'Show Quickstart' }).click()
  const quickstart = page.getByRole('region', { name: 'Quickstart' })
  await expect(quickstart).toBeVisible()
  await expectNoAxeViolations(page, 'opened quickstart', '#quickstart-panel')

  await page.setViewportSize({ width: 500, height: 720 })
  await quickstart.getByText('Show llmwiki-serve commands').click()
  await expectQuickstartPanelNoHorizontalOverflow(page)
  await expectNoAxeViolations(page, 'mobile quickstart with source commands', '#quickstart-panel')

  await page.setViewportSize({ width: 1280, height: 720 })
  const runtimeStep = quickstart.getByRole('region', { name: 'Step 2 runtime choice' })
  await expect(runtimeStep).toBeVisible()
  await runtimeStep.getByRole('button', { name: 'Show optional bridge/runtime steps' }).click()
  await expect(runtimeStep.getByRole('region', { name: 'Optional bridge runtime steps' })).toBeVisible()
  await expectNoAxeViolations(page, 'advanced quickstart', '#quickstart-panel')
})

test('labels suggested prompts as ask actions and clears the composer when they run', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await expect(page.getByLabel('Question')).toHaveValue('')

  await page.getByLabel('Question').fill('Draft question')
  await page.getByRole('button', { name: 'Ask: Show current focus' }).click()

  await expect(page.getByLabel('Question')).toHaveValue('')
  await expect(page.locator('.message.user').last()).toContainText('Show current focus')
  await expect(page.locator('.message.assistant').last()).toContainText('Grounded answer')
})

test('loads graph, nodes, and details from graph endpoint before querying', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('region', { name: 'Graph' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pages' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0)
  await openInspectorDetails(page)
  await expect(page.getByRole('region', { name: 'Graph' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pages' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
  const nodesPanel = page.getByRole('region', { name: 'Pages' })
  await expect(nodesPanel.getByRole('button', { name: /Current Focus hot/ })).toBeVisible()
  await expect(nodesPanel.getByRole('button', { name: /Artwork Review Process topic/ })).toBeVisible()
  await expect(page.getByText('Choose a page in the map to see its path, links, and source.')).toBeVisible()
})

test('shows selected graph page details without prompt shortcut actions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()

  await openInspectorDetails(page)
  const nodesPanel = page.getByRole('region', { name: 'Pages' })
  await nodesPanel.getByRole('button', { name: /Current Focus hot/ }).click()

  const details = page.getByRole('region', { name: 'Details' })
  await expect(details.getByLabel('Selected page metadata')).toContainText('Sample Packaging LLMWiki · llmwiki-http · ready')
  await expect(details.getByRole('button', { name: 'Write question' })).toHaveCount(0)
  await expect(details).not.toContainText('Draft question will include')
  await expect(page.getByLabel('Question')).toHaveValue('')
  await expect(page.locator('.message.user')).toHaveCount(0)
  await expect(page.locator('.message.assistant')).toHaveCount(0)
})

test('shows an explicit graph empty state when selected sources are cleared', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()

  await openKnowledgeSourcesSection(page)
  await page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' }).uncheck()

  await openInspectorDetails(page)
  const graphPanel = page.getByRole('region', { name: 'Graph' })
  await expect(graphPanel.getByText('No map loaded yet.')).toBeVisible()
  await expect(graphPanel.getByText('Select and test a Knowledge Source to load page links.')).toBeVisible()
  await expect(graphPanel.getByLabel('Knowledge graph overview')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pages' }).getByText('No pages loaded yet.')).toBeVisible()
})

test('adds a second connection without losing the current thread', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Question').fill('What is in this wiki?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  await expect(page.getByText(/Local Development Runtime used 1 knowledge source/)).toBeVisible()

  await openAddSource(page)
  await page.getByLabel('Name').fill('Team Wiki')
  await page.getByLabel('New connection URL').fill('http://127.0.0.1:8765')
  await page.getByRole('button', { name: 'Create source' }).click()

  await expect(page.getByRole('checkbox', { name: 'Team Wiki' })).toBeVisible()
  await expect(page.locator('.message.user').getByText('What is in this wiki?')).toBeVisible()
})

test('persists added source config across reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' })).toBeVisible()
  await routeSamplePackagingWiki(page, 'http://127.0.0.1:8766')

  await openAddSource(page)
  await page.getByLabel('Name').fill('Team Wiki')
  await page.getByLabel('New connection URL').fill('http://127.0.0.1:8766')
  await page.getByRole('button', { name: 'Create source' }).click()

  const teamConnection = page.locator('.connection-card').filter({ hasText: 'Team Wiki' })
  await expect(teamConnection.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
  await openSourceSetup(teamConnection)
  await expect(teamConnection.getByLabel('Team Wiki URL')).toHaveValue('http://127.0.0.1:8766')

  await page.reload()

  await expect(page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' })).toBeVisible()
  const reloadedTeamConnection = page.locator('.connection-card').filter({ hasText: 'Team Wiki' })
  await expect(reloadedTeamConnection.getByRole('checkbox', { name: 'Team Wiki' })).toBeChecked()
  await openSourceSetup(reloadedTeamConnection)
  await expect(reloadedTeamConnection.getByLabel('Team Wiki URL')).toHaveValue('http://127.0.0.1:8766')
  await expect(reloadedTeamConnection.getByLabel('Connection status ready')).toBeVisible()
})

test('cancels a stalled run after source selection changes and keeps the next ask usable', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  let releaseFirstQuery: () => void = () => {}
  let firstQueryPending = true
  const firstQueryGate = new Promise<void>((resolve) => {
    releaseFirstQuery = resolve
  })

  await page.route('http://127.0.0.1:8765/query', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (firstQueryPending) {
      firstQueryPending = false
      await firstQueryGate
      await route.fulfill({ headers: corsHeaders, json: samplePackagingQueryPayload() }).catch(() => {})
      return
    }
    await route.fulfill({ headers: corsHeaders, json: samplePackagingQueryPayload() })
  })

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await openSourceRuntimeDetails(page)
  await page.getByRole('button', { name: 'Test selected sources' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Chat' })).toBeVisible()

  await page.getByLabel('Question').fill('First stalled question')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  await expect(page.getByRole('button', { name: 'Running agent...' })).toBeDisabled()
  await expect(page.getByText('Gathering evidence from the selected Knowledge Sources...')).toBeVisible()

  await openKnowledgeSourcesSection(page)
  await page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' }).uncheck()
  releaseFirstQuery()
  await expect(page.getByText('Canceled because the selected scope changed. Ask again when the intended sources and runtime are selected.')).toBeVisible()
  await expect(page.getByText('Agent run canceled because source or runtime selection changed.')).toHaveCount(0)
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Chat' })).toBeVisible()

  await page.getByRole('checkbox', { name: 'Sample Packaging LLMWiki' }).check()
  await page.getByLabel('Question').fill('Second question after switching')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('Grounded answer')
  await expect(latestAssistant).toContainText('Second question after switching')
  expect(pageErrors).toEqual([])
})

test('adds and queries an MCP knowledge source', async ({ page }) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  await page.route('http://127.0.0.1:8767/mcp', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    const body = route.request().postDataJSON() as {
      method?: string
      params?: { name?: string; arguments?: Record<string, unknown> }
    }
    if (body.method === 'tools/list') {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [{ name: 'llmwiki_context' }, { name: 'llmwiki_graph' }] },
        },
      })
      return
    }

    if (body.params?.name === 'llmwiki_context') {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          jsonrpc: '2.0',
          id: 2,
          result: {
            wiki_title: 'MCP Packaging Wiki',
            orientation: [{ title: 'MCP Focus', role: 'hot', snippet: 'MCP endpoint focus.' }],
            evidence: [
              {
                page_id: 'mcp-focus',
                title: 'MCP Focus',
                path: 'mcp-focus.md',
                snippet: 'MCP source returned protocol-specific context.',
                source_refs: ['MCP-SRC'],
              },
            ],
            graph: {
              nodes: [{ id: 'page:mcp-focus', label: 'MCP Focus', kind: 'hot', path: 'mcp-focus.md' }],
              edges: [],
            },
          },
        },
      })
      return
    }

    if (body.params?.name === 'llmwiki_graph') {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          jsonrpc: '2.0',
          id: 3,
          result: {
            nodes: [{ id: 'page:mcp-focus', label: 'MCP Focus', kind: 'hot', path: 'mcp-focus.md' }],
            edges: [],
          },
        },
      })
      return
    }

    await route.fulfill({ status: 400, headers: corsHeaders, body: 'unexpected MCP call' })
  })

  await page.goto('/')
  await openAddSource(page)
  await page.getByLabel('Name').fill('MCP Endpoint')
  await page.getByLabel('Protocol').selectOption('mcp')
  await page.getByLabel('New connection URL').fill('http://127.0.0.1:8767')
  await page.getByRole('button', { name: 'Create source' }).click()

  const readyMcpConnection = page.locator('.connection-card').filter({ hasText: 'MCP Endpoint' })
  await expect(readyMcpConnection.getByLabel('Connection status ready')).toBeVisible()
  await openSourceSetup(readyMcpConnection)
  await readyMcpConnection.getByRole('button', { name: 'Use only this source' }).click()

  await page.getByLabel('Question').fill('What does MCP know?')
  await page.getByRole('button', { name: 'Ask MCP Endpoint' }).click()

  const toolTrace = page.getByLabel('Tool call trace')
  await expandAgentTrace(page.getByLabel('Local Development Runtime run details'))
  await expect(toolTrace.locator('li > span', { hasText: 'MCP Endpoint' })).toBeVisible()
  await expect(toolTrace.getByText(/mcp · done/)).toBeVisible()
  await expect(page.locator('.message.assistant').last().getByText('MCP source returned protocol-specific context.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /\[1\] MCP Focus/ })).toBeVisible()
})

test('keeps A2A knowledge sources out of the default add-source flow', async ({ page }) => {
  await page.goto('/')
  await openAddSource(page)

  const protocol = page.getByLabel('Protocol')
  await expect(protocol.locator('option')).toHaveText(['LLMWiki HTTP', 'MCP'])
})

test('warns but allows a custom A2A Agent Runtime when selected LLMWiki sources are not public HTTPS', async ({ page }) => {
  const blockedSourceUrl = 'http://wiki.example.test'
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  let runtimeMessagePostCalls = 0

  await page.route('http://127.0.0.1:8770/.well-known/agent-card.json', async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        name: 'Custom Runtime',
        description: 'Route-mocked A2A runtime',
        url: '/message:send',
        capabilities: { streaming: false },
      },
    })
  })
  await page.route('http://127.0.0.1:8770/message:send', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    runtimeMessagePostCalls += 1
    await route.fulfill({
      headers: corsHeaders,
      json: {
        status: { state: 'completed' },
        artifacts: [],
      },
    })
  })

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await routeSamplePackagingWiki(page, blockedSourceUrl)

  const sourceCard = page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' })
  await openSourceSetup(sourceCard)
  await sourceCard.getByLabel('Sample Packaging LLMWiki URL').fill(blockedSourceUrl)
  await page.keyboard.press('Tab')
  await expect(sourceCard.getByLabel('Connection status ready')).toBeVisible()

  const runtimeCard = await addRuntime(page, 'Custom A2A')
  await openRuntimeSetup(runtimeCard)
  await runtimeCard.getByLabel('Custom A2A runtime URL').fill('http://127.0.0.1:8770')
  await page.keyboard.press('Tab')
  await expect(runtimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
  await selectRuntimeCard(runtimeCard)

  await expect(page.getByText(externalRuntimeSourceUrlAdvisoryMessage).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask: What is in this wiki?' })).toBeEnabled()
  await page.getByLabel('Question').fill('Use the private HTTP source')
  await expect(page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' })).toBeEnabled()
  await expect(page.locator('#ask-status')).toHaveText(externalRuntimeSourceUrlAdvisoryMessage)
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()
  await expect(page.getByLabel('Custom A2A run details')).toBeVisible()
  expect(runtimeMessagePostCalls).toBeGreaterThan(0)
})

test('uses a custom A2A Agent Runtime with selected LLMWiki sources', async ({ page }) => {
  const publicSourceUrl = 'https://wiki.example.test'
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  let runtimeBody: {
    data?: {
      query?: string
      knowledgeSources?: Array<Record<string, unknown>>
    }
  } | undefined

  await page.route('http://127.0.0.1:8770/.well-known/agent-card.json', async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        name: 'Custom Runtime',
        description: 'Route-mocked A2A runtime',
        url: '/message:send',
        capabilities: { streaming: false },
      },
    })
  })
  await page.route('http://127.0.0.1:8770/message:send', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    runtimeBody = route.request().postDataJSON() as typeof runtimeBody
    await route.fulfill({
      headers: corsHeaders,
      json: {
        status: { state: 'completed' },
        artifacts: [
          {
            name: 'llmwiki_agent_result',
            parts: [
              {
                kind: 'data',
                data: {
                  answer: 'External runtime used selected LLMWiki sources [1](#citation-1).',
                  citations: [
                    {
                      id: 'local-demo:runtime-focus',
                      title: 'Runtime Focus',
                      path: 'runtime.md',
                      snippet: 'The custom runtime received the selected source descriptor.',
                      connectionId: 'local-demo',
                      sourceRefs: ['RUNTIME-SRC'],
                    },
                  ],
                  graph: {
                    nodes: [{ id: 'page:runtime-focus', label: 'Runtime Focus', kind: 'topic', path: 'runtime.md' }],
                    edges: [],
                  },
                  steps: [
                    {
                      id: 'runtime-tool-local-demo',
                      label: 'Call selected source',
                      status: 'done',
                      connectionId: 'local-demo',
                      toolName: 'llmwiki_context__local_demo',
                      detail: 'Read the selected LLMWiki source.',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    })
  })

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await routeSamplePackagingWiki(page, publicSourceUrl)

  const sourceCard = page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' })
  await openSourceSetup(sourceCard)
  await sourceCard.getByLabel('Sample Packaging LLMWiki URL').fill(publicSourceUrl)
  await page.keyboard.press('Tab')
  await expect(sourceCard.getByLabel('Connection status ready')).toBeVisible()

  const runtimeCard = await addRuntime(page, 'Custom A2A')
  await openRuntimeSetup(runtimeCard)
  await runtimeCard.getByLabel('Custom A2A runtime URL').fill('http://127.0.0.1:8770')
  await page.keyboard.press('Tab')
  await expect(runtimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
  await selectRuntimeCard(runtimeCard)

  await page.getByLabel('Question').fill('Use the external runtime')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('External runtime used selected LLMWiki sources')
  const inlineCitation = latestAssistant.getByRole('button', { name: 'Citation 1: Runtime Focus' }).first()
  await expect(inlineCitation).toBeVisible()
  await expect(page.getByRole('button', { name: /\[1\] Runtime Focus/ })).toBeVisible()
  await inlineCitation.click()
  await expect(page.locator('.selected-node')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('Runtime Focus')
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('The custom runtime received the selected source descriptor.')
  await expandAgentTrace(page.getByLabel('Custom A2A run details'))
  await expect(page.getByLabel('Tool call trace').locator('li > span', { hasText: 'Sample Packaging LLMWiki' })).toBeVisible()
  expect(runtimeBody?.data?.query).toBe('Use the external runtime')
  expect(runtimeBody?.data?.knowledgeSources?.[0]).toMatchObject({
    id: 'local-demo',
    name: 'Sample Packaging LLMWiki',
    protocol: 'llmwiki-http',
    url: publicSourceUrl,
    capabilities: [],
    adapter: 'llmwiki-markdown',
    implementation: 'atomicstrata/llm-wiki-compiler',
  })
  expect(runtimeBody?.data?.knowledgeSources?.[0]).not.toHaveProperty('graph')
})

test('keeps Hermes explicitly selectable across add and remove cycles', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('llmwiki-chat:agent-runtime-connections:v1', JSON.stringify({
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
  })

  await page.goto('/')
  await expect(page.getByRole('radio', { name: /Local Development Runtime/ })).toBeChecked()

  await openSidebarSection(page.getByRole('region', { name: 'Agent runtime' }))
  const addRuntime = page.locator('.add-runtime-disclosure')
  await expect(addRuntime).not.toHaveAttribute('open', '')
  await expect(page.getByLabel('Runtime type')).toBeHidden()
  await addRuntime.locator('summary').click()
  await expect(page.getByLabel('Runtime type')).toContainText('Hermes')

  await page.getByLabel('Runtime type').selectOption({ label: 'Hermes' })
  await page.getByRole('button', { name: 'Add runtime' }).click()
  let hermesCard = page.getByRole('article').filter({ has: page.getByRole('radio', { name: /Hermes/ }) })
  await expect(hermesCard.getByRole('radio', { name: /Hermes/ })).toBeChecked()
  await expect(hermesCard.getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()

  await openRuntimeSetup(hermesCard)
  await hermesCard.getByRole('button', { name: 'Remove runtime' }).click()
  await expect(page.getByRole('radio', { name: /Hermes/ })).toHaveCount(0)
  await expect(page.getByLabel('Runtime type')).toHaveValue('hermes')

  await page.getByRole('button', { name: 'Add runtime' }).click()
  hermesCard = page.getByRole('article').filter({ has: page.getByRole('radio', { name: /Hermes/ }) })
  await expect(hermesCard.getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()

  await openRuntimeSetup(hermesCard)
  await hermesCard.getByRole('button', { name: 'Remove runtime' }).click()
  await expect(page.getByRole('radio', { name: /Hermes/ })).toHaveCount(0)
  await expect(page.getByLabel('Runtime type')).toHaveValue('hermes')

  await page.getByRole('button', { name: 'Add runtime' }).click()
  hermesCard = page.getByRole('article').filter({ has: page.getByRole('radio', { name: /Hermes/ }) })
  await expect(hermesCard.getByRole('button', { name: 'Using Hermes runtime' })).toBeDisabled()

  await page.getByRole('button', { name: 'Use Local Agent Bridge (A2A) runtime' }).click()
  await expect(page.getByRole('radio', { name: /Local Agent Bridge \(A2A\)/ })).toBeChecked()
  await hermesCard.getByRole('button', { name: 'Use Hermes runtime' }).click()
  await expect(hermesCard.getByRole('radio', { name: /Hermes/ })).toBeChecked()
})

test('keeps completed run details above the answer and displays runtime evidence in read order', async ({ page }) => {
  const publicSourceUrl = 'https://wiki.example.test'
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }

  await page.route('http://127.0.0.1:8770/.well-known/agent-card.json', async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        name: 'Custom Runtime',
        description: 'Route-mocked A2A runtime',
        url: '/message:send',
        capabilities: { streaming: false },
      },
    })
  })
  await page.route('http://127.0.0.1:8770/message:send', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    await route.fulfill({
      headers: corsHeaders,
      json: {
        status: { state: 'completed' },
        artifacts: [
          {
            name: 'llmwiki_agent_result',
            parts: [
              {
                kind: 'data',
                data: {
                  answer: 'Runtime answer cites [3](#citation-3), [2](#citation-2), and [1](#citation-1).',
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
                      id: 'read-selected-source',
                      label: 'Call Wiki Index',
                      status: 'done',
                      connectionId: 'local-demo',
                      toolName: 'llmwiki_context__local_demo',
                      detail: 'Read 3 citation(s) from Wiki Index.',
                      citation_ids: ['local-demo:hot', 'local-demo:index', 'local-demo:topic'],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    })
  })

  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()
  await routeSamplePackagingWiki(page, publicSourceUrl)

  const sourceCard = page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' })
  await openSourceSetup(sourceCard)
  await sourceCard.getByLabel('Sample Packaging LLMWiki URL').fill(publicSourceUrl)
  await page.keyboard.press('Tab')
  await expect(sourceCard.getByLabel('Connection status ready')).toBeVisible()

  const runtimeCard = await addRuntime(page, 'Custom A2A')
  await openRuntimeSetup(runtimeCard)
  await runtimeCard.getByLabel('Custom A2A runtime URL').fill('http://127.0.0.1:8770')
  await page.keyboard.press('Tab')
  await expect(runtimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
  await selectRuntimeCard(runtimeCard)

  await page.getByLabel('Question').fill('What is in this wiki?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

  const latestAssistant = page.locator('.message.assistant').last()
  await expect(latestAssistant).toContainText('Runtime answer cites')
  const runDetails = latestAssistant.getByLabel('Custom A2A run details')
  await expect(runDetails).toBeVisible()
  await expect(latestAssistant.locator('.citations button')).toHaveText([
    '[1] Current Focus',
    '[2] Wiki Index',
    '[3] Topic Page',
  ])
  await expect(latestAssistant.getByRole('button', { name: 'Citation 1: Current Focus' })).toHaveText('1')
  await expect(latestAssistant.getByRole('button', { name: 'Citation 2: Wiki Index' })).toHaveText('2')

  const layoutOrder = await latestAssistant.evaluate((article) => {
    const children = [...article.children]
    const detailsIndex = children.findIndex((child) => child.classList.contains('answer-run-details'))
    const answerIndex = children.findIndex((child) => child.textContent?.includes('Runtime answer cites'))
    return { detailsIndex, answerIndex }
  })
  expect(layoutOrder.detailsIndex).toBeGreaterThanOrEqual(0)
  expect(layoutOrder.detailsIndex).toBeLessThan(layoutOrder.answerIndex)

  await latestAssistant.getByRole('button', { name: 'Citation 1: Current Focus' }).click()
  await expect(page.getByLabel('Citation evidence')).toContainText('hot.md')
  await expect(page.getByLabel('Citation evidence')).toContainText('Hot evidence.')
})

test('only selected knowledge sources appear in the agent tool trace', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()

  await openAddSource(page)
  await page.getByLabel('Name').fill('Team Wiki')
  await page.getByLabel('New connection URL').fill('http://127.0.0.1:8766')
  await page.getByRole('button', { name: 'Create source' }).click()
  await page.getByRole('checkbox', { name: 'Team Wiki' }).click()

  await page.getByLabel('Question').fill('What is in this wiki?')
  await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

  const toolTrace = page.getByLabel('Tool call trace')
  await expandAgentTrace(page.getByLabel('Local Development Runtime run details'))
  await expect(toolTrace.locator('li > span', { hasText: 'Sample Packaging LLMWiki' })).toBeVisible()
  await expect(toolTrace.locator('li > span', { hasText: 'Team Wiki' })).toHaveCount(0)
})

async function expandAgentTrace(runDetails: Locator): Promise<void> {
  const isOpen = await runDetails.evaluate((node) => (node as HTMLDetailsElement).open)
  if (!isOpen) await runDetails.locator('summary').click()
}

async function isolateColdStartNoLocalServices(page: Page): Promise<void> {
  await Promise.all([
    page.unroute('http://127.0.0.1:8765/manifest'),
    page.unroute('http://127.0.0.1:8765/graph?limit=500'),
    page.unroute('http://127.0.0.1:8765/query'),
    page.unroute('http://127.0.0.1:8765/read/**'),
  ])
  await routeLocalServiceUnavailable(page, 'http://127.0.0.1:8765/**')
  await routeLocalServiceUnavailable(page, 'http://localhost:8765/**')
  await routeLocalServiceUnavailable(page, 'http://127.0.0.1:8788/**')
  await routeLocalServiceUnavailable(page, 'http://localhost:8788/**')
  await page.addInitScript((storageKeys) => {
    for (const key of storageKeys as string[]) {
      window.localStorage.removeItem(key)
    }
  }, coldStartStorageKeys)
}

async function routeLocalServiceUnavailable(page: Page, urlPattern: string): Promise<void> {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
  await page.route(urlPattern, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    await route.fulfill({
      status: 404,
      headers: corsHeaders,
      body: 'local service unavailable for cold-start validation',
    })
  })
}

async function clearColdStartStorage(page: Page): Promise<void> {
  await page.evaluate((storageKeys) => {
    for (const key of storageKeys as string[]) {
      window.localStorage.removeItem(key)
    }
  }, coldStartStorageKeys)
}

async function addRuntime(page: Page, runtimeName: string): Promise<Locator> {
  await openAgentBridgeSection(page)
  const addRuntimePanel = page.locator('.add-runtime-disclosure')
  if (!(await addRuntimePanel.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await addRuntimePanel.locator('summary').click()
  }
  await page.getByLabel('Runtime type').selectOption({ label: runtimeName })
  await page.getByRole('button', { name: 'Add runtime' }).click()
  const runtimeCard = page.getByRole('article').filter({ has: page.getByRole('radio', { name: new RegExp(runtimeName) }) })
  await expect(runtimeCard).toBeVisible()
  return runtimeCard
}

async function openSourceRuntimeDetails(page: Page): Promise<void> {
  const details = page.locator('.connection-status-details')
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').click()
  }
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

async function openRuntimeSetup(runtimeCard: Locator): Promise<void> {
  const agentSection = runtimeCard.locator('xpath=ancestor::section[contains(@class, "agent-runtime-section")]')
  await openSidebarSection(agentSection)
  const setupToggle = runtimeCard.locator('.runtime-card-toggle').first()
  if ((await setupToggle.getAttribute('aria-expanded')) !== 'true') {
    await setupToggle.click()
  }
  await expect(setupToggle).toHaveAttribute('aria-expanded', 'true')
}

async function selectRuntimeCard(runtimeCard: Locator): Promise<void> {
  const radio = runtimeCard.getByRole('radio')
  if (await radio.isChecked()) return

  const agentSection = runtimeCard.locator('xpath=ancestor::section[contains(@class, "agent-runtime-section")]')
  await openSidebarSection(agentSection)
  await runtimeCard.locator('.runtime-card-choice').click()
  await expect(radio).toBeChecked()
}

async function openAgentBridgeSection(page: Page): Promise<void> {
  await openSidebarSection(page.getByRole('region', { name: 'Agent runtime' }))
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

async function expectNoAxeViolations(page: Page, label: string, selector: string): Promise<void> {
  const results = await new AxeBuilder({ page }).include(selector).analyze()
  expect(
    results.violations,
    [
      `${label} axe violations:`,
      ...results.violations.map((violation) => {
        const nodes = violation.nodes.map((node) => node.target.join(' ')).join(', ')
        return `${violation.id}: ${violation.help} (${nodes})`
      }),
    ].join('\n'),
  ).toEqual([])
}

async function expectQuickstartPanelNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.locator('.quickstart-panel').evaluate((panel) => {
    const panelBox = panel.getBoundingClientRect()
    const checkedElements = Array.from(panel.querySelectorAll(
      '.quickstart-command-details, .quickstart-grid, .quickstart-grid > div, .quickstart-command',
    ))

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelLeft: panelBox.left,
      panelRight: panelBox.right,
      overflowingElements: checkedElements
        .map((element) => {
          const box = element.getBoundingClientRect()
          return {
            tag: element.tagName.toLowerCase(),
            className: element.className,
            text: element.textContent?.trim().slice(0, 80) || element.tagName.toLowerCase(),
            left: box.left,
            right: box.right,
            panelLeft: panelBox.left,
            panelRight: panelBox.right,
          }
        })
        .filter((box) => box.left < panelBox.left - 1 || box.right > panelBox.right + 1),
    }
  })

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1)
  expect(metrics.panelLeft).toBeGreaterThanOrEqual(-1)
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.documentClientWidth + 1)
  expect(metrics.overflowingElements).toEqual([])
}

async function expectAppShellNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const checkedElements = Array.from(document.querySelectorAll(
      '.app-shell, .chat-panel, .inspector, .sidebar, .knowledge-map-summary, .local-io-log-controls, .local-io-log-panel, .add-runtime-body',
    ))

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overflowingElements: checkedElements
        .map((element) => {
          const box = element.getBoundingClientRect()
          return {
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            text: element.textContent?.trim().slice(0, 80) || element.tagName.toLowerCase(),
            left: box.left,
            right: box.right,
          }
        })
        .filter((box) => box.left < -1 || box.right > document.documentElement.clientWidth + 1),
    }
  })

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1)
  expect(metrics.overflowingElements).toEqual([])
}

async function expectQuickstartStatusInsidePanel(page: Page): Promise<void> {
  const outsideElements = await page.locator('.quickstart-panel').evaluate((panel) => {
    const panelBox = panel.getBoundingClientRect()
    return Array.from(panel.querySelectorAll('.quickstart-status dt, .quickstart-status dd, .quickstart-status dd > span'))
      .map((element) => {
        const box = element.getBoundingClientRect()
        return {
          text: element.textContent?.trim() || element.tagName.toLowerCase(),
          left: box.left,
          right: box.right,
          panelLeft: panelBox.left,
          panelRight: panelBox.right,
        }
      })
      .filter((box) => box.left < panelBox.left - 1 || box.right > panelBox.right + 1)
  })

  expect(outsideElements).toEqual([])
}

async function expectDetailsInsideInspectorViewport(page: Page): Promise<void> {
  const placement = await page.locator('#details-panel').evaluate((details) => {
    const inspector = details.closest('.inspector')
    if (!inspector) return null
    const detailsBox = details.getBoundingClientRect()
    const inspectorBox = inspector.getBoundingClientRect()
    return {
      detailsTop: detailsBox.top,
      detailsBottom: detailsBox.bottom,
      inspectorTop: inspectorBox.top,
      inspectorBottom: inspectorBox.bottom,
    }
  })

  expect(placement).not.toBeNull()
  expect(placement?.detailsTop ?? -999).toBeGreaterThanOrEqual((placement?.inspectorTop ?? 0) - 1)
  expect(placement?.detailsTop ?? 999).toBeLessThan(placement?.inspectorBottom ?? 0)
  expect(placement?.detailsBottom ?? 0).toBeGreaterThan(placement?.inspectorTop ?? 0)
}

function samplePackagingQueryPayload() {
  return {
    wiki_title: 'Sample Packaging LLMWiki',
    orientation: [
      {
        title: 'Current Focus',
        role: 'hot',
        snippet: 'Required label copy and release readiness.',
      },
      {
        title: 'Sample Packaging LLMWiki',
        role: 'index',
        snippet: 'Packaging artwork review and requester returns.',
      },
    ],
    evidence: [
      {
        page_id: 'hot',
        title: 'Current Focus',
        path: 'hot.md',
        snippet: 'Required label copy and release readiness are current focus items.',
        source_refs: ['SRC-HOT'],
      },
      {
        page_id: 'artwork-review',
        title: 'Artwork Review Process',
        path: 'artwork-review.md',
        snippet: 'Artwork review checks required copy, barcode placement, and approval state.',
        source_refs: ['SRC-ART-001'],
      },
    ],
    graph: {
      nodes: [
        { id: 'page:hot', label: 'Current Focus', kind: 'hot' },
        { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic' },
        { id: 'heading:hot-current-focus', label: 'Current Focus', kind: 'heading', path: 'hot.md' },
        { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
      ],
      edges: [
        { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
        { source: 'page:hot', target: 'heading:hot-current-focus', relation: 'contains' },
        { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
      ],
    },
  }
}
