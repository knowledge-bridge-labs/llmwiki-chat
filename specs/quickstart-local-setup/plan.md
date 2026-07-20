# Plan

1. Add a browser-safe quickstart panel to the empty chat state.
2. Wire panel actions to existing source discovery, bridge discovery, and runtime
   selection logic.
3. Document the browser/process boundary in an ADR.
4. Extend unit and Playwright coverage for quickstart rendering and actions.
5. Harden the sample graph matrix with explicit fixture/query class coverage and
   a multi-source UI query case.

## Affected files

- `src/App.tsx`
- `src/styles.css`
- `src/App.test.tsx`
- `e2e/chat.spec.ts`
- `e2e/sample-graph-matrix.spec.ts`
- `scripts/run-sample-graph-matrix-e2e.mjs`
- `docs/quickstart-orchestration-plan.md`
- `README.md`
- `docs/decisions/2026-07-21-browser-quickstart-boundary.md`

## Risks

- The panel must not imply that the static browser app can install packages or
  start processes.
- The matrix should stay runnable in default local CI without external model
  credentials.
