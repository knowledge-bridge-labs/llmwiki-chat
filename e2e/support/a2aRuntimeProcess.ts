import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export interface RuntimeDebugRequest {
  body?: {
    data?: {
      query?: string
      knowledgeSources?: Array<Record<string, unknown>>
      tools?: Array<Record<string, unknown>>
    }
  }
}

export interface StartedA2aRuntimeProcess {
  url: string
  requests: () => Promise<RuntimeDebugRequest[]>
  stop: () => Promise<void>
}

interface ReadyLine {
  event?: string
  url?: string
}

interface RuntimeDebugResponse {
  requests?: RuntimeDebugRequest[]
}

export async function startA2aRuntimeProcess(): Promise<StartedA2aRuntimeProcess> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./a2a-runtime-server.mjs', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')

  let stderr = ''
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const lines = createInterface({ input: child.stdout })
  const url = await waitForReadyUrl(child, lines, () => stderr)

  return {
    url,
    requests: async () => {
      const response = await fetch(`${url}/__debug/requests`)
      if (!response.ok) throw new Error(`A2A runtime debug request failed with HTTP ${response.status}`)
      const body = await response.json() as RuntimeDebugResponse
      return Array.isArray(body.requests) ? body.requests : []
    },
    stop: async () => {
      lines.close()
      await stopProcess(child)
    },
  }
}

function waitForReadyUrl(
  child: ChildProcessWithoutNullStreams,
  lines: ReturnType<typeof createInterface>,
  stderr: () => string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => reject(new Error(`A2A runtime server did not start within 10s.${formatStderr(stderr())}`)))
    }, 10_000)

    const settle = (done: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      done()
    }

    lines.on('line', (line) => {
      const ready = parseReadyLine(line)
      if (ready?.event === 'ready' && ready.url) settle(() => resolve(ready.url || ''))
    })

    child.once('error', (error) => {
      settle(() => reject(error))
    })

    child.once('exit', (code, signal) => {
      settle(() => reject(new Error(`A2A runtime server exited before ready: code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'}.${formatStderr(stderr())}`)))
    })
  })
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  child.kill('SIGTERM')

  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }),
  ])
}

function parseReadyLine(line: string): ReadyLine | null {
  try {
    const parsed = JSON.parse(line) as ReadyLine
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatStderr(value: string): string {
  const clean = value.trim()
  return clean ? ` stderr: ${clean}` : ''
}
