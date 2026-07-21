# Bridge-Managed Source Detail Reads

## Problem

Bridge-managed Knowledge Sources are discovered from `llmwiki-agent-bridge`
and are read-only in `llmwiki-chat`. Page detail previews currently rebuild a
direct source connection from the graph snapshot and call the source endpoint
from the browser. That can bypass bridge source policy and fails for private
sources that are only reachable from the bridge process.

## Goals

- Route page/detail preview reads for bridge-managed sources through the owning
  Agent Bridge MCP `llmwiki_read` tool.
- Keep direct/non-bridge source previews on the existing direct adapter path.
- Preserve bridge source ownership metadata in graph/page preview snapshots.
- Fail clearly when the owning bridge runtime is unavailable or not ready.
- Keep bridge-managed source cards read-only.

## Non-goals

- No bridge writes, source registration, editing, or deletion from chat.
- No quickstart process automation or managed bridge/source launch behavior.
- No changes to `llmwiki-agent-bridge`.
- No package version change.
- No screenshot updates.

## Requirements

- A focused helper in `src/agentRuntimes.ts` calls bridge MCP `tools/call` with
  `name: "llmwiki_read"` and source/page identifiers.
- The helper accepts bridge `pageId`/`page_id` response compatibility and
  returns the normal `KnowledgePage` shape.
- App page preview snapshots include bridge source metadata when present.
- Bridge-managed page previews find the owning bridge agent by metadata and use
  the bridge helper.
- Missing, unready, or URL-less bridge runtimes produce a user-facing preview
  error instead of trying the source URL.
- Direct sources continue to use `clientFor(connection).readPage(...)`.

## Compatibility

This changes only bridge-managed source detail reads. Direct source behavior,
runtime answer requests, bridge orchestration mode, bearer token handling, and
persisted source/runtime config shapes remain unchanged.
