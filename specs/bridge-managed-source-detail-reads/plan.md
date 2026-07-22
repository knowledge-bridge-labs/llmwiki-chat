# Plan

1. Add a bridge detail-read helper in `src/agentRuntimes.ts` using the existing
   bridge MCP JSON-RPC helper.
2. Reuse page normalization behavior for bridge `llmwiki_read` payloads,
   including markdown/text aliases.
3. Extend graph/page preview source snapshots with bridge ownership metadata.
4. Route `readPageForSource` through the bridge helper when a source is
   bridge-managed, with explicit unavailable-bridge errors.
5. Add focused helper and App tests.
6. Update README and runtime adapter docs.

## Affected files

- `src/agentRuntimes.ts`
- `src/agents.ts`
- `src/App.tsx`
- `src/serveClient.ts`
- `src/agentRuntimes.test.ts`
- `src/App.test.tsx`
- `README.md`
- `docs/agent-runtime-adapters.md`
- `docs/decisions/2026-07-22-bridge-managed-detail-reads.md`

## Risks

- Bridge MCP tool response shapes may differ between bridge versions; keep
  normalization tolerant of `structuredContent.llmwiki_read`, direct page
  payloads, and content-part JSON.
- Avoid cache collisions between direct and bridge-managed reads that share the
  same source URL.
- Do not expose or fetch private bridge-managed source URLs from the browser.
