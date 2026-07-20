#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const chatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawArgs = process.argv.slice(2)
const includeBridge = rawArgs.includes('--bridge')
  || process.env.LLMWIKI_SAMPLE_MATRIX_WITH_BRIDGE === '1'
  || Boolean(process.env.LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL)
const playwrightArgs = rawArgs.filter((arg) => arg !== '--bridge')
const uvCommand = process.env.UV || 'uv'
const playwrightCli = join(chatRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const serveProcesses = []
const bridgeProcesses = []
let cleanupPromise = null

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.error(`[sample-matrix] Received ${signal}; stopping sample services.`)
    await cleanupChildren()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

const sampleCases = [
  {
    id: 'sample-wiki',
    name: 'Sample wiki',
    relativeRoot: join('examples', 'sample-wiki'),
    query: 'required copy release readiness',
    queryClass: 'local-query',
    fixtureClasses: ['local-single-source', 'sample-wiki'],
  },
  {
    id: 'obsidian-vault',
    name: 'Obsidian vault fixture',
    relativeRoot: join('tests', 'fixtures', 'obsidian-vault'),
    query: 'release checklist final approval product process',
    queryClass: 'global-query',
    fixtureClasses: ['obsidian-vault', 'frontmatter-links'],
  },
  {
    id: 'llmwiki-compiler-output',
    name: 'Compiler output fixture',
    relativeRoot: join('tests', 'fixtures', 'llmwiki-compiler-output'),
    query: 'release readiness packaging topic',
    queryClass: 'graph-query',
    fixtureClasses: ['llmwiki-compiler-output', 'graph-relation'],
  },
]

try {
  const existingSources = parseExistingSources()
  const sources = existingSources.length ? existingSources : await startServeMatrix()
  const bridgeUrl = includeBridge
    ? process.env.LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL || await startBridge({ required: true })
    : ''
  await runPlaywright({
    ...process.env,
    LLMWIKI_SAMPLE_MATRIX_SOURCES: JSON.stringify(sources),
    LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL: bridgeUrl || '',
  })
  process.exitCode = 0
} catch (error) {
  console.error(`[sample-matrix] ${formatError(error)}`)
  process.exitCode = 1
} finally {
  await cleanupChildren()
}

function parseExistingSources() {
  const urls = normalizeUrlList((process.env.LLMWIKI_SAMPLE_MATRIX_URLS || '').split(','))
  if (!urls.length) return []
  return urls.map((url, index) => ({
    ...sampleCases[index],
    id: sampleCases[index]?.id || `source-${index + 1}`,
    name: sampleCases[index]?.name || `Source ${index + 1}`,
    url,
  }))
}

async function startServeMatrix() {
  const serveRoot = findServeRoot()
  if (!serveRoot) {
    throw new Error(
      [
        'No llmwiki-serve checkout was found.',
        'Set LLMWIKI_SERVE_ROOT, place llmwiki-serve next to this repo,',
        'or set LLMWIKI_SAMPLE_MATRIX_URLS to already running source URLs.',
      ].join(' '),
    )
  }

  const sources = sampleCases.map((sample) => ({
    ...sample,
    root: join(serveRoot, sample.relativeRoot),
  }))
  const missing = sources.filter((source) => !existsSync(source.root))
  if (missing.length) {
    throw new Error(`Missing sample roots: ${missing.map((source) => source.root).join(', ')}`)
  }

  if (process.env.LLMWIKI_SAMPLE_MATRIX_SKIP_SYNC !== '1') {
    const syncArgs = ['sync', '--extra', 'dev']
    if (existsSync(join(serveRoot, 'uv.lock'))) syncArgs.push('--locked')
    console.log(`[sample-matrix] Syncing llmwiki-serve dependencies in ${serveRoot}`)
    await runCommand(uvCommand, syncArgs, { cwd: serveRoot })
  }

  const ports = await resolveServePorts(sources.length)
  const liveSources = []
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    const port = ports[index]
    const url = `http://127.0.0.1:${port}`
    console.log(`[sample-matrix] Starting ${source.id} at ${url}`)
    const child = startServeProcess(serveRoot, source.root, port)
    serveProcesses.push(child)
    liveSources.push({
      id: source.id,
      name: source.name,
      query: source.query,
      queryClass: source.queryClass,
      fixtureClasses: source.fixtureClasses,
      url,
    })
  }

  await Promise.all(liveSources.map((source, index) => waitForHealth(`${source.url}/health`, serveProcesses[index], 'llmwiki-serve')))
  return liveSources
}

function findServeRoot() {
  const candidates = [
    process.env.LLMWIKI_SERVE_ROOT,
    process.env.LLMWIKI_LIVE_SERVE_ROOT,
    join(chatRoot, '..', 'llmwiki-serve'),
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

function startServeProcess(serveRoot, sampleRoot, port) {
  const runArgs = ['run']
  if (process.env.LLMWIKI_SAMPLE_MATRIX_SKIP_SYNC === '1') runArgs.push('--no-sync')
  runArgs.push(
    'llmwiki-serve',
    'serve',
    sampleRoot,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  )
  return startChild(uvCommand, runArgs, { cwd: serveRoot, verboseEnv: 'LLMWIKI_SAMPLE_MATRIX_VERBOSE' })
}

async function startBridge({ required }) {
  const bridgeRoot = findBridgeRoot()
  if (!bridgeRoot) {
    const message = 'No llmwiki-agent-bridge checkout found. Set LLMWIKI_AGENT_BRIDGE_ROOT or LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL.'
    if (required) throw new Error(message)
    console.log(`[sample-matrix] ${message} Bridge checks will be skipped.`)
    return ''
  }
  const bridgeEntry = join(bridgeRoot, 'bin', 'llmwiki-agent-bridge.mjs')
  if (!existsSync(bridgeEntry)) {
    const message = `Bridge entrypoint not found: ${bridgeEntry}.`
    if (required) throw new Error(message)
    console.log(`[sample-matrix] ${message} Bridge checks will be skipped.`)
    return ''
  }
  if (!existsSync(join(bridgeRoot, 'node_modules'))) {
    const message = `Bridge dependencies not installed in ${bridgeRoot}. Run npm ci there or set LLMWIKI_SAMPLE_MATRIX_BRIDGE_URL.`
    if (required) throw new Error(message)
    console.log(`[sample-matrix] ${message} Bridge checks will be skipped.`)
    return ''
  }

  const port = parsePort(process.env.LLMWIKI_SAMPLE_MATRIX_BRIDGE_PORT, 'LLMWIKI_SAMPLE_MATRIX_BRIDGE_PORT')
    || await findOpenPort()
  const url = `http://127.0.0.1:${port}`
  console.log(`[sample-matrix] Starting llmwiki-agent-bridge at ${url}`)
  const child = startChild(process.execPath, [bridgeEntry], {
    cwd: bridgeRoot,
    env: {
      ...process.env,
      LLMWIKI_AGENT_BRIDGE_HOST: '127.0.0.1',
      LLMWIKI_AGENT_BRIDGE_PORT: String(port),
      LLMWIKI_AGENT_BRIDGE_SOURCE_POLICY: 'private-http',
    },
    verboseEnv: 'LLMWIKI_SAMPLE_MATRIX_VERBOSE',
  })
  bridgeProcesses.push(child)
  await waitForHealth(`${url}/health`, child, 'llmwiki-agent-bridge')
  return url
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

async function resolveServePorts(count) {
  const configured = (process.env.LLMWIKI_SAMPLE_MATRIX_PORTS || '')
    .split(',')
    .map((value, index) => parsePort(value, `LLMWIKI_SAMPLE_MATRIX_PORTS[${index}]`))
    .filter(Boolean)
  const ports = []
  for (let index = 0; index < count; index += 1) {
    const port = configured[index] || await findOpenPort(new Set(ports))
    if (ports.includes(port)) throw new Error('LLMWIKI_SAMPLE_MATRIX_PORTS must contain unique ports.')
    ports.push(port)
  }
  return ports
}

function runPlaywright(env) {
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright CLI was not found. Run `npm ci` before `npm run test:e2e:sample-matrix`.')
  }
  return runCommand(
    process.execPath,
    [playwrightCli, 'test', 'e2e/sample-graph-matrix.spec.ts', ...playwrightArgs],
    { cwd: chatRoot, env },
  )
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
        console.log(`[sample-matrix] ${label} is healthy at ${url}`)
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
  const server = createServer()
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

function cleanupChildren() {
  if (!cleanupPromise) {
    cleanupPromise = Promise.all([...bridgeProcesses, ...serveProcesses].map(stopProcessTree))
  }
  return cleanupPromise
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
