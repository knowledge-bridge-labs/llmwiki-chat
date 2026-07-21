#!/usr/bin/env node

import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const chatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screenshotSize = { width: 1440, height: 965 }
const sampleSourceUrl = 'http://127.0.0.1:8765'
const knowledgeSourceStorageKey = 'llmwiki-chat:knowledge-source-connections:v1'
const agentRuntimeStorageKey = 'llmwiki-chat:agent-runtime-connections:v1'
const localIoLogStorageKey = 'llmwiki-chat:local-io-log:v1'
const localIoLoggingPreferenceStorageKey = 'llmwiki-chat:local-io-logging-enabled:v1'

const assets = [
  {
    id: 'workbench',
    label: 'source-first default workbench',
    relativePath: 'docs/assets/llmwiki-chat-workbench.png',
  },
  {
    id: 'quickstart',
    label: 'Quickstart-open workbench',
    relativePath: 'docs/assets/llmwiki-chat-quickstart.png',
  },
]

const usage = [
  'Usage: node scripts/capture-docs-screenshots.mjs [--check]',
  '',
  'Regenerates deterministic docs screenshots by running the local Vite app',
  'against sanitized Playwright-routed sample Knowledge Source responses.',
  '',
  'Options:',
  '  --check   Capture to a temporary directory and fail if committed PNGs differ.',
].join('\n')

const rawArgs = process.argv.slice(2)
const checkMode = rawArgs.includes('--check')
const unknownArgs = rawArgs.filter((arg) => arg !== '--check')
if (unknownArgs.length) {
  console.error(`Unknown argument${unknownArgs.length === 1 ? '' : 's'}: ${unknownArgs.join(', ')}\n\n${usage}`)
  process.exit(2)
}

const viteCli = join(chatRoot, 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(viteCli)) {
  console.error('[docs-screenshots] Vite CLI was not found. Run `npm ci` before capturing docs screenshots.')
  process.exit(1)
}

try {
  const result = await captureDocsScreenshots({ checkMode })
  for (const item of result.assets) {
    const status = item.changed ? (checkMode ? 'would update' : 'updated') : 'unchanged'
    console.log(`[docs-screenshots] ${status}: ${item.relativePath} (${item.size.width}x${item.size.height})`)
  }
  if (checkMode && result.assets.some((item) => item.changed)) {
    console.error('[docs-screenshots] Screenshot assets are out of date. Run `npm run docs:capture-screenshots` and review the PNG diff.')
    process.exitCode = 1
  }
} catch (error) {
  console.error(`[docs-screenshots] ${formatError(error)}`)
  process.exitCode = 1
}

async function captureDocsScreenshots({ checkMode }) {
  const outputRoot = checkMode
    ? mkdtempSync(join(tmpdir(), 'llmwiki-chat-docs-screenshots-'))
    : chatRoot
  const previousHashes = new Map(assets.map((asset) => {
    const assetPath = join(chatRoot, asset.relativePath)
    return [asset.relativePath, existsSync(assetPath) ? sha256(assetPath) : '']
  }))
  const port = await resolveVitePort()
  const vite = startVite(port)
  let browser

  try {
    await waitForServer(`http://127.0.0.1:${port}`, vite)
    browser = await chromium.launch()
    const context = await browser.newContext({
      colorScheme: 'light',
      deviceScaleFactor: 1,
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      viewport: screenshotSize,
    })
    const page = await context.newPage()
    await installDeterministicLocalState(page)
    await installDeterministicStyle(page)
    await routeSamplePackagingWiki(page, sampleSourceUrl)
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
    await waitForWorkbenchReady(page)

    const capturedAssets = []
    for (const asset of assets) {
      if (asset.id === 'quickstart') await openQuickstart(page)
      const targetPath = join(outputRoot, asset.relativePath)
      mkdirSync(dirname(targetPath), { recursive: true })
      await page.screenshot({
        animations: 'disabled',
        fullPage: false,
        path: targetPath,
      })
      const size = readPngSize(targetPath)
      if (size.width !== screenshotSize.width || size.height !== screenshotSize.height) {
        throw new Error(`${asset.relativePath} was ${size.width}x${size.height}; expected ${screenshotSize.width}x${screenshotSize.height}.`)
      }
      const capturedHash = sha256(targetPath)
      capturedAssets.push({
        ...asset,
        targetPath,
        size,
        changed: previousHashes.get(asset.relativePath) !== capturedHash,
      })
    }

    return { assets: capturedAssets }
  } finally {
    if (browser) await browser.close().catch(() => {})
    await stopProcessTree(vite)
    if (checkMode) rmSync(outputRoot, { force: true, recursive: true })
  }
}

async function installDeterministicLocalState(page) {
  await page.addInitScript((keys) => {
    window.localStorage.removeItem(keys.knowledgeSourceStorageKey)
    window.localStorage.removeItem(keys.localIoLogStorageKey)
    window.localStorage.setItem(keys.localIoLoggingPreferenceStorageKey, 'true')
    window.localStorage.setItem(keys.agentRuntimeStorageKey, JSON.stringify({
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
  }, {
    agentRuntimeStorageKey,
    knowledgeSourceStorageKey,
    localIoLoggingPreferenceStorageKey,
    localIoLogStorageKey,
  })
}

async function installDeterministicStyle(page) {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.setAttribute('data-llmwiki-docs-screenshot', 'true')
      style.textContent = [
        '* {',
        '  caret-color: transparent !important;',
        '  transition-duration: 0s !important;',
        '  animation-duration: 0s !important;',
        '  animation-delay: 0s !important;',
        '}',
      ].join('\n')
      document.head.append(style)
    }, { once: true })
  })
}

async function waitForWorkbenchReady(page) {
  await expect(page.getByRole('heading', { name: 'Ask Sample Packaging LLMWiki' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Active knowledge source summary' })).toContainText('1 selected · 1 ready available')
  await expect(page.getByRole('button', { name: 'Inspect map, pages, and details' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Quickstart' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Local I\/O logging/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Copy JSONL' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Clear local I/O log' })).toBeHidden()
}

async function openQuickstart(page) {
  const quickstartToggle = page.getByRole('button', { name: 'Show Quickstart' })
  await expect(quickstartToggle).toHaveAttribute('aria-expanded', 'false')
  await quickstartToggle.click()
  const quickstart = page.getByRole('region', { name: 'Quickstart' })
  await expect(quickstart).toBeVisible()
  await expect(quickstart.getByRole('region', { name: 'Step 1 source setup' })).toContainText('Get a Knowledge Source working')
  await expect(quickstart.getByRole('region', { name: 'Step 2 runtime choice' })).toBeVisible()
}

async function routeSamplePackagingWiki(page, baseUrl) {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '')
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }

  await page.route(`${cleanBaseUrl}/manifest`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
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

  await page.route(`${cleanBaseUrl}/graph?limit=500`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    await route.fulfill({
      headers: corsHeaders,
      json: sampleGraph(),
    })
  })

  await page.route(`${cleanBaseUrl}/query`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    await route.fulfill({
      headers: corsHeaders,
      json: {
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
        graph: sampleGraph(),
      },
    })
  })

  await page.route(`${cleanBaseUrl}/read/**`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    const pageId = decodeURIComponent(route.request().url().slice(`${cleanBaseUrl}/read/`.length))
    const pageBody = sampleReadPages[pageId] || sampleReadPages[pageId.replace(/\.md$/, '')]
    if (!pageBody) {
      await route.fulfill({
        status: 404,
        headers: corsHeaders,
        json: { found: false, reason: 'not found' },
      })
      return
    }
    await route.fulfill({
      headers: corsHeaders,
      json: pageBody,
    })
  })
}

async function fulfillCorsOptions(route, headers) {
  if (route.request().method() !== 'OPTIONS') return false
  await route.fulfill({ status: 204, headers })
  return true
}

function sampleGraph() {
  return {
    nodes: [
      { id: 'page:hot', label: 'Current Focus', kind: 'hot', path: 'hot.md' },
      { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic', path: 'artwork-review.md' },
      { id: 'heading:hot-current-focus', label: 'Current Focus', kind: 'heading', path: 'hot.md' },
      { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
    ],
    edges: [
      { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
      { source: 'page:hot', target: 'heading:hot-current-focus', relation: 'contains' },
      { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
    ],
  }
}

const sampleReadPages = {
  'hot.md': {
    id: 'hot',
    title: 'Current Focus',
    path: 'hot.md',
    source_refs: ['SRC-HOT'],
    text: [
      '# Current Focus',
      '',
      'Required label copy and release readiness are current focus items.',
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| State | Ready |',
    ].join('\n'),
  },
  hot: {
    id: 'hot',
    title: 'Current Focus',
    path: 'hot.md',
    source_refs: ['SRC-HOT'],
    text: '# Current Focus\n\nRequired label copy and release readiness are current focus items.',
  },
  'artwork-review.md': {
    id: 'artwork-review',
    title: 'Artwork Review Process',
    path: 'artwork-review.md',
    source_refs: ['SRC-ART-001'],
    text: '# Artwork Review Process\n\nArtwork review checks required copy, barcode placement, and approval state.',
  },
  'artwork-review': {
    id: 'artwork-review',
    title: 'Artwork Review Process',
    path: 'artwork-review.md',
    source_refs: ['SRC-ART-001'],
    text: '# Artwork Review Process\n\nArtwork review checks required copy, barcode placement, and approval state.',
  },
}

async function resolveVitePort() {
  const configured = parsePort(process.env.LLMWIKI_DOCS_SCREENSHOT_PORT, 'LLMWIKI_DOCS_SCREENSHOT_PORT')
  if (configured) return configured
  for (const port of [4173, 5173]) {
    if (await canListen(port)) return port
  }
  return findOpenPort()
}

function startVite(port) {
  const child = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: chatRoot,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        BROWSER: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.output = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    child.output.stdout = rememberOutput(child.output.stdout, chunk)
    if (process.env.LLMWIKI_DOCS_SCREENSHOT_VERBOSE === '1') process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    child.output.stderr = rememberOutput(child.output.stderr, chunk)
    if (process.env.LLMWIKI_DOCS_SCREENSHOT_VERBOSE === '1') process.stderr.write(chunk)
  })
  return child
}

async function waitForServer(url, child) {
  let exitMessage = ''
  child.once('exit', (code, signal) => {
    exitMessage = `Vite exited before ready: ${formatExit(code, signal)}.`
  })
  child.once('error', (error) => {
    exitMessage = `Vite failed to start: ${error.message}.`
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exitMessage) throw new Error(`${exitMessage}${formatProcessOutput(child)}`)
    try {
      const response = await fetchWithTimeout(url, 750)
      if (response.ok) return
    } catch {
      // Retry until Vite is ready or the startup deadline expires.
    }
    await delay(250)
  }
  throw new Error(`Vite dev server did not become ready within 30s at ${url}.${formatProcessOutput(child)}`)
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function readPngSize(filePath) {
  const stat = statSync(filePath)
  if (stat.size < 24) throw new Error(`${filePath} is too small to be a PNG.`)
  const buffer = readFileSync(filePath)
  if (
    buffer[0] !== 0x89
    || buffer[1] !== 0x50
    || buffer[2] !== 0x4e
    || buffer[3] !== 0x47
    || buffer[4] !== 0x0d
    || buffer[5] !== 0x0a
    || buffer[6] !== 0x1a
    || buffer[7] !== 0x0a
  ) {
    throw new Error(`${filePath} is not a PNG file.`)
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

async function canListen(port) {
  const server = await listenOnPort(port).catch(() => null)
  if (!server) return false
  await new Promise((resolveClose) => server.close(resolveClose))
  return true
}

async function findOpenPort() {
  const server = await listenOnPort(0)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  if (!port) throw new Error('Could not allocate a local port for Vite.')
  return port
}

function listenOnPort(port) {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer()
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen(server)
    })
  })
}

async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = new Promise((resolveExit) => {
    child.once('exit', resolveExit)
  })

  if (process.platform === 'win32' && child.pid) {
    try {
      await runCommand('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      child.kill('SIGTERM')
    }
  } else if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  } else {
    child.kill('SIGTERM')
  }

  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      if (process.platform === 'win32') {
        child.kill('SIGKILL')
        return
      }
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }),
  ])
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd || chatRoot,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
    })

    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand()
        return
      }
      rejectCommand(new Error(`${command} ${args.join(' ')} exited with ${formatExit(code, signal)}`))
    })
  })
}

function parsePort(value, envName) {
  if (!value) return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${envName} must be a TCP port from 1 to 65535, got "${value}".`)
  }
  return parsed
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function rememberOutput(previous, chunk) {
  return `${previous}${chunk}`.slice(-8_000)
}

function formatProcessOutput(child) {
  const stdout = child.output?.stdout?.trim()
  const stderr = child.output?.stderr?.trim()
  const parts = []
  if (stdout) parts.push(`stdout:\n${stdout}`)
  if (stderr) parts.push(`stderr:\n${stderr}`)
  return parts.length ? `\n${parts.join('\n')}` : ''
}

function formatExit(code, signal) {
  return `code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'}`
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
