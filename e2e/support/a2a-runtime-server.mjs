import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || '0')
const runtimeName = 'E2E Custom A2A Runtime'
const requests = []

const corsHeaders = {
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`)

  if (request.method === 'OPTIONS') {
    writeJson(response, 204, null)
    return
  }

  if (request.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
    writeJson(response, 200, {
      id: 'e2e-custom-a2a-runtime',
      name: runtimeName,
      description: 'Test-only live A2A runtime process for llmwiki-chat E2E smoke coverage.',
      protocol: 'a2a',
      url: '/message:send',
      capabilities: {
        streaming: false,
        structuredArtifacts: true,
      },
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/message:send') {
    const body = await readJsonBody(request)
    requests.push({ at: new Date().toISOString(), body })
    writeJson(response, 200, buildAgentResult(body))
    return
  }

  if (request.method === 'GET' && url.pathname === '/__debug/requests') {
    writeJson(response, 200, { requests })
    return
  }

  writeJson(response, 404, { error: 'not found' })
})

server.listen(port, host, () => {
  const address = server.address()
  const selectedPort = typeof address === 'object' && address ? address.port : port
  process.stdout.write(`${JSON.stringify({ event: 'ready', url: `http://${host}:${selectedPort}` })}\n`)
})

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

function shutdown() {
  server.close(() => {
    process.exit(0)
  })
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error), rawBody: text }
  }
}

function buildAgentResult(body) {
  const data = isRecord(body.data) ? body.data : {}
  const query = typeof data.query === 'string' ? data.query : ''
  const sources = Array.isArray(data.knowledgeSources) ? data.knowledgeSources.filter(isRecord) : []
  const tools = Array.isArray(data.tools) ? data.tools.filter(isRecord) : []
  const source = sources[0] || {}
  const sourceId = stringValue(source.id) || 'unknown-source'
  const sourceName = stringValue(source.name) || 'Unknown Source'
  const sourceProtocol = stringValue(source.protocol) || 'llmwiki-http'
  const sourceUrl = stringValue(source.url) || 'unknown URL'
  const toolName = stringValue(tools.find((tool) => stringValue(tool.knowledgeSourceId) === sourceId)?.name)
    || `llmwiki_context__${safeId(sourceId)}`
  const evidenceTitle = `${sourceName} Runtime Evidence`
  const evidenceSnippet = [
    `${runtimeName} received ${sourceName} as a selected ${sourceProtocol} Knowledge Source descriptor.`,
    `It planned tool ${toolName} against ${sourceUrl}.`,
  ].join(' ')

  return {
    id: randomUUID(),
    status: {
      state: 'completed',
      message: {
        parts: [{ kind: 'text', text: `${runtimeName} completed the descriptor-backed smoke response.` }],
      },
    },
    message: {
      role: 'agent',
      parts: [{ kind: 'text', text: 'Live runtime answer generated from selected LLMWiki descriptors.' }],
    },
    artifacts: [
      {
        name: 'llmwiki_agent_result',
        parts: [
          {
            kind: 'data',
            data: {
              answer: [
                `Live A2A runtime used ${sources.length} selected LLMWiki source descriptor(s).`,
                `It selected ${sourceName} (${sourceProtocol}) and returned descriptor-grounded evidence for "${query}".`,
              ].join(' '),
              citations: [
                {
                  id: `${sourceId}:live-runtime-evidence`,
                  title: evidenceTitle,
                  path: 'runtime/live-a2a-smoke.md',
                  snippet: evidenceSnippet,
                  connectionId: sourceId,
                  sourceRefs: ['E2E-RUNTIME-SRC'],
                },
              ],
              graph: {
                nodes: [
                  {
                    id: `page:${safeId(sourceId)}-runtime-evidence`,
                    label: evidenceTitle,
                    kind: 'topic',
                    path: 'runtime/live-a2a-smoke.md',
                  },
                ],
                edges: [],
              },
              steps: [
                {
                  id: `runtime-tool-${safeId(sourceId)}`,
                  label: `Call ${sourceName}`,
                  status: 'done',
                  connectionId: sourceId,
                  toolName,
                  detail: `Used ${sourceUrl} descriptor and ${toolName} tool description.`,
                  latencyMs: 7,
                },
                {
                  id: 'runtime-compose-answer',
                  label: 'Compose answer',
                  status: 'done',
                  detail: 'Returned a structured llmwiki_agent_result artifact.',
                  latencyMs: 3,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(value === null ? '' : JSON.stringify(value))
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value) {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function safeId(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9]+/g, '_') || 'source'
}
