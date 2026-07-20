# Quickstart Local Setup

## Problem

First-run users can open `llmwiki-chat` before the local `llmwiki-serve` sample
source or `llmwiki-agent-bridge` is running. The UI exposes source and runtime
controls, but it does not provide a single safe checklist that explains what the
browser can verify and what must run in a trusted local shell.

## Goals

- Add one visible quickstart entry point in the empty chat state.
- Detect and display current sample source and local bridge readiness from
  existing connection state.
- Provide copyable commands for starting `llmwiki-serve` and
  `llmwiki-agent-bridge`.
- Reuse existing source and runtime test buttons instead of introducing an
  unsafe browser process launcher.
- Keep Hermes and DeepAgents as explicit runtime choices after the bridge/source
  path is understood.
- Preserve the Local Development Runtime as the deterministic fallback for UI
  and graph/citation checks.

## Non-goals

- No browser-side shell execution, package installation, process management, or
  persistent local service supervisor.
- No Hermes or DeepAgents installer automation.
- No new runtime payload contract.
- No server-side transcript persistence.

## Requirements

- The quickstart panel must state that the browser cannot start local services.
- It must expose commands for:
  - serving a local wiki with `llmwiki-serve`,
  - starting `llmwiki-agent-bridge`.
- It must provide actions to:
  - restore and test the default sample source,
  - select and test the local bridge,
  - switch to Local Development Runtime for deterministic UI checks.
- It must not store secrets or local absolute paths.
- It must remain accessible from keyboard and screen-reader flows.

## Compatibility

This is UI-only and additive. Existing saved source and runtime settings remain
compatible. Runtime request bodies and source endpoint requests are unchanged.
