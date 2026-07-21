# Default Local I/O Logging

## Problem

Debugging bridge/runtime behavior in a static browser workbench requires seeing
the prompt, runtime request payload, assistant answer or error, and response
metadata. Browser apps cannot write arbitrary server files, and the redacted
turn audit intentionally omits raw prompt/answer and payload details.

## Goals

- Provide default-on, browser-local I/O visibility for local debugging.
- Persist recent log entries in localStorage as bounded JSONL.
- Include user prompt, runtime request body/summary, assistant answer or error,
  response metadata, timestamps, and turn/thread/session identifiers.
- Expose an easy `Local I/O logging` opt-out toggle plus copy/export/clear
  controls.
- Redact Authorization headers, bearer tokens, API-key shaped values, sensitive
  token fields, raw URLs, URL query secrets, and private local path shapes before
  persistence.

## Non-goals

- No server-side transcript logging.
- No unbounded browser storage growth.
- No persistence of API keys, bearer tokens, Authorization headers, provider
  secrets, or credential-bearing URL components.
- No replacement for the separate redacted turn audit.

## Requirements

- UI must expose a checked-by-default `Local I/O logging` toggle.
- Enabled state must write bounded JSONL entries to browser-local storage.
- Disabled state must stop future raw logging and clear stored raw entries.
- Clear control must remove persisted local I/O entries.
- Stored entries must retain enough request payload shape to debug A2A
  `message:send` and MCP `tools/call` runs without storing transport headers.
- Credential/token canaries must be absent from persisted entries after
  sanitizer processing.

## Compatibility

Local I/O logging is a browser-local development/debugging aid and is not part
of the runtime request contract. The runtime payload remains unchanged except
for an internal client event used by the UI to log the already-prepared request
body without Authorization headers.
