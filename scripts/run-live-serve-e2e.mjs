#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const chatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const playwrightArgs = process.argv.slice(2)
const uvCommand = process.env.UV || 'uv'
const playwrightCli = join(chatRoot, 'node_modules', '@playwright', 'test', 'cli.js')

const liveServeProcesses = []

try {
  const existingUrl = normalizeUrl(process.env.LLMWIKI_LIVE_SERVE_URL)
  const existingUrlList = normalizeUrlList((process.env.LLMWIKI_LIVE_SERVE_URLS || '').split(','))
  if (existingUrl || existingUrlList.length) {
    const existingUrls = normalizeUrlList([
      existingUrl,
      process.env.LLMWIKI_LIVE_SERVE_URL_2,
      ...existingUrlList,
    ])
    console.log(`[live-e2e] Using existing llmwiki-serve URL${existingUrls.length === 1 ? '' : 's'}: ${existingUrls.join(', ')}`)
    await runPlaywright(externalServeEnv(existingUrl, existingUrlList))
    process.exitCode = 0
  } else {
    const serveRoot = findServeRoot()
    if (!serveRoot) {
      throw new Error(
        [
          'LLMWIKI_LIVE_SERVE_URL is not set and no llmwiki-serve checkout was found.',
          'Set LLMWIKI_SERVE_ROOT to a llmwiki-serve checkout, place llmwiki-serve next to this repo,',
          'or set LLMWIKI_LIVE_SERVE_URL to an already running server.',
        ].join(' '),
      )
    }

    const sampleRoot = resolveSampleRoot(serveRoot)
    if (!existsSync(sampleRoot)) {
      throw new Error(`llmwiki-serve sample wiki was not found: ${sampleRoot}`)
    }

    if (process.env.LLMWIKI_LIVE_SERVE_SKIP_SYNC !== '1') {
      const syncArgs = ['sync', '--extra', 'dev']
      if (existsSync(join(serveRoot, 'uv.lock'))) syncArgs.push('--locked')
      console.log(`[live-e2e] Syncing llmwiki-serve dependencies in ${serveRoot}`)
      await runCommand(uvCommand, syncArgs, { cwd: serveRoot })
    }

    const sourceCount = process.env.LLMWIKI_LIVE_SERVE_SINGLE_SOURCE === '1' ? 1 : 2
    const liveServeUrls = await startLocalServeSources(serveRoot, sampleRoot, sourceCount)
    await runPlaywright(localServeEnv(liveServeUrls))
    process.exitCode = 0
  }
} catch (error) {
  console.error(`[live-e2e] ${formatError(error)}`)
  process.exitCode = 1
} finally {
  await Promise.all(liveServeProcesses.map(stopProcessTree))
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
  const configured = process.env.LLMWIKI_SERVE_SAMPLE_ROOT
  return configured ? resolveFromChatRoot(configured) : join(serveRoot, 'examples', 'sample-wiki')
}

function resolveFromChatRoot(value) {
  return isAbsolute(value) ? resolve(value) : resolve(chatRoot, value)
}

async function startLocalServeSources(serveRoot, sampleRoot, sourceCount) {
  const ports = await resolveServePorts(sourceCount)
  const urls = []

  for (let index = 0; index < sourceCount; index += 1) {
    const port = ports[index]
    const url = `http://127.0.0.1:${port}`
    const label = sourceCount === 1 ? 'sample source' : `sample source ${index + 1}`
    console.log(`[live-e2e] Starting llmwiki-serve ${label} at ${url}`)
    const child = startServeProcess(serveRoot, sampleRoot, port)
    liveServeProcesses.push(child)
    urls.push(url)
  }

  await Promise.all(urls.map((url, index) => waitForHealth(url, liveServeProcesses[index])))
  if (urls.length > 1) {
    console.log(`[live-e2e] Passing live sources to Playwright: ${urls.join(', ')}`)
  }
  return urls
}

async function resolveServePorts(sourceCount) {
  const ports = []
  const configuredPorts = [
    parsePort(process.env.LLMWIKI_LIVE_SERVE_PORT, 'LLMWIKI_LIVE_SERVE_PORT'),
    parsePort(process.env.LLMWIKI_LIVE_SERVE_PORT_2, 'LLMWIKI_LIVE_SERVE_PORT_2'),
  ]

  for (let index = 0; index < sourceCount; index += 1) {
    const configuredPort = configuredPorts[index] || 0
    const port = configuredPort || await findOpenPort(new Set(ports))
    if (ports.includes(port)) {
      throw new Error('LLMWIKI_LIVE_SERVE_PORT and LLMWIKI_LIVE_SERVE_PORT_2 must be different.')
    }
    ports.push(port)
  }

  return ports
}

function localServeEnv(urls) {
  const env = {
    ...process.env,
    LLMWIKI_LIVE_SERVE_URL: urls[0],
    LLMWIKI_LIVE_SERVE_URL_2: urls[1] || '',
    LLMWIKI_LIVE_SERVE_URLS: '',
  }
  return env
}

function externalServeEnv(existingUrl, existingUrlList) {
  const env = { ...process.env }
  const existingUrl2 = normalizeUrl(process.env.LLMWIKI_LIVE_SERVE_URL_2)
  if (existingUrl) env.LLMWIKI_LIVE_SERVE_URL = existingUrl
  if (existingUrl2) env.LLMWIKI_LIVE_SERVE_URL_2 = existingUrl2
  if (existingUrlList.length) env.LLMWIKI_LIVE_SERVE_URLS = existingUrlList.join(',')
  return env
}

function startServeProcess(serveRoot, sampleRoot, port) {
  const child = spawn(
    uvCommand,
    [
      'run',
      'llmwiki-serve',
      'serve',
      sampleRoot,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: serveRoot,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.output = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    child.output.stdout = rememberOutput(child.output.stdout, chunk)
    if (process.env.LLMWIKI_LIVE_SERVE_VERBOSE === '1') process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    child.output.stderr = rememberOutput(child.output.stderr, chunk)
    if (process.env.LLMWIKI_LIVE_SERVE_VERBOSE === '1') process.stderr.write(chunk)
  })

  return child
}

async function waitForHealth(url, child) {
  let exitMessage = ''
  child.once('exit', (code, signal) => {
    exitMessage = `llmwiki-serve exited before ready: code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'}.`
  })
  child.once('error', (error) => {
    exitMessage = `llmwiki-serve failed to start: ${error.message}.`
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exitMessage) throw new Error(`${exitMessage}${formatProcessOutput(child)}`)

    try {
      const response = await fetchWithTimeout(`${url}/health`, 750)
      if (response.ok) {
        console.log(`[live-e2e] llmwiki-serve is healthy at ${url}`)
        return
      }
    } catch {
      // Retry until the server is healthy or the startup deadline expires.
    }

    await delay(250)
  }

  throw new Error(`llmwiki-serve did not become healthy within 30s.${formatProcessOutput(child)}`)
}

function runPlaywright(env) {
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright CLI was not found. Run `npm ci` before `npm run test:e2e:live`.')
  }
  return runCommand(
    process.execPath,
    [playwrightCli, 'test', 'e2e/live-serve.spec.ts', ...playwrightArgs],
    { cwd: chatRoot, env },
  )
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
  if (!port) throw new Error('Could not allocate a local port for llmwiki-serve.')
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

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
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
