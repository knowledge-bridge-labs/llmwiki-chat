# ADR: Bridge-Managed Detail Reads Stay Behind The Bridge

Date: 2026-07-22
Status: accepted

## Context

Bridge-managed Knowledge Sources are registered and selected in
`llmwiki-agent-bridge`, then discovered by `llmwiki-chat` through the bridge MCP
`llmwiki_list_sources` tool. Their source URLs may be private, policy-gated, or
reachable only from the bridge host. Rebuilding a direct browser source
connection for page previews bypasses that bridge ownership boundary.

## Decision

For bridge-managed Knowledge Sources, `llmwiki-chat` reads page/detail previews
through the owning bridge runtime's MCP `llmwiki_read` tool. Direct source cards
continue to use the existing direct source adapters. If the owning bridge
runtime is missing, not ready, or has no URL, chat shows a clear preview error
and does not fall back to the source URL.

## Consequences

- Bridge source access policy remains centralized in `llmwiki-agent-bridge`.
- Private bridge-managed sources no longer need browser reachability for page
  previews.
- Direct `llmwiki-serve` debugging remains available through direct source
  cards.
- Bridge-managed source writes and registration remain out of scope for chat.

## Follow-ups

- Add bridge-mediated graph/neighborhood detail reads only if a future slice
  needs them.
- Keep bridge MCP read payload normalization aligned with bridge releases.
