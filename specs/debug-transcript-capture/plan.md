# Plan

1. Replace opt-in memory-only debug transcript state with default-on local I/O
   logging state and an opt-out preference.
2. Store bounded JSONL entries in localStorage and keep the visible panel usable
   from React state when localStorage is unavailable.
3. Emit header-free runtime request payload log events from A2A and MCP runtime
   adapters.
4. Persist sanitized prompt, request body/summary, answer/error, metadata,
   timestamps, and turn/session identifiers.
5. Add visible copy/export/clear controls and clear stored raw entries on
   opt-out.
6. Keep the redacted turn audit and raw local I/O log visibly separate.
7. Add tests for default persistence, opt-out suppression, clear behavior,
   redaction canaries, and existing multi-turn behavior.
