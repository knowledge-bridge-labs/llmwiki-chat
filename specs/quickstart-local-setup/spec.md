# Quickstart Local Setup

## Problem

First-run users can open `llmwiki-chat` before the local `llmwiki-serve` sample
source or `llmwiki-agent-bridge` is running. The UI exposes source and runtime
controls, but it does not provide a single safe checklist that explains what the
browser can verify and what must run in a trusted local shell.

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

## Non-goals

- No browser-side shell execution, package installation, process management, or
  persistent local service supervisor.
- No Hermes or DeepAgents installer automation.
- No new runtime payload contract.
- No server-side transcript persistence.

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

## Compatibility

This is UI-only and additive. Existing saved source and runtime settings remain
compatible. Runtime request bodies and source endpoint requests are unchanged.
