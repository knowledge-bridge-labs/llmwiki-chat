# Tests

## Acceptance

- Empty state shows a compact `Show Quickstart` entry point, but no Quickstart
  region by default.
- Opening Quickstart moves keyboard focus to the Quickstart region.
- Opening Quickstart first shows only Step 1 source setup for `llmwiki-serve`.
- Step 1 includes browser/process boundary copy, `llmwiki-serve` commands, source
  status, source retry guidance, and `Test sample source`.
- Bridge status, Hermes, DeepAgents, and `llmwiki-agent-bridge` commands are not
  visible in Step 1.
- `Test sample source` restores the default sample source URL and runs the
  existing discovery path.
- Step 2 appears only after the sample source is ready.
- Step 2 makes Local Development Runtime / serve-only inspection the primary
  path and leaves asking enabled without requiring an external LLM endpoint.
- Optional bridge/runtime setup appears only after expanding the advanced
  disclosure.
- Missing bridge/runtime guidance offers install/start docs or skip/close without
  blocking serve-only usage.
- `Skip and close`, `Finish Quickstart`, and `Continue serve-only` leave Local
  Development Runtime selected and hide the panel.
- `Test local bridge` selects the local A2A bridge and runs the existing bridge
  discovery path only from optional advanced setup.
- Quickstart status content stays inside the panel on desktop and mobile widths.
- Sample matrix verifies required fixture/query classes and includes a
  multi-source global query through the chat UI.

## Commands

```sh
npm run typecheck
npx vitest run src/App.test.tsx src/agentRuntimes.test.ts
npx playwright test e2e/chat.spec.ts --grep "quickstart"
npm run check
npm run test:e2e:sample-matrix
npm run test:e2e:sample-matrix:bridge
```

For documentation-only changes in `llmwiki-docs`:

```sh
npm run check
```
