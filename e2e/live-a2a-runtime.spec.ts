import { expect, test, type Locator, type Page } from '@playwright/test'
import { startA2aRuntimeProcess } from './support/a2aRuntimeProcess'
import { routeSamplePackagingWiki } from './support/samplePackagingWiki'

test('uses Custom A2A against a live local runtime process', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  const publicSourceUrl = 'https://wiki.e2e.example'
  const runtime = await startA2aRuntimeProcess()

  try {
    await routeSamplePackagingWiki(page, 'http://127.0.0.1:8765')
    await routeSamplePackagingWiki(page, publicSourceUrl)

    await page.goto('/')
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByText('Sample Packaging LLMWiki').first()).toBeVisible()

    const sourceCard = page.getByRole('article').filter({ hasText: 'Sample Packaging LLMWiki' })
    await openSourceSetup(sourceCard)
    await sourceCard.getByLabel('Sample Packaging LLMWiki URL').fill(publicSourceUrl)
    await page.keyboard.press('Tab')
    await expect(sourceCard.getByLabel('Connection status ready')).toBeVisible()

    const runtimeCard = await addRuntime(page, 'Custom A2A')
    await openRuntimeSetup(runtimeCard)
    await runtimeCard.getByLabel('Custom A2A runtime URL').fill(runtime.url)
    await page.keyboard.press('Tab')
    await expect(runtimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
    await expect(runtimeCard).toContainText('Test-only live A2A runtime process')
    await selectRuntimeCard(runtimeCard)

    await page.getByLabel('Question').fill('Use the live external runtime')
    await page.getByRole('button', { name: 'Ask Sample Packaging LLMWiki' }).click()

    const assistantMessage = page.locator('.message.assistant').last()
    await expect(assistantMessage).toContainText('Live A2A runtime used 1 selected LLMWiki source descriptor')
    await expect(assistantMessage).toContainText('descriptor-grounded evidence')
    await expect(assistantMessage.getByRole('button', { name: /\[1\] Sample Packaging LLMWiki Runtime Evidence/ })).toBeVisible()

    const trace = page.getByLabel('Custom A2A run details')
    await expect(trace).toBeVisible()
    await expect(trace.locator('.status-chip.ready')).toBeVisible()
    await expandAgentTrace(trace)
    await expect(trace.getByText('Discover Custom A2A')).toBeVisible()
    await expect(trace.getByText('Run Custom A2A')).toBeVisible()
    await expect(trace.getByText('Call Sample Packaging LLMWiki')).toBeVisible()
    await expect(trace.getByLabel('Tool call trace').locator('li > span', { hasText: 'Sample Packaging LLMWiki' })).toBeVisible()
    await expect(trace.getByLabel('Tool call trace').getByText(/llmwiki-http · done/)).toBeVisible()

    await assistantMessage.getByRole('button', { name: /\[1\] Sample Packaging LLMWiki Runtime Evidence/ }).click()
    const details = page.getByRole('region', { name: 'Details' })
    await expect(details.getByText('Citation reference details')).toBeVisible()
    await details.getByText('Citation reference details').click()
    await expect(details.getByText('E2E-RUNTIME-SRC')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Pages' }).getByRole('button', { name: /Sample Packaging LLMWiki Runtime Evidence topic/ })).toBeVisible()
    await expect(page.locator('body')).not.toHaveText('')

    const runtimeRequests = await runtime.requests()
    const runtimeBody = runtimeRequests.at(-1)?.body
    expect(runtimeBody?.data?.query).toBe('Use the live external runtime')
    expect(runtimeBody?.data?.knowledgeSources?.[0]).toMatchObject({
      id: 'local-demo',
      name: 'Sample Packaging LLMWiki',
      protocol: 'llmwiki-http',
      url: publicSourceUrl,
      adapter: 'llmwiki-markdown',
      implementation: 'atomicstrata/llm-wiki-compiler',
    })
    expect(runtimeBody?.data?.knowledgeSources?.[0]).not.toHaveProperty('graph')
    expect(runtimeBody?.data?.tools?.[0]).toMatchObject({
      name: 'llmwiki_context__local_demo',
      knowledgeSourceId: 'local-demo',
      protocol: 'llmwiki-http',
    })
    expect(pageErrors).toEqual([])
  } finally {
    await runtime.stop()
  }
})

async function expandAgentTrace(trace: Locator): Promise<void> {
  const isOpen = await trace.evaluate((node) => (node as HTMLDetailsElement).open)
  if (!isOpen) await trace.locator('summary').click()
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

async function openRuntimeSetup(runtimeCard: Locator): Promise<void> {
  const agentSection = runtimeCard.locator('xpath=ancestor::section[contains(@class, "agent-runtime-section")]')
  await openSidebarSection(agentSection)
  const setupToggle = runtimeCard.locator('.runtime-card-toggle').first()
  if ((await setupToggle.getAttribute('aria-expanded')) !== 'true') {
    await setupToggle.click()
  }
  await expect(setupToggle).toHaveAttribute('aria-expanded', 'true')
}

async function openSourceSetup(sourceCard: Locator): Promise<void> {
  const sourceSection = sourceCard.locator('xpath=ancestor::section[contains(@class, "source-section")]')
  await openSidebarSection(sourceSection)
  const setup = sourceCard.locator('.source-setup-disclosure').first()
  if (!(await setup.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await setup.locator('summary').click()
  }
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
  await openSidebarSection(page.getByRole('region', { name: 'Agent bridge' }))
}

async function openSidebarSection(section: Locator): Promise<void> {
  const toggle = section.locator('.sidebar-section-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}
