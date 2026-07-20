# LLMWiki Chat Quickstart Orchestration Plan

Status: MVP implemented for browser-guided setup; managed local process
automation remains follow-up
Owner: llmwiki-chat / llmwiki-agent-bridge / llmwiki-serve
Last updated: 2026-07-21

## Goal

Make the first-run path work from `llmwiki-chat` with one visible quickstart
entry point. The current MVP is browser-guided: it shows safe commands and runs
source/runtime probes after the user starts local services. It does not install
packages or launch local processes from the browser.

1. detect local `llmwiki-agent-bridge` and `llmwiki-serve` status,
2. show commands for starting a default sample wiki when no source is configured,
3. allow the user to select a local wiki path,
4. register that source with the bridge,
5. verify the runtime/source path with smoke tests,
6. enter chat with working grounded answers.

The button in `llmwiki-chat` should feel like "start LLMWiki", but process
launching, installation, and privileged local operations must be handled by a
local trusted helper, not by browser-only UI code.

## Product Flow

```text
Open llmwiki-chat
→ Start Quickstart
→ Detect bridge / serve / runtime
→ Choose sample wiki or local wiki path
→ Start or reuse llmwiki-serve in a trusted shell
→ Register source in llmwiki-agent-bridge
→ Verify health, source bundle, and message send
→ Start chat
```

## Runtime Choices

The quickstart should present runtime choices in this order:

1. existing configured runtime,
2. Hermes Agent,
3. DeepAgents,
4. generic OpenAI-compatible endpoint.

The quickstart should prefer existing runtime configuration. Installing Hermes
Agent or DeepAgents should be a separate explicit step with command preview and
user confirmation.

## Responsibility Boundary

| Component | Responsibility |
|---|---|
| `llmwiki-chat` | Wizard UI, status display, local log display, user choices |
| `llmwiki-agent-bridge` | Local setup API, runtime/source settings, verification, safe command orchestration |
| `llmwiki-serve` | Serve selected wiki source, expose source bundle/query/graph endpoints |
| Hermes / DeepAgents / vLLM | Runtime execution, native history/prompt/prefix cache |

`llmwiki-chat` must not directly run arbitrary shell commands. It should call a
local-only setup surface exposed by a trusted helper.

## Proposed Local Setup API

Future API surface on `llmwiki-agent-bridge`:

```text
GET  /quickstart/status
POST /quickstart/start-sample
POST /quickstart/start-serve
POST /quickstart/register-source
POST /quickstart/verify
POST /quickstart/stop-managed
```

The API should only be enabled for local/private operation and should return
redacted diagnostics.

## MVP Scope

MVP avoids installer automation. It only reuses installed tools and provides a
reliable local path:

- detect bridge status,
- show commands for sample `llmwiki-serve`,
- test the selected sample source,
- test the local bridge when it is running,
- let the user switch to Local Development Runtime for deterministic UI checks,
- enter chat.

## Follow-Up Scope

After MVP:

- local wiki path picker/input,
- managed serve process lifecycle,
- port conflict handling,
- recent wiki path list,
- Hermes Agent install/start wizard,
- DeepAgents install/start wizard,
- runtime cache/metrics panel,
- one-click reset/stop managed services.

## Safety Requirements

- Localhost/private-network only by default.
- No silent package install, Docker run, shell execution, or persistent config
  write without user confirmation.
- Preview commands before install/start actions.
- Allowlist managed commands and arguments.
- Redact API keys, bearer tokens, private endpoints, and local absolute paths in
  logs displayed to the UI.
- Provide stop/retry/reconfigure controls.
- Persist only safe settings and source descriptors.

## Verification Requirements

Quickstart is successful only when all checks pass:

1. bridge `/health` returns ready runtime/source status,
2. serve `/health` and `/source-bundle` return valid metadata,
3. bridge source registry includes the selected source,
4. bridge `/message:send` returns a completed answer,
5. local I/O logs capture redacted request/response flow,
6. user can send a follow-up and conversation history reaches the runtime.

## Implementation Sequence

1. Add `llmwiki-chat` Quickstart panel using existing source/runtime discovery.
2. Add sample source reuse/test support.
3. Add e2e matrix coverage for local, global, graph, and multi-source flows.
4. Add read-only quickstart status API to `llmwiki-agent-bridge`.
5. Add managed sample source start/reuse support after the setup API exists.
6. Add user wiki path support.
7. Add optional Hermes/DeepAgents install/start flows.
8. Add cache/metrics visibility for runtime prefix cache and bridge/serve cache.

## Open Questions

- Should managed processes be owned by `llmwiki-agent-bridge` or a separate
  local supervisor?
- Should local wiki path selection use a browser file picker, typed path, or a
  native helper?
- How should multiple concurrently served wiki sources be named and stopped?
- Which runtime install flows are acceptable for Windows, Linux, and remote DGX
  setups?
- Should quickstart be exposed in production builds by default or hidden behind
  a local setup mode?
