# Plan

1. Add a browser-safe quickstart entry point to the empty chat state.
2. Keep the quickstart panel hidden by default until the user explicitly opens
   it.
3. Make the opened quickstart source-first:
   - Step 1 tests `llmwiki-serve`,
   - Step 2 appears only after source readiness,
   - Local Development Runtime / serve-only inspection is the default path.
4. Move `llmwiki-agent-bridge`, Hermes, DeepAgents, and generic runtime guidance
   behind an optional advanced disclosure with skip/close recovery.
5. Wire panel actions to existing source discovery, bridge discovery, and runtime
   selection logic.
6. Document the browser/process boundary in an ADR and maintain a first-time-user
   scoring rubric.
7. Extend unit and Playwright coverage for default-hidden, staged rendering,
   source failure guidance, serve-only continuation, optional bridge guidance,
   and overflow.
8. Harden the sample graph matrix with explicit fixture/query class coverage and
   a multi-source UI query case.
9. Loop 2: make the persistent sidebar source-first by rendering Knowledge
   Sources before Agent Runtime, and rename the runtime management section from
   Agent Bridge to Agent Runtime while preserving bridge card names/docs.
10. Loop 2: add explicit optional bridge failure recovery copy after failed
    local bridge checks.
11. Loop 2: extend focused unit/e2e coverage for sidebar order, runtime section
    naming, bridge recovery, mobile command overflow, and quickstart
    accessibility evidence.

## Affected files

- `src/App.tsx`
- `src/styles.css`
- `src/App.test.tsx`
- `e2e/chat.spec.ts`
- `e2e/live-a2a-runtime.spec.ts`
- `e2e/sample-graph-matrix.spec.ts`
- `scripts/run-sample-graph-matrix-e2e.mjs`
- `docs/quickstart-orchestration-plan.md`
- `README.md`
- `docs/decisions/2026-07-21-browser-quickstart-boundary.md`
- `specs/quickstart-local-setup/rubric.md`

## Risks

- The panel must not imply that the static browser app can install packages or
  start processes.
- The first-run screen must not imply that a bridge or external LLM endpoint is
  required for basic source/evidence inspection.
- Optional runtime setup must not crowd the source-first path.
- Source-first sidebar order must not hide runtime configuration for users who
  need a real bridge or external runtime.
- Accessibility scans should stay focused on the quickstart states; if they
  become noisy or large, keep role/focus/overflow evidence and schedule a
  manual screen-reader pass.
- The matrix should stay runnable in default local CI without external model
  credentials.
