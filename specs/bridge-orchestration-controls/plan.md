# Plan

1. Add a domain type for bridge orchestration mode and store it on
   `AgentConnection`.
2. Default bridge runtime registrations and persisted restore paths to
   `delegated-runtime`.
3. Render a bridge-only selector in runtime card setup.
4. Include `orchestrationMode` plus `mode` in bridge run arguments only.
5. Update runtime adapter docs and README wording to distinguish transport from
   orchestration.
6. Add focused runtime payload and App UI/storage tests.

## Affected files

- `src/domain.ts`
- `src/agentRuntimes.ts`
- `src/App.tsx`
- `src/agentRuntimes.test.ts`
- `src/App.test.tsx`
- `docs/agent-runtime-adapters.md`
- `README.md`

## Risks

- `mode` already appears in bridge transport metadata; keep orchestration mode
  as a separate request/runtime config field.
- Avoid showing the selector for arbitrary non-bridge runtimes that merely have
  bridge-like card metadata.
- Keep persisted config free of bearer tokens and runtime discovery results.
