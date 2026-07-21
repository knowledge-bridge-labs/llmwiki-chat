# Quickstart Local Setup

## Problem

First-run users can open `llmwiki-chat` before the local `llmwiki-serve` sample
source or `llmwiki-agent-bridge` is running. The UI exposes source and runtime
controls, but it does not provide a single safe checklist that explains what the
browser can verify and what must run in a trusted local shell.

Loop 3 extends the first-time user problem beyond the Quickstart MVP. The whole
first screen should feel calm and source-first before any guided setup is opened:
advanced runtime setup, persistent graph/page/detail panels, and debug-forward
Local I/O controls should not compete with the first prompt/source readiness
path. Deeper inspection and runtime configuration remain available, but they
should be revealed only after an explicit inspect, citation, source, runtime, or
logging action.

Loop 4 treats the first screen as an operational first-user path, not another UI
polish pass. The release question is whether a cold browser app and a live
`llmwiki-serve` source both produce clear, recoverable evidence across expected
first-time states before the chat is approved as a production-default entry
point.

## Goals

- Add one visible, opt-in quickstart entry point in the empty chat state.
- Keep the default first-run screen focused on chat/source readiness rather than
  showing a full setup checklist immediately.
- Keep the left sidebar source-first by presenting Knowledge Sources before
  Agent Runtime controls.
- Present the quickstart as a progressive source-first flow:
  1. connect/test `llmwiki-serve`,
  2. continue with Local Development Runtime / serve-only inspection,
  3. optionally expand bridge/runtime setup.
- Detect and display current sample source readiness from existing connection
  state before showing runtime/bridge choices.
- Provide copyable commands for starting `llmwiki-serve`; keep
  `llmwiki-agent-bridge` commands inside optional advanced runtime setup.
- Reuse existing source and runtime test buttons instead of introducing an
  unsafe browser process launcher.
- Keep `llmwiki-agent-bridge`, Hermes, and DeepAgents as optional advanced
  runtime choices after the source/serve-only path is understood.
- Preserve the Local Development Runtime as the deterministic fallback for UI
  and graph/citation checks.
- Loop 3: make the default first viewport calm by showing source readiness,
  question entry, and one or two obvious next actions before Graph, Pages,
  Details, advanced runtime setup, or debug logging details.
- Loop 3: stage first expansions so Knowledge Sources/source actions appear
  before Agent Runtime actions, and Agent Runtime add-runtime controls stay
  collapsed until the user explicitly asks to add or configure a runtime.
- Loop 3: make the inspector/right rail progressive: Graph, Pages, and Details
  should not be visible by default before inspection, but explicit inspect,
  citation clicks, and page/graph selection inside the inspector should reveal
  or update the relevant details automatically.
- Loop 3: preserve the source-first Quickstart, serve-only Local Development
  Runtime path, and optional advanced runtime disclosure across Quickstart,
  sidebar, inspector, and answer-review surfaces.
- Loop 3: keep Local I/O logging default-on and safe, while making raw/debug log
  controls less prominent in the first viewport and still easy to find, disable,
  clear, copy, or export when needed.
- Loop 4: validate first-time operational states with isolated no-services
  cold-start evidence and live `llmwiki-serve` evidence aligned with the
  progressive inspector model.

## Non-goals

- No browser-side shell execution, package installation, process management, or
  persistent local service supervisor.
- No Hermes or DeepAgents installer automation.
- No new runtime payload contract.
- No server-side transcript persistence.
- Loop 3 does not remove Graph, Pages, Details, citations, run details, or Local
  I/O logging; it changes when first-time users encounter those surfaces.
- Loop 3 does not change source, runtime, citation, trace, logging, storage, or
  network contracts.
- Loop 4 is not a new UI polish loop and does not introduce new service
  supervision, installer automation, runtime contracts, source contracts, or
  security policy changes.

## Requirements

- The quickstart panel must not render by default on an empty first-run screen;
  the user must explicitly open it.
- The left sidebar must render the Knowledge Sources section before runtime
  management.
- The runtime management section must use visible and ARIA labels of
  "Agent Runtime" / "Agent runtime"; bridge runtime card names and
  bridge-specific advanced docs remain bridge-specific.
- The quickstart panel must state that the browser cannot start local services.
- Step 1 must focus only on serving/testing a `llmwiki-serve` Knowledge Source.
- If Step 1 is not ready, the UI must explain how to start/retry
  `llmwiki-serve` and how to close Quickstart without being blocked.
- Step 2 must appear only after a source is ready.
- Step 2 must make the serve-only / Local Development Runtime path the default
  path and state that no LLM endpoint, Hermes Agent, DeepAgents install, or
  bridge is required for basic source/evidence inspection.
- Bridge, Hermes, DeepAgents, and generic OpenAI-compatible runtime guidance
  must be hidden behind an optional advanced disclosure.
- Advanced runtime guidance must include next actions for a missing bridge:
  install/start `llmwiki-agent-bridge`, read docs, or skip/continue serve-only.
- If the optional local bridge check fails, advanced runtime guidance must say
  to start or restart `llmwiki-agent-bridge`, confirm
  `http://127.0.0.1:8788`, or skip/continue serve-only.
- It must expose commands for serving a local wiki with `llmwiki-serve`.
- It must provide actions to:
  - restore and test the default sample source,
  - continue/finish Quickstart with Local Development Runtime,
  - optionally select and test the local bridge from the advanced section.
- It must not store secrets or local absolute paths.
- It must remain accessible from keyboard and screen-reader flows.
- The Step 1 `llmwiki-serve` command disclosure must not create horizontal
  overflow in the quickstart panel at a 500px viewport width.

### Loop 3 first-screen progressive disclosure

- The default first screen and first viewport must emphasize the selected
  Knowledge Source, ask box, and compact `Show Quickstart` / inspect affordances.
- The default first screen must not show separate Graph, Pages, or Details panels
  until the user chooses the explicit inspect action or follows a citation.
  Page/graph selection updates Details after the inspector has been opened.
- Knowledge Sources expansion must remain the first setup expansion path; Agent
  Runtime setup must remain secondary.
- Agent Runtime add-runtime controls must be collapsed by default and revealed
  only after an explicit add/configure runtime action.
- The Quickstart path must remain source-first and must still start with
  `llmwiki-serve` before runtime or bridge choices.
- The serve-only path must remain complete: a user with only `llmwiki-serve` and
  the Local Development Runtime can inspect source evidence, ask deterministic
  sample questions, review citations, and close setup without configuring a
  bridge or external LLM endpoint.
- Advanced runtime disclosure must be consistent wherever it appears: Quickstart,
  sidebar/runtime cards, answer/run details, and any inspector-adjacent runtime
  prompts must describe bridge, Hermes, DeepAgents, and OpenAI-compatible
  runtimes as optional advanced paths.
- Citation clicks should auto-reveal the inspector/right rail to the relevant
  Details evidence, and page/graph selections should update Details after the
  inspector is open. Narrow/mobile screens must provide a clear way back to the
  answer after citation inspection.
- Source, bridge/runtime, citation/detail, and logging failures must explain
  recovery actions without trapping the user or making advanced runtime setup a
  prerequisite for serve-only work.
- Local I/O logging must remain default-on with redaction, retention, clear,
  copy, export, and opt-out controls, but raw log details should not be more
  prominent than source readiness, first asking, or inspection affordances in the
  default first viewport.
- Accessibility and responsive coverage must include keyboard focus order,
  named regions/buttons, collapsed/expanded states, mobile inspector reveal/back
  flows, and no horizontal overflow at narrow widths.
- README/docs/screenshots must match the implemented first-screen disclosure
  model and avoid showing private paths, tokens, raw logs, or endpoint secrets.

### Loop 4 first-user operational evidence

Loop 4 acceptance is based on observable first-user states. It is scored only
from isolated cold-start no-services evidence, focused failure/recovery tests,
and live `llmwiki-serve` evidence.

| First-user state | Expected behavior | Required evidence |
|---|---|---|
| App-only / no services | The browser app loads without local services, keeps Quickstart opt-in, prioritizes source readiness and asking, and does not imply that the browser can start processes. | Cold-start no-services e2e asserts the default screen, source-first copy, no full checklist, no visible Graph/Pages/Details panels, and no bridge/runtime prerequisite. |
| `llmwiki-serve` missing | Source readiness and Quickstart Step 1 explain how to start/retry `llmwiki-serve`; Step 2 and runtime/bridge choices do not become prerequisites; the user can close setup without being trapped. | Cold-start no-services e2e mocks or verifies missing source recovery, retry, close/dismiss, and no horizontal overflow. |
| Serve-only ready | With only `llmwiki-serve` ready, Local Development Runtime remains sufficient for deterministic asking, citation review, graph/page/detail inspection, and setup exit. | Live serve e2e validates source discovery, deterministic ask, citation/detail reveal, and inspector behavior without bridge, Hermes, DeepAgents, or external LLM credentials. |
| Bridge absent | Optional bridge checks may fail, but the UI frames bridge setup as advanced and recoverable: start/restart, confirm `http://127.0.0.1:8788`, or skip/continue serve-only. | Focused quickstart e2e covers absent bridge recovery from optional advanced runtime disclosure after source readiness. |
| Advanced runtime selected accidentally / unready | If a user selects Hermes, DeepAgents, Custom A2A, or another unready runtime by mistake, prompts and suggested questions explain the inline readiness issue and leave a path back to Local Development Runtime. | Cold-start no-services e2e covers an unready Hermes selection and recovery to Local Development Runtime; focused unit/e2e tests also cover unready Hermes/custom runtime selection without credentials or a running bridge. |
| Local I/O opt-out / clear | Local I/O remains default-on, redacted, bounded, clearable/exportable, and opt-out capable without making raw/debug logs more prominent than source readiness and inspection affordances. | Cold-start no-services e2e verifies first-viewport prominence; Local I/O unit tests verify opt-out, clear, redaction, and storage boundaries. |
| Citation/detail unavailable | Missing citation or detail evidence produces a quiet, non-blocking notice and recovery path; the progressive inspector does not open into a broken or trapping state. | Mocked unit/e2e coverage verifies unavailable detail evidence and quiet non-blocking behavior. |
| Live serve path | A real `llmwiki-serve` HTTP/MCP source drives the same progressive inspector path used by the sample UI: inspect is explicit, citations auto-reveal details from a hidden inspector, and source namespacing remains intact. | `npm run test:e2e:live` passes in clean environments; this Windows development run used `LLMWIKI_LIVE_SERVE_SKIP_SYNC=1 npm run test:e2e:live` because the sibling serve virtualenv was already synced and executable-locked. |

## Compatibility

This is UI-only and additive. Existing saved source and runtime settings remain
compatible. Runtime request bodies, source endpoint requests, citation payloads,
trace shapes, and Local I/O log event shapes are unchanged. Loop 4 is expected
to require no ADR unless the operational evidence exposes a contract or security
policy change.
