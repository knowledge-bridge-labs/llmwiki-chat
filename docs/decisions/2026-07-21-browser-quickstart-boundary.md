# ADR: Browser Quickstart Boundary

Date: 2026-07-21
Status: accepted

## Context

`llmwiki-chat` is a browser workbench. Users want a quickstart button that helps
them run `llmwiki-serve`, connect `llmwiki-agent-bridge`, and optionally choose
Hermes or DeepAgents. A static browser app cannot safely install packages, spawn
local services, or read arbitrary local wiki paths without a trusted helper.

## Decision

`llmwiki-chat` provides a browser-safe, opt-in quickstart panel that displays
status, copyable commands, and verification actions. The panel is source-first:
it starts with `llmwiki-serve`, reveals Local Development Runtime / serve-only
continuation after source readiness, and keeps bridge/Hermes/DeepAgents setup in
optional advanced runtime steps. It does not launch local processes or install
runtime frameworks.

Process ownership remains outside the browser:

- `llmwiki-serve` serves the selected wiki folder.
- `llmwiki-agent-bridge` may later expose an explicit local-only setup API for
  managed source/runtime orchestration.
- Hermes, DeepAgents, vLLM, or OpenAI-compatible runtimes own model execution,
  history, and provider credentials.

## Consequences

- The first-run path is clearer without weakening browser safety or implying
  that bridge/runtime setup is required for basic source/evidence inspection.
- A future one-click managed setup requires a local trusted helper or
  `llmwiki-agent-bridge` setup API with allowlisted commands and explicit user
  confirmation.
- Quickstart tests can stay deterministic by using existing source and runtime
  discovery paths.

## Follow-ups

- Design and implement a local-only bridge quickstart API before adding managed
  process start/stop from the UI.
- Add runtime cache/metrics visibility after framework-native Hermes or
  DeepAgents cache behavior is validated.
