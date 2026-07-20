# Tests

## Acceptance

- Empty state shows a Quickstart region with command snippets and current
  source/bridge status.
- `Test sample source` restores the default sample source URL and runs the
  existing discovery path.
- `Test local bridge` selects the local A2A bridge and runs the existing bridge
  discovery path.
- `Use Local Development Runtime` selects the deterministic runtime without
  making a network/runtime call.
- Sample matrix verifies required fixture/query classes and includes a
  multi-source global query through the chat UI.

## Commands

```sh
npm run typecheck
npx vitest run src/App.test.tsx
npx playwright test e2e/chat.spec.ts --grep "quickstart"
npm run test:e2e:sample-matrix
npm run test:e2e:sample-matrix:bridge
```

For documentation-only changes in `llmwiki-docs`:

```sh
npm run check
```
