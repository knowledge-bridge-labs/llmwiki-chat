# Agent Runtime Adapters

`llmwiki-chat` is a UI and console for using LLMWiki knowledge tools from an
external Agent Runtime. It is not the production reasoning engine.

## Supported Product Uses

Adapter work must preserve both public usage modes:

1. `llmwiki-serve` end-to-end usage, where a local or hosted `llmwiki-serve`
   process exposes HTTP, MCP-style JSON-RPC, or A2A-style message knowledge
   tools.
2. External Agent Runtime console usage, where an externally managed Agent
   Runtime is connected through an Agent Runtime adapter. LLMWiki-compatible
   Knowledge Source endpoints connect separately through the HTTP,
   MCP-style JSON-RPC, or A2A-style message Knowledge Source endpoint protocol
   adapter.

In both modes, the selected external runtime owns planning, tool-use strategy,
and production answer quality. The chat client owns source selection, adapter
configuration, trace rendering, citations, and graph context display.

## Runtime Model

- Knowledge Source endpoints expose LLMWiki content as read-only tools. A local
  `llmwiki-serve` process can expose those tools over HTTP, MCP-style JSON-RPC,
  or A2A-style messages.
- External runtimes are responsible for planning, calling tools, and composing
  answers. Today, the repository supports `Mock Agent` for development and
  `Custom A2A` for an external A2A-style runtime; Hermes and DeepAgents are
  A2A-style named runtime slots. Copilot is modeled as an external Agent
  Runtime candidate for agents that consume MCP-style JSON-RPC or A2A-style
  message tool surfaces, not as a built-in, validated Copilot adapter in this
  repository. The `Mock Agent`
  development adapter appears in the UI as `Local Development Runtime`.
- `llmwiki-chat` lets users choose knowledge sources and a runtime adapter, then
  renders source status, runtime status, tool calls, citations, and graph context.

The client can be used today with local or hosted `llmwiki-serve` endpoints and
externally managed LLMWiki-style HTTP, MCP-style JSON-RPC, and A2A-style
message Knowledge Source endpoints.
Those Knowledge Source endpoint protocols are separate from Agent Runtime product
support: `Mock Agent` and `Custom A2A` are usable without product-specific
runtime validation, while Hermes and DeepAgents are named A2A slots that require
matching runtime card identity. Copilot is an external runtime candidate for
agents that consume MCP-style JSON-RPC or A2A-style message tool surfaces and
also requires matching runtime identity. These are not product-validated
integrations yet.

Keep the boundary strict when reviewing adapter changes: knowledge source
adapters discover and query LLMWiki-compatible endpoints, while Agent Runtime
adapters decide how to plan, invoke those sources as tools, and compose an
answer. A change that improves HTTP, MCP-style JSON-RPC, or A2A-style message
Knowledge Source endpoint compatibility does not by itself validate Hermes,
DeepAgents, Copilot, or another runtime.

## External A2A Runtime Contract

`Custom A2A` is the generic A2A-style runtime slot available today. It is
configurable by URL in the UI and becomes ready only after successful agent-card
discovery. Hermes and DeepAgents are A2A-style named runtime slots that use
the same discovery and invocation contract. Copilot is an external Agent Runtime
candidate for agents that consume MCP-style JSON-RPC or A2A-style message tool
surfaces, not a built-in Copilot integration. A named slot becomes ready only
when the configured agent card identity matches the selected runtime; use
`Custom A2A` for a generic A2A card. These named slots do not imply hardcoded
endpoint paths, authentication, model selection, vendor-specific payloads, or
product-specific validation.

Configured Agent Runtime URLs must use public HTTPS, or loopback HTTP(S) for
local development. Non-local `http:` runtime URLs, private-network or other
special-use IPv4/IPv6 runtime URLs, and single-label or internal hostnames are
rejected before agent-card discovery.

Agent Runtime setup supports an optional bearer token for protected A2A
runtimes. The token is runtime-local secret material: the UI stores it only in
the current browser tab state, sends it only as `Authorization: Bearer ...` on
agent-card discovery and runtime `message:send`, and does not put it in
localStorage, Knowledge Source descriptors, runtime request bodies, or package
artifacts. If stored Knowledge Source connection config contains older
token-shaped fields, the app rewrites the persisted config without them.

For local tailnet or lab testing, set
`VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS=true` before starting the
dev server. This opt-in permits private HTTP(S) Agent Runtime URLs such as
Tailscale `100.64.0.0/10` addresses while keeping the public/hosted default
strict.

This opt-in is scoped to external Agent Runtime URLs only. It does not relax
the browser-side policy for A2A Knowledge Source agent-card `message:send`
URLs, which must resolve to loopback HTTP(S) or public HTTPS when discovered by
the client.

Runtime discovery:

- `GET /.well-known/agent-card.json`, unless the configured URL already ends in
  `/.well-known/agent-card.json`
- includes `Authorization: Bearer ...` when the runtime setup token is set
- card `url` resolves to the runtime `message:send` endpoint
- relative card URLs such as `message:send` resolve relative to the configured
  runtime base

Runtime invocation:

- `POST message:send`
- includes `Authorization: Bearer ...` when the runtime setup token is set
- request body contains `data.query`
- request body contains `data.runtimeContext`, describing that `llmwiki-chat`
  owns UI, session flow, connections, and trace display while the runtime owns
  reasoning, tool-use planning, and answer composition
- request body contains `data.knowledgeSources`
- request body contains `data.tools`, one callable tool description per selected
  ready Knowledge Source
- each knowledge source descriptor includes `id`, `title`, `name`,
  `description`, `protocol`, `status`, `url`, `capabilities`, and `adapter` or
  `implementation` when known
- each tool descriptor includes `name`, `description`, `knowledgeSourceId`,
  `protocol`, `inputSchema`, and output expectations
- raw graph data is not sent by default

`llmwiki-chat` must not add a keyword or if/else intent classifier that decides
which tool a question needs. It passes the selected ready sources, runtime
context, and tool descriptions to the selected Agent Runtime. The runtime uses
that context to decide which tools to call.

External runtimes receive Knowledge Source descriptors and call those URLs from
outside the local browser session. `Mock Agent` / `Local Development Runtime`
supports local development sources, while `Custom A2A`, Hermes, DeepAgents,
Copilot, and other external runtimes may need selected ready Knowledge Sources
to be reachable from that runtime. The client allows `http:`, private-network,
tailnet, local, single-label, `.local`, `.internal`, and other non-public
Knowledge Source URLs by default for OSS, local, and private deployments. When
an external runtime is selected with ready sources that are not public HTTPS,
the UI shows an advisory warning instead of blocking Ask or suggested prompts.
Use public HTTPS source URLs for shared deployments, or ensure the external
runtime can reach and is authorized to call the private source.

A2A Knowledge Source discovery has one stricter browser-side rule: the agent
card's resolved `message:send` URL must be loopback HTTP(S) or public HTTPS.
Private or tailnet HTTP(S) `message:send` URLs should be called through a
trusted bridge/runtime with its own source allowlist instead of directly from
the browser client.

The browser-side public-HTTPS warning is an advisory and accidental-disclosure
guard, not a complete security boundary. Strict or public Agent Runtime
services must still enforce server-side allowlists, DNS/IP checks after
resolution, redirect policy, authentication, rate limits, and egress controls
before calling user-provided Knowledge Source URLs.

## Companion Agent Bridge

`llmwiki-chat` does not include Hermes bridge code or ship a bridge binary. Use
the separate `llmwiki-agent-bridge` companion service when Hermes, DeepAgents,
or a generic OpenAI-compatible local runtime should be exposed to `llmwiki-chat`
through one A2A-style runtime URL.

The companion bridge:

- serves `GET /.well-known/agent-card.json` with profile-specific A2A runtime
  metadata for `hermes`, `deepagents`, or `generic`
- serves `POST /message:send` for the normal `llmwiki-chat` runtime request
- queries selected ready Knowledge Sources itself over `llmwiki-http`, MCP-style
  JSON-RPC, or A2A-style message protocols
- calls the configured OpenAI-compatible `/chat/completions` runtime with the
  retrieved source evidence
- returns a structured `llmwiki_agent_result` artifact with `answer`,
  `citations`, merged `graph`, and `steps`

Local checkout usage:

```bash
git clone https://github.com/knowledge-bridge-labs/llmwiki-agent-bridge.git
cd llmwiki-agent-bridge
npm ci
LLMWIKI_AGENT_BRIDGE_BASE_URL=http://127.0.0.1:8642/v1 \
LLMWIKI_AGENT_BRIDGE_MODEL=hermes-agent \
LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE=hermes \
npm exec -- llmwiki-agent-bridge
```

After npm publication, use the package binary instead:

```bash
LLMWIKI_AGENT_BRIDGE_BASE_URL=http://127.0.0.1:8642/v1 \
LLMWIKI_AGENT_BRIDGE_MODEL=local-model \
LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE=generic \
npm exec --package llmwiki-agent-bridge -- llmwiki-agent-bridge
```

Use `LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE=hermes` for Hermes or a
Hermes-compatible gateway, `deepagents` for a DeepAgents-compatible local
runtime, and `generic` for any other OpenAI-compatible chat completions
runtime. If the runtime requires provider authentication, keep
`LLMWIKI_AGENT_BRIDGE_API_KEY` in the bridge process environment.

Then open `llmwiki-chat`, choose the matching named runtime slot or `Custom A2A`,
enter the bridge URL such as `http://127.0.0.1:8788`, click `Test runtime`, and
ask normally after the runtime reports ready. Named slots become ready only when
the bridge agent card identity matches the selected slot.

The bridge owns server-side source access policy. Use
`LLMWIKI_AGENT_BRIDGE_SOURCE_POLICY` to choose the outbound Knowledge Source URL
policy and `LLMWIKI_AGENT_BRIDGE_ALLOWED_SOURCE_ORIGINS` for exact source-origin
allowlists or exceptions. The default policy is defined by
`llmwiki-agent-bridge`; shared deployments should use an explicit policy,
operator-owned logging rules, and HTTPS at the network edge.

Keep provider keys in the bridge process environment. Do not put model-provider
keys in browser fields, URLs, docs, screenshots, Knowledge Source descriptors,
or package artifacts. During the bridge flow, the browser talks only to the
bridge URL; the bridge calls selected Knowledge Sources and the configured
runtime from Node.

Bridge bearer tokens are different from provider API keys. A bridge bearer token
authorizes browser-to-bridge A2A requests and is configured with
`LLMWIKI_AGENT_BRIDGE_BEARER_TOKEN`. Enter the same value in the `llmwiki-chat`
runtime setup panel only when the bridge requires it; the browser then sends
only that runtime bearer token to bridge discovery and `message:send`. Provider
API keys authorize bridge-to-runtime requests and stay in the bridge process
environment.

Example request body:

```json
{
  "data": {
    "query": "What needs review?",
    "runtimeContext": {
      "application": "llmwiki-chat",
      "clientRole": "ui-session-connection-trace-console",
      "runtimeRole": "external-agent-runtime",
      "selectedRuntime": {
        "id": "custom-a2a",
        "name": "Custom A2A",
        "protocol": "custom-a2a"
      },
      "selectedKnowledgeSourceCount": 1,
      "selectedKnowledgeSources": [
        {
          "id": "local-demo",
          "title": "Sample Wiki",
          "description": "Synthetic packaging operations knowledge base.",
          "protocol": "llmwiki-http",
          "status": "ready"
        }
      ],
      "toolSelection": "The runtime receives the query, source descriptors, and tool descriptions; llmwiki-chat does not classify intent by keyword or preselect tools beyond the user-selected ready sources."
    },
    "knowledgeSources": [
      {
        "id": "local-demo",
        "title": "Sample Wiki",
        "name": "Sample Wiki",
        "description": "Synthetic packaging operations knowledge base.",
        "protocol": "llmwiki-http",
        "status": "ready",
        "url": "https://wiki.example.com",
        "capabilities": ["llmwiki_context", "llmwiki_graph"],
        "adapter": "llmwiki-markdown",
        "implementation": "atomicstrata/llm-wiki-compiler"
      }
    ],
    "tools": [
      {
        "name": "llmwiki_context__local_demo",
        "description": "Read-only LLMWiki context tool for Sample Wiki. The source is available through the llmwiki-http Knowledge Source endpoint protocol. Use this tool when the query may need orientation, citation-grade evidence, limitations, or graph context from this source.",
        "knowledgeSourceId": "local-demo",
        "protocol": "llmwiki-http",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "The user question or runtime-refined subquestion to ask this LLMWiki Knowledge Source."
            },
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 20,
              "default": 8,
              "description": "Maximum context items or citations to request from the Knowledge Source."
            }
          },
          "required": ["query"]
        },
        "outputDescription": "Returns orientation, citations with source refs, limitations, and optional graph context in the LLMWiki context shape."
      }
    ]
  }
}
```

Structured runtime responses should include an artifact named
`llmwiki_agent_result` with a data part:

```json
{
  "answer": "Markdown answer text.",
  "citations": [
    {
      "id": "local-demo:release",
      "title": "Release",
      "path": "release.md",
      "snippet": "Evidence snippet.",
      "connectionId": "local-demo",
      "sourceRefs": ["SRC-1"]
    }
  ],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "steps": [
    {
      "id": "tool-local-demo",
      "label": "Call selected LLMWiki source",
      "status": "done",
      "connectionId": "local-demo",
      "toolName": "llmwiki_context__local_demo",
      "detail": "Read citation-grade context.",
      "citation_ids": ["local-demo:release"]
    }
  ]
}
```

`answer` is expected. `citations`, `graph`, and `steps` may be empty. If a
runtime omits `llmwiki_agent_result`, the client uses the A2A message text as an
uncited fallback answer and records an `Unstructured runtime response` status
step. A2A error objects and failed, canceled, cancelled, or rejected task states
are surfaced as runtime errors in the chat trace.

For best evidence ordering, each runtime step that read citations should include
`citation_ids` or `citationIds` in the order the runtime used those citations.
The chat UI uses that sequence to order visible evidence buttons. Markdown links
such as `#citation-1` continue to resolve against the runtime's original
`citations` array, so reordering the evidence list does not change the cited
target.

## Current Development Adapter

`Mock Agent` is a development adapter. In the UI it appears as `Local
Development Runtime`. It exists to make local UI work possible without a
production runtime:

- verifies that selected knowledge sources can be called as tools
- exercises the chat loading state, trace, citations, and graph/detail continuity
- gives tests and demos a stable local path

Mock output is not a production answer-quality target. Do not use it as evidence
that `Custom A2A`, Hermes, DeepAgents, Copilot, or another runtime will produce
equivalent answers. Bugs in mock trace rendering, source selection, or graph
continuity are valid development issues; mock answer quality by itself is not a
release criterion.

When `llmwiki-serve` support needed by an adapter is still being implemented,
keep UI and tool-flow work moving with `Mock Agent` and documented mock or
fixture paths. After a real `llmwiki-serve` endpoint is available, validate the
same flow with:

```bash
npm run test:e2e:live
```

The package script starts two `examples/sample-wiki` servers from a sibling
`llmwiki-serve` checkout, or from `LLMWIKI_SERVE_ROOT` if the checkout lives
elsewhere. It passes them as `LLMWIKI_LIVE_SERVE_URL` and
`LLMWIKI_LIVE_SERVE_URL_2` so the spec verifies that citations, page details,
and graph nodes stay source-scoped. To use one or more already running endpoints,
set `LLMWIKI_LIVE_SERVE_URL` or `LLMWIKI_LIVE_SERVE_URLS`; the script will not
start local servers and will preserve any provided `LLMWIKI_LIVE_SERVE_URL_2` or
`LLMWIKI_LIVE_SERVE_URLS`:

```bash
LLMWIKI_LIVE_SERVE_URL=http://127.0.0.1:8765 \
LLMWIKI_LIVE_SERVE_URL_2=http://127.0.0.1:8766 \
npm run test:e2e:live
```

Set `LLMWIKI_LIVE_SERVE_SINGLE_SOURCE=1` only when a single local source smoke is
intentional.

Do not replace the live check with mock answer review when the claim is endpoint
compatibility.

## Adapter Contribution Expectations

When adding or changing an adapter, document:

- runtime name and supported protocol
- endpoint contract and authentication assumptions, without real values
- how selected LLMWiki sources are passed to the runtime as tools
- expected trace, citation, and error behavior
- local validation steps using the scripts in `package.json`

If an adapter requires authentication, document the configuration surface and
validation approach only. Do not commit actual API keys, bearer tokens, private
endpoint URLs, customer exports, screenshots, or raw sensitive logs.

## Runtime Client Contract

Runtime adapters are registered in the Agent Runtime registry and expose an
`AgentRuntimeClient` with `stream(request)` and `run(request)`.

The UI sends an `AgentRunRequest` containing:

- the selected Agent Runtime connection
- the selected LLMWiki knowledge sources
- the user query
- an optional `AbortSignal`

Adapters should treat the provided knowledge sources and tool descriptions as
the complete tool set for the run. The Agent Runtime should make the tool-use
decision from the query, runtime context, and tool descriptions, not from
client-side keyword routing. Adapters should honor the abort signal for network
calls and avoid reading credentials from committed files or hard-coded
constants.

`stream(request)` should emit the same event families the UI already renders:

- run and status steps for planning, execution, and final answer progress
- tool-call start and result events with `connectionId` and tool name
- citation and graph update events when evidence is available
- answer deltas or a final completed result
- error events with a user-safe message when a runtime or tool call fails

`run(request)` should return an `AgentRunResult` with markdown answer text,
citations, graph data, and the final step list. It can either call the same
underlying runtime operation directly or drain `stream(request)` until the
`run_completed` event.

Register `Custom A2A` as `ready` only when its client can execute a real
configured run. Register a named A2A slot as `ready` only when the configured
runtime card identity matches that slot and the client can execute a real
configured run. Keep unconfigured or unvalidated slots registered as
`unavailable` so public users do not mistake them for product-validated
integrations.

## Validation Expectations

Runtime adapter pull requests should include validation that matches the risk of
the change:

- unit tests for request normalization, runtime errors, event ordering, citation
  mapping, and graph mapping where applicable
- UI or E2E coverage when the runtime selection, trace, source selection, or
  answer rendering flow changes
- local manual validation against a `llmwiki-serve` HTTP, MCP-style JSON-RPC,
  or A2A-style message endpoint when the adapter changes how sources are
  exposed as tools
- documented skipped checks for documentation-only changes or unavailable
  external services

Before review, run the package checks listed in `README.md` and
`CONTRIBUTING.md` unless the pull request clearly explains why a check was not
run.

For changes that touch HTTP, MCP-style JSON-RPC, or A2A-style message Knowledge
Source endpoint compatibility, also run the opt-in live smoke test against a
real `llmwiki-serve` endpoint when one is available:

```bash
npm run test:e2e:live
```

For changes that affect multi-source selection, provenance, citations, or graph
merging, use `npm run test:e2e:live`; the package script provisions two local
sample endpoints by default and verifies that same-named pages across sources
are not collapsed. Direct Playwright runs of `e2e/live-serve.spec.ts` are still
skipped by default without `LLMWIKI_LIVE_SERVE_URL` or
`LLMWIKI_LIVE_SERVE_URLS`; use the package script for the provisioned live smoke.

## Endpoint Compatibility Notes

The HTTP knowledge adapter expects:

- `GET /manifest`
- `GET /graph?limit=500`
- `POST /query` with a JSON body like `{ "query": "...", "limit": 8 }`

The MCP knowledge adapter assumes a llmwiki-serve-compatible JSON-RPC endpoint:

- `POST /mcp`, unless the configured URL already ends in `/mcp`
- `tools/list`
- `tools/call` for `llmwiki_context` with `{ "query": "...", "limit": 8 }`
- `tools/call` for `llmwiki_graph` with `{ "limit": 500, "include_drafts": false }`

The A2A knowledge adapter assumes llmwiki-serve-compatible agent-card and
message endpoints:

- `GET /.well-known/agent-card.json`, unless the configured URL already points to
  the agent card
- card `url` resolves to the `message:send` endpoint
- `POST message:send` with `{ "data": { "query": "..." } }`
- responses include a `llmwiki_context` artifact with a data part containing the
  same context pack shape returned by HTTP `/query`

Protocol-specific adapters should keep compatibility assumptions explicit in
README, CONTRIBUTING, or adapter docs before the change is reviewed.
