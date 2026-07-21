# LLMWiki Chat Quickstart Orchestration Plan

Status: MVP implemented for browser-guided setup; managed local process
automation remains follow-up
Owner: llmwiki-chat / llmwiki-agent-bridge / llmwiki-serve
Last updated: 2026-07-21

## Implemented Browser-Safe MVP

The current first-run path works from `llmwiki-chat` through one opt-in,
source-first Quickstart panel. The MVP is browser-guided: it shows safe commands
and runs source/runtime probes after the user starts local services in a trusted
shell. It does not install packages, launch local processes, read arbitrary
local wiki paths, or register sources with a backend helper from browser-only UI
code.

Implemented success means:

1. the empty chat state shows a compact `Show Quickstart` entry point instead of
   rendering the full panel by default,
2. the panel makes the browser/process boundary explicit,
3. Step 1 shows only `llmwiki-serve` sample usage and source readiness,
4. the user can test the prefilled local sample source after starting
   `llmwiki-serve`,
5. Step 2 appears only after source readiness and makes Local Development
   Runtime / serve-only inspection the default path,
6. `llmwiki-agent-bridge@0.1.0`, Hermes, DeepAgents, and generic
   OpenAI-compatible runtime guidance appear only inside optional advanced
   runtime setup,
7. missing bridge/runtime setup can be skipped without blocking serve-only use,
8. chat entry is enabled only through the existing source/runtime readiness
   checks.

## Future Managed Quickstart Goal

A future managed quickstart may make the button feel like "start LLMWiki", but
process launching, installation, source registration, and privileged local
operations must be handled by a local trusted helper, not by browser-only UI
code. That future flow should:

1. detect local `llmwiki-agent-bridge` and `llmwiki-serve` status,
2. show commands for starting a default sample wiki when no source is configured,
3. allow the user to select a local wiki path,
4. register that source with the bridge,
5. verify the runtime/source path with smoke tests,
6. enter chat with working grounded answers.

## Product Flow

Implemented MVP flow:

```text
Open llmwiki-chat
→ Optionally open Quickstart
→ Step 1: start or reuse llmwiki-serve in a trusted shell
→ Test sample source
→ Step 2: continue serve-only with Local Development Runtime
→ Optional: expand bridge/runtime setup and test llmwiki-agent-bridge
→ Start chat when existing readiness checks pass
```

Future managed flow:

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

The future managed quickstart should present runtime choices in this order:

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
| `llmwiki-chat` | Implemented: opt-in source-first Quickstart panel, browser/process boundary copy, copyable commands, existing source/runtime probe actions, Local Development Runtime serve-only path, optional bridge/runtime disclosure, local log display, user choices. Future: calls to a trusted local setup API. |
| `llmwiki-agent-bridge` | Implemented: external A2A-style bridge runtime and bridge-managed source discovery when already running. Future: local setup API, runtime/source settings, verification, safe command orchestration. |
| `llmwiki-serve` | Serve selected wiki source, expose source bundle/query/graph endpoints |
| Hermes / DeepAgents / vLLM | Runtime execution, native history/prompt/prefix cache |

`llmwiki-chat` must not directly run arbitrary shell commands. Future managed
automation should call a local-only setup surface exposed by a trusted helper.

## Future Local Setup API

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

## Implemented MVP Scope

The implemented MVP avoids installer automation. It only reuses installed tools
and provides a reliable browser-guided local path:

- detect bridge status,
- show commands for sample `llmwiki-serve`,
- show the package command for `llmwiki-agent-bridge@0.1.0`,
- test the selected sample source,
- reveal serve-only Local Development Runtime continuation after source readiness,
- show and test the local bridge only from optional advanced setup,
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

## Future Managed Success Criteria

The following are future managed quickstart success criteria, not current
browser-safe MVP claims:

1. bridge `/health` returns ready runtime/source status,
2. serve `/health` and `/source-bundle` return valid metadata,
3. bridge source registry includes the selected source,
4. bridge `/message:send` returns a completed answer,
5. local I/O logs capture redacted request/response flow,
6. user can send a follow-up and conversation history reaches the runtime.

## Implementation Sequence

Implemented:

1. Add `llmwiki-chat` Quickstart panel using existing source/runtime discovery.
2. Add sample source reuse/test support.
3. Add e2e matrix coverage for local, global, graph, and multi-source flows.

Future:

1. Add read-only quickstart status API to `llmwiki-agent-bridge`.
2. Add managed sample source start/reuse support after the setup API exists.
3. Add user wiki path support.
4. Add optional Hermes/DeepAgents install/start flows.
5. Add cache/metrics visibility for runtime prefix cache and bridge/serve cache.

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
