import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'

declare const process: {
  env: {
    LLMWIKI_BRIDGE_MULTITURN_BRIDGE_URL?: string
    LLMWIKI_BRIDGE_MULTITURN_SOURCE_URL?: string
    LLMWIKI_BRIDGE_MULTITURN_RUNTIME_DEBUG_URL?: string
    LLMWIKI_BRIDGE_MULTITURN_SOURCE_DEBUG_URL?: string
  }
}

const bridgeUrl = normalizeUrl(process.env.LLMWIKI_BRIDGE_MULTITURN_BRIDGE_URL)
const sourceUrl = normalizeUrl(process.env.LLMWIKI_BRIDGE_MULTITURN_SOURCE_URL)
const runtimeDebugUrl = normalizeUrl(process.env.LLMWIKI_BRIDGE_MULTITURN_RUNTIME_DEBUG_URL)
const sourceDebugUrl = normalizeUrl(process.env.LLMWIKI_BRIDGE_MULTITURN_SOURCE_DEBUG_URL)
const localIoLogStorageKey = 'llmwiki-chat:local-io-log:v1'

interface DebugRequest {
  sequence?: number
  method?: string
  path?: string
  search?: string
  body?: unknown
  bodyText?: string
}

interface LocalIoLogEntry {
  prompt?: string
  turnId?: string
  threadId?: string
  sessionId?: string
  request?: {
    transport?: string
    summary?: Record<string, unknown>
    body?: unknown
  }
  response?: {
    answer?: string
  }
}

test.describe('browser to bridge multi-turn runtime context', () => {
  if (!bridgeUrl || !sourceUrl || !runtimeDebugUrl) {
    test.skip('requires bridge, source, and test runtime debug URLs; run `npm run test:e2e:bridge-multiturn`.', async () => {
      // The package script provisions the local services and passes these URLs.
    })
    return
  }

  test('preserves thread context and prior history across three real bridge turns', async ({ page, request }, testInfo) => {
    const runLabel = runLabelFor(testInfo)
    const questions = [
      `${runLabel} turn one: what needs review?`,
      `${runLabel} turn two: what changed from that answer?`,
      `${runLabel} turn three: summarize the remaining action.`,
    ]
    const answers = questions.map((question) => `Bridge multi-turn answer for: ${question} [1](#citation-1)`)

    await configureSourceAndBridge(page)

    for (let index = 0; index < questions.length; index += 1) {
      await page.getByLabel('Question').fill(questions[index])
      await page.getByRole('button', { name: /^Ask / }).click()

      const latestAssistant = page.locator('.message.assistant').last()
      await expect(latestAssistant).toContainText(`Bridge multi-turn answer for: ${questions[index]}`)
      await expect(latestAssistant.getByLabel('Custom A2A run details')).toBeVisible()
    }

    await expect(page.locator('.message.assistant')).toHaveCount(3)

    const localIoEntries = await localIoLogEntriesForQuestions(page, questions)
    expect(localIoEntries).toHaveLength(3)
    expectChatToBridgeConversationMetadata(localIoEntries, questions)

    const runtimeRequests = await runtimeRequestsForQuestions(request, questions)
    expect(runtimeRequests).toHaveLength(3)
    expectBridgeRuntimeConversation(runtimeRequests, questions, answers, localIoEntries)

    if (sourceDebugUrl) {
      const sourceRequests = await sourceRequestsForQuestions(request, questions)
      expectSourceRequestsExcludeAssistantHistory(sourceRequests, questions)
    }
  })
})

async function configureSourceAndBridge(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const defaultSourceCard = page.locator('.connection-card').first()
  await openSourceSetup(defaultSourceCard)
  await sourceUrlInput(defaultSourceCard).fill(sourceUrl)
  await defaultSourceCard.getByRole('button', { name: 'Test source' }).click()

  const readySourceCard = page.locator('.connection-card').filter({ hasText: 'Sample Packaging LLMWiki' }).first()
  await expect(readySourceCard.getByLabel('Connection status ready')).toBeVisible()
  await openSourceSetup(readySourceCard)
  await readySourceCard.getByRole('button', { name: 'Use only this source' }).click()

  const runtimeCard = await addRuntime(page, 'Custom A2A')
  await openRuntimeSetup(runtimeCard)
  await runtimeCard.getByLabel('Custom A2A runtime URL').fill(bridgeUrl)
  await runtimeCard.getByRole('button', { name: 'Test runtime' }).click()
  await expect(runtimeCard.getByLabel('Agent runtime status ready')).toBeVisible()
  await expect(runtimeCard).toContainText('OpenAI-compatible chat-completions')
  await selectRuntimeCard(runtimeCard)
}

async function localIoLogEntriesForQuestions(page: Page, questions: string[]): Promise<LocalIoLogEntry[]> {
  const entries = await page.evaluate(([storageKey]) => {
    const raw = window.localStorage.getItem(storageKey) || ''
    return raw.trim()
      ? raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
      : []
  }, [localIoLogStorageKey])
  const questionSet = new Set(questions)
  return entries
    .filter((entry): entry is LocalIoLogEntry => typeof entry === 'object' && entry !== null)
    .filter((entry) => questionSet.has(entry.prompt || ''))
    .sort((left, right) => questions.indexOf(left.prompt || '') - questions.indexOf(right.prompt || ''))
}

function expectChatToBridgeConversationMetadata(entries: LocalIoLogEntry[], questions: string[]): void {
  const dataPayloads = entries.map((entry) => requestDataPayload(entry))
  const threadIds = dataPayloads.map((data) => readString(data, 'threadId'))
  const sessionIds = dataPayloads.map((data) => readString(data, 'sessionId'))
  const turnIds = dataPayloads.map((data) => readString(data, 'turnId'))

  expect(new Set(threadIds).size).toBe(1)
  expect(new Set(sessionIds).size).toBe(1)
  expect(new Set(turnIds).size).toBe(3)

  for (let index = 0; index < dataPayloads.length; index += 1) {
    const data = dataPayloads[index]
    const message = asRecord(data.message)
    const llmwiki = asRecord(asRecord(message?.metadata)?.llmwiki)
    const messages = conversationMessages(data.messages)

    expect(entries[index].request?.transport).toBe('a2a-message:send')
    expect(data).toMatchObject({
      query: questions[index],
      threadId: threadIds[0],
      sessionId: sessionIds[0],
      turnId: turnIds[index],
    })
    expect(message).toMatchObject({
      kind: 'message',
      role: 'user',
      contextId: threadIds[0],
      parts: [{ kind: 'text', text: questions[index] }],
    })
    expect(llmwiki).toMatchObject({
      schemaVersion: 'llmwiki-chat.conversation.v1',
      threadId: threadIds[0],
      sessionId: sessionIds[0],
      turnId: turnIds[index],
    })
    expect(messages.at(-1)).toEqual({ role: 'user', content: questions[index] })
    expect(messages.slice(0, -1).some((messageItem) => messageItem.content === questions[index])).toBe(false)
  }

  expect(conversationMessages(dataPayloads[0].messages).map((message) => message.role)).toEqual(['user'])
  expect(conversationMessages(dataPayloads[1].messages).map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
  expect(conversationMessages(dataPayloads[2].messages).map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
  ])
}

async function runtimeRequestsForQuestions(
  request: APIRequestContext,
  questions: string[],
): Promise<DebugRequest[]> {
  const response = await request.get(runtimeDebugUrl)
  expect(response.ok(), 'runtime debug endpoint should return requests').toBe(true)
  const payload = await response.json() as { requests?: DebugRequest[] }
  const questionSet = new Set(questions)
  return (payload.requests || [])
    .filter((item) => questionSet.has(currentQuestionFromRuntimeBody(item.body)))
    .sort((left, right) => questions.indexOf(currentQuestionFromRuntimeBody(left.body)) - questions.indexOf(currentQuestionFromRuntimeBody(right.body)))
}

function expectBridgeRuntimeConversation(
  requests: DebugRequest[],
  questions: string[],
  answers: string[],
  localIoEntries: LocalIoLogEntry[],
): void {
  const expectedHistory = [
    [],
    [
      { role: 'user', content: questions[0] },
      { role: 'assistant', content: answers[0] },
    ],
    [
      { role: 'user', content: questions[0] },
      { role: 'assistant', content: answers[0] },
      { role: 'user', content: questions[1] },
      { role: 'assistant', content: answers[1] },
    ],
  ]
  const expectedThreadId = readString(requestDataPayload(localIoEntries[0]), 'threadId')
  const expectedSessionId = readString(requestDataPayload(localIoEntries[0]), 'sessionId')

  for (let index = 0; index < requests.length; index += 1) {
    const body = asRecord(requests[index].body)
    const messages = conversationMessages(body.messages)
    const currentPrompt = messages.at(-1)
    const priorMessages = messages.slice(1, -1)
    const evidenceBundle = evidenceBundleFromRuntimeBody(body)
    const conversationContext = asRecord(evidenceBundle.conversationContext)
    const expectedTurnId = readString(requestDataPayload(localIoEntries[index]), 'turnId')

    expect(readString(body, 'model')).toBe('bridge-multiturn-local-model')
    expect(messages[0].role).toBe('system')
    expect(currentPrompt?.role).toBe('user')
    expect(extractCurrentQuestion(currentPrompt?.content || '')).toBe(questions[index])
    expect(priorMessages).toEqual(expectedHistory[index])
    expect(priorMessages.length).toBeLessThanOrEqual(12)
    expect(priorMessages.some((message) => message.content === questions[index])).toBe(false)
    expect(countOccurrences(currentPrompt?.content || '', questions[index])).toBe(1)
    expect(conversationContext).toMatchObject({
      schema: 'llmwiki-agent-bridge.conversation-context.v1',
      threadId: expectedThreadId,
      sessionId: expectedSessionId,
      turnId: expectedTurnId,
      historyLength: expectedHistory[index].length,
      historyLimit: 12,
    })
    expect(asRecord(conversationContext?.descriptor)).toMatchObject({
      schemaVersion: 'llmwiki-chat.conversation.v1',
      threadId: expectedThreadId,
      sessionId: expectedSessionId,
      turnId: expectedTurnId,
      historyLength: expectedHistory[index].length,
      messagesIncluded: index === 0 ? 1 : index === 1 ? 3 : 5,
      latestRole: 'user',
    })
  }
}

async function sourceRequestsForQuestions(
  request: APIRequestContext,
  questions: string[],
): Promise<DebugRequest[]> {
  const response = await request.get(sourceDebugUrl)
  expect(response.ok(), 'source debug endpoint should return requests').toBe(true)
  const payload = await response.json() as { requests?: DebugRequest[] }
  const questionSet = new Set(questions)
  return (payload.requests || [])
    .filter((item) => item.path === '/query')
    .filter((item) => questionSet.has(readString(asRecord(item.body), 'query')))
    .sort((left, right) => questions.indexOf(readString(asRecord(left.body), 'query')) - questions.indexOf(readString(asRecord(right.body), 'query')))
}

function expectSourceRequestsExcludeAssistantHistory(requests: DebugRequest[], questions: string[]): void {
  expect(requests).toHaveLength(3)
  for (let index = 0; index < requests.length; index += 1) {
    const body = asRecord(requests[index].body)
    expect(body).toEqual({
      query: questions[index],
      limit: 8,
    })
    expect(body).not.toHaveProperty('message')
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('runtimeContext')
    expect(JSON.stringify(body)).not.toContain('Bridge multi-turn answer for:')
  }
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
  await openSidebarSection(page.getByRole('region', { name: 'Agent runtime' }))
}

async function openSidebarSection(section: Locator): Promise<void> {
  const toggle = section.locator('.sidebar-section-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

function sourceUrlInput(sourceCard: Locator): Locator {
  return sourceCard.locator('.source-setup-body input[aria-label$=" URL"]').first()
}

function requestDataPayload(entry: LocalIoLogEntry): Record<string, unknown> {
  const body = asRecord(entry.request?.body)
  const data = asRecord(body.data)
  if (!data) throw new Error(`Local I/O entry for "${entry.prompt || 'unknown prompt'}" did not include request.body.data.`)
  return data
}

function conversationMessages(value: unknown): Array<{ role: string; content: string }> {
  return readRecordArray(value)
    .map((item) => ({
      role: readString(item, 'role'),
      content: readString(item, 'content'),
    }))
    .filter((item) => item.role && item.content)
}

function currentQuestionFromRuntimeBody(value: unknown): string {
  const messages = conversationMessages(asRecord(value).messages)
  return extractCurrentQuestion(messages.at(-1)?.content || '')
}

function evidenceBundleFromRuntimeBody(value: Record<string, unknown>): Record<string, unknown> {
  const content = conversationMessages(value.messages).at(-1)?.content || ''
  const marker = '# LLMWiki evidence bundle'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) throw new Error('Runtime prompt did not include an LLMWiki evidence bundle.')
  const rawJson = content.slice(markerIndex + marker.length).trim()
  return JSON.parse(rawJson) as Record<string, unknown>
}

function extractCurrentQuestion(content: string): string {
  const marker = '# User question'
  const evidenceMarker = '# LLMWiki evidence bundle'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) return content.trim()
  const afterMarker = content.slice(markerIndex + marker.length)
  const evidenceIndex = afterMarker.indexOf(evidenceMarker)
  return (evidenceIndex >= 0 ? afterMarker.slice(0, evidenceIndex) : afterMarker).trim()
}

function runLabelFor(testInfo: TestInfo): string {
  const cleanProject = testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const suffix = Math.random().toString(36).slice(2, 8)
  return `bridge multiturn ${cleanProject} ${Date.now()} ${suffix}`
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0
  return value.split(needle).length - 1
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '')
}
