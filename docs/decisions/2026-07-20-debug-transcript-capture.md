# ADR: Default Browser-Local I/O Logging

## Status

Accepted. Supersedes the earlier opt-in, memory-only raw debug transcript
decision.

## Context

The redacted turn audit remains safe for routine UI inspection because it
excludes prompts, answers, endpoint URLs, tokens, and other sensitive data.
However, debugging bridge/runtime behavior often requires seeing the actual
prompt, runtime request body, assistant answer or error, and response metadata.
`llmwiki-chat` is a static browser app, so it cannot write arbitrary local
server files for debugging.

## Decision

`llmwiki-chat` provides default-on Local I/O logging as a browser-local
debugging surface. Recent log entries are stored in localStorage as bounded
JSONL and shown in a visible `Local I/O log` panel.

Each entry may include the user prompt, header-free runtime request payload
body/summary, assistant answer or error, response metadata, timestamps, and
turn/thread/session identifiers. The panel provides copy, export, and clear
controls. The `Local I/O logging` toggle is checked by default; disabling it
opts out, clears stored raw entries, and suppresses future raw logging until it
is re-enabled.

Authorization headers are never included in local log events. Before
persistence, the client redacts bearer tokens, API-key shaped values, sensitive
token fields, raw URLs, URL query secrets, and private local path shapes.

## Consequences

- Local debugging works in static-app deployments without server file writes.
- Prompt, answer, and runtime request details intentionally persist in this
  browser by default, bounded by retention and protected by local opt-out/clear
  controls.
- The redacted turn audit remains separate and does not become a raw transcript
  store.
- Users should clear or opt out of Local I/O logging before shared-device use,
  demos, or screenshots that should not expose raw prompt/answer content.

## Links

- Spec: `specs/debug-transcript-capture/`
- Runtime conversation spec: `specs/multi-turn-runtime-conversation/`
