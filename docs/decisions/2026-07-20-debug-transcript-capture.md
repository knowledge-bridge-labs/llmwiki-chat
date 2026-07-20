# ADR: Opt-in Debug Transcript Capture

## Status

Accepted.

## Context

The redacted turn audit is safe for routine UI inspection because it excludes
prompts, answers, endpoint URLs, tokens, and other sensitive data. Debugging
model behavior can still require raw prompt and answer visibility.

## Decision

`llmwiki-chat` supports raw transcript capture only as an explicit current-tab
UI option. It is off by default, stores prompt/answer pairs in React memory
only, and clears captured entries when disabled or when the chat is reset.

The app must not write raw transcripts to localStorage, sessionStorage, console
logs, bridge/server logs, request payload extensions beyond the runtime
conversation contract, or package artifacts.

## Consequences

- Local debugging can inspect the raw prompt/answer without weakening default
  operational logging.
- Raw transcript state is lost on refresh, tab close, opt-out, or reset.
- Server-side audit remains redacted and count-based.

## Links

- Spec: `specs/debug-transcript-capture/`
- Runtime conversation spec: `specs/multi-turn-runtime-conversation/`
