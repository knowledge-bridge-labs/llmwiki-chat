# Tests

## Unit coverage

- `src/agentRuntimes.test.ts`
  - `readBridgeKnowledgeSourcePage(...)` calls bridge `/mcp` JSON-RPC
    `tools/call` with `llmwiki_read`, `sourceId`, and `pageId`.
  - The helper normalizes bridge read payloads with markdown/text, title, path,
    and source refs into `KnowledgePage`.

## App coverage

- `src/App.test.tsx`
  - A bridge-managed page preview uses bridge MCP `llmwiki_read`.
  - The browser does not fetch the private bridge-managed source `/read/...`
    URL for that preview.

## Validation commands

```sh
npm run typecheck
npm run lint
npx vitest run src/agentRuntimes.test.ts src/App.test.tsx
git diff --check
```

Run `npm run test:e2e:bridge-multiturn` when the sibling
`llmwiki-agent-bridge` and `llmwiki-serve` checkouts are available and the local
harness can start them.

This slice ran the bridge multiturn e2e harness successfully.
