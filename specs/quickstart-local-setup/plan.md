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
12. Loop 3: broaden the rubric from Quickstart-only MVP to whole first-screen
    progressive disclosure across the default chat, sidebar, inspector/right
    rail, answer-review, runtime, and Local I/O surfaces.
13. Loop 3: keep the first viewport calm by default: source readiness and asking
    are primary; Quickstart is opt-in; Graph, Pages, Details, add-runtime, and
    raw/debug log details wait for explicit user action.
14. Loop 3: stage the first expansions in source-first order:
    - Knowledge Sources / Add source / source retry,
    - inspect source map / review sources,
    - Agent Runtime selection,
    - add-runtime and advanced runtime setup.
15. Loop 3: make the inspector/right rail progressive by hiding Graph, Pages,
    and Details before inspect, then auto-revealing Details after citation
    clicks and updating Details after page/graph selections inside the opened
    inspector.
16. Loop 3: preserve the complete serve-only path and ensure advanced runtime
    disclosure stays optional across Quickstart, sidebar/runtime cards,
    inspector-adjacent prompts, and answer/run details.
17. Loop 3: keep Local I/O logging default-on and redacted, but make it less
    debug-forward in the first viewport while preserving opt-out, clear, copy,
    export, and recovery affordances.
18. Loop 3: update focused tests, docs, and screenshots after implementation
    lands; score Loop 3 only from code, test, screenshot, and safety evidence.

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

Loop 3 implementation surfaces:

- `src/App.tsx`
- `src/styles.css`
- `src/App.test.tsx`
- `e2e/chat.spec.ts`
- `README.md`
- `docs/assets/llmwiki-chat-workbench.png`
- `specs/quickstart-local-setup/spec.md`
- `specs/quickstart-local-setup/plan.md`
- `specs/quickstart-local-setup/tasks.md`
- `specs/quickstart-local-setup/tests.md`
- `specs/quickstart-local-setup/rubric.md`

## Risks

- The panel must not imply that the static browser app can install packages or
  start processes.
- The first-run screen must not imply that a bridge or external LLM endpoint is
  required for basic source/evidence inspection.
- Optional runtime setup must not crowd the source-first path.
- Source-first sidebar order must not hide runtime configuration for users who
  need a real bridge or external runtime.
- Accessibility scans should cover the default app shell, inspector-open,
  runtime-expanded, Local I/O-open, and Quickstart states; keep manual
  screen-reader validation as a follow-up rather than an automated gate.
- The matrix should stay runnable in default local CI without external model
  credentials.
- Loop 3 must not hide the inspection model so deeply that source evidence feels
  unavailable; the inspect action and citation actions need obvious labels and
  automatic reveal behavior, while `Review sources` remains a source-management
  path.
- Collapsing add-runtime and debug/log surfaces must not remove required safety
  controls such as Local I/O opt-out/clear/export or runtime URL warnings.
- First-viewport screenshot/docs updates must keep Graph, Pages, Details, raw
  logs, private paths, tokens, and private endpoint values out of public assets.
- No new ADR is expected for Loop 3 if the work stays presentation-only and
  preserves the existing browser quickstart and Local I/O logging boundaries.
