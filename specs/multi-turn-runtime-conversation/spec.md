# Multi-turn Runtime Conversation

## Problem

`llmwiki-chat` kept prior turns only in browser UI state while runtime calls
sent the current question as `data.query`. Follow-up questions therefore lost
conversation continuity at the bridge/runtime boundary.

## Goals

- Keep legacy `data.query` in every runtime request.
- Add A2A-compatible current-turn `data.message` with `messageId`,
  `contextId`, text parts, and `metadata.llmwiki` identifiers.
- Add OpenAI/LangChain-compatible bounded `data.messages` history.
- Include stable current-tab `threadId`, `sessionId`, and per-turn `turnId`.
- Preserve selected Knowledge Source and tool descriptors unchanged.

## Non-goals

- No custom lossy summary context.
- No prompt-cache implementation in the browser.
- No server-side transcript persistence. Browser-local raw I/O logging is a
  separate default-on debugging surface with bounded retention, opt-out, clear
  controls, and redaction.
- No keyword intent classifier or source preselection based on query text.

## Requirements

- Runtime payload must include the current query, A2A message, bounded messages,
  thread/session/turn identifiers, runtime context, selected sources, and tools.
- Message history must exclude empty messages and remain bounded.
- Resetting chat must create a new thread/context id.
- Existing query-only-compatible runtimes must continue to receive `data.query`.

## Compatibility

This is additive. Existing bridge and custom A2A runtimes can ignore unknown
`message`, `messages`, and conversation metadata fields.
