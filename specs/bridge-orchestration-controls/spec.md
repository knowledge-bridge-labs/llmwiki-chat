# Bridge Orchestration Controls

## Problem

`llmwiki-agent-bridge` supports per-request orchestration modes, but
`llmwiki-chat` only exposes bridge transport/runtime selection. Users cannot
choose whether a bridge run should be evidence-only, delegated-runtime, or
hybrid from the chat UI.

## Goals

- Add a bridge-only orchestration mode selector.
- Default bridge orchestration to `delegated-runtime`.
- Persist the selected non-secret mode with runtime config.
- Send the selected mode only to Agent Bridge runs.
- Keep bridge-managed sources read-only in chat.
- Clarify that runtime transport/mode is separate from bridge orchestration.

## Non-goals

- No managed quickstart or local process automation.
- No source registration, editing, or deletion writes from chat.
- No changes to `llmwiki-agent-bridge`.
- No package version change.
- No bearer token or provider secret persistence.

## Requirements

- The selector is visible for Agent Bridge runtimes only:
  `bridge-a2a` and `bridge-mcp`.
- The selector is hidden for Local Development Runtime, Custom A2A, Hermes,
  DeepAgents, Copilot, and other non-bridge runtime slots.
- Supported values are `evidence-only`, `delegated-runtime`, and `hybrid`.
- Existing saved runtime config without a mode restores as
  `delegated-runtime` for bridge runtimes.
- Runtime request payloads for bridge A2A and bridge MCP include
  `orchestrationMode` and compatibility alias `mode`.
- Non-bridge runtime payloads do not include `orchestrationMode` or `mode`.

## Compatibility

This is additive. Existing persisted runtime configs remain readable. Bearer
token storage behavior is unchanged: runtime bearer tokens stay in tab memory
only and are not serialized.
