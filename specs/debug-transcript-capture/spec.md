# Debug Transcript Capture

## Problem

Debugging answer behavior sometimes requires seeing the raw user prompt and
assistant answer. The default redacted turn audit intentionally omits those
values, so a separate opt-in capture surface is needed.

## Goals

- Provide explicit local debugging visibility for raw prompt/answer pairs.
- Keep raw transcript capture off by default.
- Store captured text only in current-tab React memory.
- Clear captured entries on opt-out and chat reset.

## Non-goals

- No server-side transcript logging.
- No localStorage or sessionStorage persistence.
- No request/response body dump, headers, source URLs, runtime URLs, tokens, or
  provider/model secrets.

## Requirements

- UI must expose an explicit `Raw debug transcript` toggle.
- Disabled state must not collect raw prompt/answer entries.
- Enabled state may display raw prompt/answer for the current tab only.
- Browser storage must not contain captured raw transcript text.

## Compatibility

The debug transcript is a local development/debugging aid and is not part of the
runtime request contract.
