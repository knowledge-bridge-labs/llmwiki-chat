# Tests

## Unit coverage

- `src/agentRuntimes.test.ts`
  - Bridge A2A request payload includes selected `orchestrationMode` and `mode`.
  - Bridge MCP request payload includes selected `orchestrationMode` and `mode`.
  - Non-bridge custom A2A request payload does not include either field.
- `src/App.test.tsx`
  - Selector is visible for Agent Bridge runtimes.
  - Selector is hidden for Local Development Runtime and Custom A2A.
  - User selection persists with runtime config and is used in a bridge run.

## E2E

The bridge multi-turn harness is reused as a default-mode regression check. It
does not need a new fixture for this slice because unit tests cover the explicit
selector and payload values.

## Validation commands

```sh
npm run typecheck
npm run lint
npx vitest run src/agentRuntimes.test.ts src/App.test.tsx
npm run test:e2e:bridge-multiturn
npm run build
git diff --check
```

`npm run check` remains the full release gate. For this scoped change, the
directly affected type, lint, unit, bridge e2e, build, and diff checks are the
required minimum.
