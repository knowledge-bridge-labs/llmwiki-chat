#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const chatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const playwrightArgs = process.argv.slice(2)
const uvCommand = process.env.UV || 'uv'
const playwrightCli = join(chatRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const childProcesses = []
const httpServers = []
let cleanupPromise = null
let activeRuntime = null
let activeSourceProxy = null

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.error(`[bridge-multiturn] Received ${signal}; stopping local services.`)
    await cleanupServices()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {
  const runtime = await startOpenAiCompatibleRuntime()
  activeRuntime = runtime
  const sourceTargetUrl = await resolveSourceTargetUrl()
  const sourceProxy = process.env.LLMWIKI_BRIDGE_MULTITURN_DISABLE_SOURCE_PROXY === '1'
    ? { url: sourceTargetUrl, debugUrl: '' }
    : await startRecordingSourceProxy(sourceTargetUrl)
  activeSourceProxy = sourceProxy
  const bridgeUrl = await startBridge(runtime.baseUrl)

  await runPlaywright({
    ...process.env,
    LLMWIKI_BRIDGE_MULTITURN_BRIDGE_URL: bridgeUrl,
    LLMWIKI_BRIDGE_MULTITURN_SOURCE_URL: sourceProxy.url,
    LLMWIKI_BRIDGE_MULTITURN_RUNTIME_DEBUG_URL: runtime.debugUrl,
    LLMWIKI_BRIDGE_MULTITURN_SOURCE_DEBUG_URL: sourceProxy.debugUrl,
  })
  process.exitCode = 0
} catch (error) {
  console.error(`[bridge-multiturn] ${formatError(error)}`)
  printDebugSummary()
  process.exitCode = 1
} finally {
  await cleanupServices()
}

async function startOpenAiCompatibleRuntime() {
  const requests = []
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/health') {
        writeJson(response, 200, { status: 'ok' })
        return
      }

      if (request.method === 'GET' && url.pathname === '/__debug/requests') {
        writeJson(response, 200, { requests })
        return
      }

      if (request.method === 'POST' && url.pathname === '/__debug/reset') {
        requests.length = 0
        writeJson(response, 200, { ok: true })
        return
      }

      if (request.method === 'POST' && (url.pathname === '/chat/completions' || url.pathname === '/v1/chat/completions')) {
        const body = parseJsonBuffer(await readRequestBody(request))
        const sequence = requests.length + 1
        requests.push({
          sequence,
          method: request.method,
          path: url.pathname,
          body,
        })

        const query = currentQuestionFromOpenAiBody(body) || `runtime request ${sequence}`
        writeJson(response, 200, {
          id: `chatcmpl-bridge-multiturn-${sequence}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: readString(body, 'model') || 'bridge-multiturn-local-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: `Bridge multi-turn answer for: ${query} [1](#citation-1)`,
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        })
        return
      }

      writeJson(response, 404, { error: 'not found' })
    } catch (error) {
      writeJson(response, 500, { error: formatError(error) })
    }
  })

  const url = await listen(server, 0, 'OpenAI-compatible runtime')
  httpServers.push(server)
  console.log(`[bridge-multiturn] Starting test-only OpenAI-compatible runtime at ${url}`)
  return {
    url,
    baseUrl: `${url}/v1`,
    debugUrl: `${url}/__debug/requests`,
    snapshot: () => ({ requests: requests.length }),
  }
}

async function resolveSourceTargetUrl() {
  const existing = normalizeUrl(process.env.LLMWIKI_BRIDGE_MULTITURN_SOURCE_URL)
    || normalizeUrl((process.env.LLMWIKI_SAMPLE_MATRIX_URLS || '').split(',')[0])
    || normalizeUrl(process.env.LLMWIKI_LIVE_SERVE_URL)
  if (existing) {
    console.log(`[bridge-multiturn] Using existing source target ${existing}`)
    await waitForSource(existing, 'existing source target')
    return existing
  }

  return startServeSampleSource()
}

async function startServeSampleSource() {
  const serveRoot = findServeRoot()
  if (!serveRoot) {
    throw new Error(
      [
        'No llmwiki-serve checkout was found.',
        'Set LLMWIKI_SERVE_ROOT, place llmwiki-serve next to this repo,',
        'or set LLMWIKI_BRIDGE_MULTITURN_SOURCE_URL to an already running source URL.',
      ].join(' '),
    )
  }

  const sampleRoot = resolveSampleRoot(serveRoot)
  if (!existsSync(sampleRoot)) {
    throw new Error(`llmwiki-serve sample wiki was not found: ${sampleRoot}`)
  }

  const serveExecutable = resolveServeExecutable(serveRoot)
  const forceSync = process.env.LLMWIKI_BRIDGE_MULTITURN_FORCE_SYNC === '1'
  const skipSync = shouldSkipServeSync()
  if (forceSync && !skipSync) {
    const syncArgs = ['sync', '--extra', 'dev']
    if (existsSync(join(serveRoot, 'uv.lock'))) syncArgs.push('--locked')
    console.log(`[bridge-multiturn] Syncing llmwiki-serve dependencies in ${serveRoot}`)
    await runCommand(uvCommand, syncArgs, { cwd: serveRoot })
  } else if (serveExecutable && !forceSync) {
    console.log(`[bridge-multiturn] Reusing existing llmwiki-serve executable at ${serveExecutable}`)
  } else {
    console.log('[bridge-multiturn] No llmwiki-serve executable found; starting with uv run --no-sync. Set LLMWIKI_BRIDGE_MULTITURN_FORCE_SYNC=1 to opt into dependency sync.')
  }

  const port = parsePort(process.env.LLMWIKI_BRIDGE_MULTITURN_SOURCE_PORT, 'LLMWIKI_BRIDGE_MULTITURN_SOURCE_PORT')
    || await findOpenPort()
  const url = `http://127.0.0.1:${port}`
  console.log(`[bridge-multiturn] Starting llmwiki-serve sample source at ${url}`)
  const child = startServeProcess(serveRoot, sampleRoot, port)
  childProcesses.push(child)
  await waitForHealth(`${url}/health`, child, 'llmwiki-serve')
  return url
}

async function startRecordingSourceProxy(targetUrl) {
  const requests = []
  const errors = []
  const targetBase = normalizeUrl(targetUrl)
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders())
        response.end()
        return
      }

      if (request.method === 'GET' && url.pathname === '/__debug/requests') {
        writeJson(response, 200, { targetUrl: targetBase, requests }, corsHeaders())
        return
      }

      if (request.method === 'POST' && url.pathname === '/__debug/reset') {
        requests.length = 0
        writeJson(response, 200, { ok: true }, corsHeaders())
        return
      }

      const bodyBuffer = await readRequestBody(request)
      const bodyText = bodyBuffer.toString('utf8')
      requests.push({
        sequence: requests.length + 1,
        method: request.method || 'GET',
        path: url.pathname,
        search: url.search,
        body: parseJsonText(bodyText),
        bodyText,
      })

      const upstreamUrl = `${targetBase}${url.pathname}${url.search}`
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: forwardedHeaders(request.headers),
        body: bodyBuffer.length ? bodyBuffer : undefined,
        redirect: 'manual',
      })
      const upstreamBody = Buffer.from(await upstreamResponse.arrayBuffer())
      response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers))
      response.end(upstreamBody)
    } catch (error) {
      errors.push({
        sequence: errors.length + 1,
        message: formatError(error),
      })
      writeJson(response, 502, { error: formatError(error) }, corsHeaders())
    }
  })

  const url = await listen(server, 0, 'source proxy')
  httpServers.push(server)
  console.log(`[bridge-multiturn] Starting recording source proxy at ${url} -> ${targetBase}`)
  await waitForSource(url, 'recording source proxy')
  return {
    url,
    debugUrl: `${url}/__debug/requests`,
    snapshot: () => ({
      requestCount: requests.length,
      requests: requests.slice(-10),
      errors: errors.slice(-10),
    }),
  }
}

async function startBridge(runtimeBaseUrl) {
  const bridgeRoot = findBridgeRoot()
  if (!bridgeRoot) {
    throw new Error(
      [
        'No llmwiki-agent-bridge checkout was found.',
        'Set LLMWIKI_AGENT_BRIDGE_ROOT or place llmwiki-agent-bridge next to this repo.',
      ].join(' '),
    )
  }

  const bridgeEntry = join(bridgeRoot, 'bin', 'llmwiki-agent-bridge.mjs')
  if (!existsSync(bridgeEntry)) {
    throw new Error(`Bridge entrypoint not found: ${bridgeEntry}`)
  }
  if (!existsSync(join(bridgeRoot, 'node_modules'))) {
    throw new Error(`Bridge dependencies are not installed in ${bridgeRoot}. Run npm ci there before this e2e check.`)
  }

  const port = parsePort(process.env.LLMWIKI_BRIDGE_MULTITURN_BRIDGE_PORT, 'LLMWIKI_BRIDGE_MULTITURN_BRIDGE_PORT')
    || await findOpenPort()
  const url = `http://127.0.0.1:${port}`
  console.log(`[bridge-multiturn] Starting llmwiki-agent-bridge at ${url}`)
  const child = startChild(process.execPath, [bridgeEntry], {
    cwd: bridgeRoot,
    env: {
      ...process.env,
      LLMWIKI_AGENT_BRIDGE_HOST: '127.0.0.1',
      LLMWIKI_AGENT_BRIDGE_PORT: String(port),
      LLMWIKI_AGENT_BRIDGE_BASE_URL: runtimeBaseUrl,
      LLMWIKI_AGENT_BRIDGE_MODEL: process.env.LLMWIKI_BRIDGE_MULTITURN_MODEL || 'bridge-multiturn-local-model',
      LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE: 'generic',
      LLMWIKI_AGENT_BRIDGE_SOURCE_POLICY: 'private-http',
      LLMWIKI_AGENT_BRIDGE_ALLOWED_ORIGINS: bridgeChatOrigins().join(','),
    },
    verboseEnv: 'LLMWIKI_BRIDGE_MULTITURN_VERBOSE',
  })
  childProcesses.push(child)
  await waitForHealth(`${url}/health`, child, 'llmwiki-agent-bridge')
  return url
}

function runPlaywright(env) {
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright CLI was not found. Run `npm ci` before `npm run test:e2e:bridge-multiturn`.')
  }
  return runCommand(
    process.execPath,
    [playwrightCli, 'test', 'e2e/bridge-multiturn.spec.ts', ...playwrightArgs],
    { cwd: chatRoot, env },
  )
}

function findServeRoot() {
  const candidates = [
    process.env.LLMWIKI_SERVE_ROOT,
    process.env.LLMWIKI_LIVE_SERVE_ROOT,
    join(chatRoot, '..', 'llmwiki-serve'),
    join(chatRoot, '.tmp', 'llmwiki-serve'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const absolute = resolveFromChatRoot(candidate)
    if (isServeRoot(absolute)) return absolute
  }
  return null
}

function isServeRoot(candidate) {
  return existsSync(join(candidate, 'pyproject.toml'))
    && existsSync(join(candidate, 'src', 'llmwiki_serve'))
}

function resolveSampleRoot(serveRoot) {
  const configured = process.env.LLMWIKI_BRIDGE_MULTITURN_SAMPLE_ROOT || process.env.LLMWIKI_SERVE_SAMPLE_ROOT
  return configured ? resolveFromChatRoot(configured) : join(serveRoot, 'examples', 'sample-wiki')
}

function startServeProcess(serveRoot, sampleRoot, port) {
  const serveExecutable = resolveServeExecutable(serveRoot)
  const command = serveExecutable || uvCommand
  const args = serveExecutable
    ? serveArgs(sampleRoot, port)
    : [
        'run',
        ...(shouldSkipServeSync() || process.env.LLMWIKI_BRIDGE_MULTITURN_FORCE_SYNC !== '1' ? ['--no-sync'] : []),
        'llmwiki-serve',
        ...serveArgs(sampleRoot, port),
      ]
  return startChild(command, args, {
    cwd: serveRoot,
    verboseEnv: 'LLMWIKI_BRIDGE_MULTITURN_VERBOSE',
  })
}

function resolveServeExecutable(serveRoot) {
  const candidates = process.platform === 'win32'
    ? [
        join(serveRoot, '.venv', 'Scripts', 'llmwiki-serve.exe'),
        join(serveRoot, '.venv', 'Scripts', 'llmwiki-serve'),
      ]
    : [
        join(serveRoot, '.venv', 'bin', 'llmwiki-serve'),
      ]

  return candidates.find((candidate) => existsSync(candidate)) || ''
}

function shouldSkipServeSync() {
  return process.env.LLMWIKI_BRIDGE_MULTITURN_SKIP_SYNC === '1'
    || process.env.LLMWIKI_SAMPLE_MATRIX_SKIP_SYNC === '1'
    || process.env.LLMWIKI_LIVE_SERVE_SKIP_SYNC === '1'
}

function serveArgs(sampleRoot, port) {
  return [
    'serve',
    sampleRoot,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    ...bridgeChatOrigins().flatMap((origin) => ['--cors-origin', origin]),
  ]
}

function findBridgeRoot() {
  const candidates = [
    process.env.LLMWIKI_AGENT_BRIDGE_ROOT,
    join(chatRoot, '..', 'llmwiki-agent-bridge'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const absolute = resolveFromChatRoot(candidate)
    if (existsSync(join(absolute, 'package.json')) && existsSync(join(absolute, 'src', 'index.mjs'))) return absolute
  }
  return null
}

function startChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || chatRoot,
    detached: process.platform !== 'win32',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.output = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    child.output.stdout = rememberOutput(child.output.stdout, chunk)
    if (process.env[options.verboseEnv] === '1') process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    child.output.stderr = rememberOutput(child.output.stderr, chunk)
    if (process.env[options.verboseEnv] === '1') process.stderr.write(chunk)
  })
  return child
}

async function waitForSource(url, label) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const path of ['/health', '/manifest']) {
      try {
        const response = await fetchWithTimeout(`${url}${path}`, 750)
        if (response.ok) {
          console.log(`[bridge-multiturn] ${label} is reachable at ${url}`)
          return
        }
      } catch {
        // Retry until a health or manifest endpoint responds.
      }
    }
    await delay(250)
  }
  throw new Error(`${label} did not become reachable within 30s.`)
}

async function waitForHealth(url, child, label) {
  let exitMessage = ''
  child.once('exit', (code, signal) => {
    exitMessage = `${label} exited before ready: code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'}.`
  })
  child.once('error', (error) => {
    exitMessage = `${label} failed to start: ${error.message}.`
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exitMessage) throw new Error(`${exitMessage}${formatProcessOutput(child)}`)
    try {
      const response = await fetchWithTimeout(url, 750)
      if (response.ok) {
        console.log(`[bridge-multiturn] ${label} is healthy at ${url}`)
        return
      }
    } catch {
      // Retry until healthy or timed out.
    }
    await delay(250)
  }
  throw new Error(`${label} did not become healthy within 30s.${formatProcessOutput(child)}`)
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

async function findOpenPort(excludedPorts = new Set()) {
  const server = createNetServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  if (!port) throw new Error('Could not allocate a local port.')
  if (excludedPorts.has(port)) return findOpenPort(excludedPorts)
  return port
}

function listen(server, port, label) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      const resolvedPort = typeof address === 'object' && address ? address.port : 0
      if (!resolvedPort) {
        rejectListen(new Error(`Could not determine ${label} port.`))
        return
      }
      resolveListen(`http://127.0.0.1:${resolvedPort}`)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
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

function cleanupServices() {
  if (!cleanupPromise) {
    cleanupPromise = Promise.all([
      ...childProcesses.map(stopProcessTree),
      ...httpServers.map(closeServer),
    ])
  }
  return cleanupPromise
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose())
  })
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

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function parseJsonBuffer(buffer) {
  return parseJsonText(buffer.toString('utf8'))
}

function parseJsonText(text) {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function writeJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
}

function forwardedHeaders(headers) {
  const skipped = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ])
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => !skipped.has(key.toLowerCase()) && value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
  )
}

function responseHeaders(headers) {
  return {
    'Content-Type': headers.get('content-type') || 'application/json',
    ...corsHeaders(),
  }
}

function currentQuestionFromOpenAiBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((message) => message?.role === 'user' && typeof message.content === 'string')
  if (!lastUser) return ''
  return extractCurrentQuestion(lastUser.content)
}

function extractCurrentQuestion(content) {
  const marker = '# User question'
  const evidenceMarker = '# LLMWiki evidence bundle'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) return content.trim()
  const afterMarker = content.slice(markerIndex + marker.length)
  const evidenceIndex = afterMarker.indexOf(evidenceMarker)
  return (evidenceIndex >= 0 ? afterMarker.slice(0, evidenceIndex) : afterMarker).trim()
}

function bridgeChatOrigins() {
  const configured = normalizeUrlList((process.env.LLMWIKI_BRIDGE_MULTITURN_CHAT_ORIGINS || '').split(','))
  return configured.length ? configured : ['http://127.0.0.1:4173', 'http://localhost:4173']
}

function resolveFromChatRoot(value) {
  return isAbsolute(value) ? resolve(value) : resolve(chatRoot, value)
}

function parsePort(value, envName) {
  if (!value) return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${envName} must be a TCP port from 1 to 65535, got "${value}".`)
  }
  return parsed
}

function normalizeUrl(value) {
  return (value || '').trim().replace(/\/+$/, '')
}

function normalizeUrlList(values) {
  return [...new Set(values.map(normalizeUrl).filter(Boolean))]
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

function readString(record, key) {
  const value = record?.[key]
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function printDebugSummary() {
  if (activeRuntime?.snapshot) {
    console.error(`[bridge-multiturn] Runtime debug summary: ${JSON.stringify(activeRuntime.snapshot())}`)
  }
  if (activeSourceProxy?.snapshot) {
    console.error(`[bridge-multiturn] Source proxy debug summary: ${JSON.stringify(activeSourceProxy.snapshot())}`)
  }
}
