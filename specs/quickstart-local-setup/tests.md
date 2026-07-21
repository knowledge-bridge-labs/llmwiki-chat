# Tests

## Acceptance

- Empty state shows a compact `Show Quickstart` entry point, but no Quickstart
  region by default.
- Sidebar renders `Knowledge Sources` before `Agent Runtime`, and runtime
  management uses the `Agent Runtime` visible heading / `Agent runtime` region
  name.
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
- Failed optional local bridge checks show recovery copy to start/restart
  `llmwiki-agent-bridge`, confirm `http://127.0.0.1:8788`, or
  skip/continue serve-only.
- `Skip and close`, `Finish Quickstart`, and `Continue serve-only` leave Local
  Development Runtime selected and hide the panel.
- `Test local bridge` selects the local A2A bridge and runs the existing bridge
  discovery path only from optional advanced setup.
- Quickstart status content stays inside the panel on desktop and mobile widths.
- Opening the Step 1 `llmwiki-serve` command disclosure at a 500px viewport does
  not create document or quickstart-panel horizontal overflow.
- Opening the inspector, add-runtime disclosure, and Local I/O log together at a
  500px viewport does not create document or app-shell horizontal overflow.
- Focused axe scans cover the default app shell, inspector-open state,
  runtime add disclosure, Local I/O-open state, opened quickstart, mobile
  quickstart with source commands, and advanced runtime quickstart panel.
- Sample matrix verifies required fixture/query classes and includes a
  multi-source global query through the chat UI.

## Loop 3 acceptance

- Default first screen and first viewport show a calm source-first path: selected
  Knowledge Source readiness, ask box, compact `Show Quickstart`, and explicit
  inspect/review affordances are visible without a full setup checklist.
- Default first screen does not show separate `Graph`, `Pages`, or `Details`
  panels before the user chooses `Inspect map, pages, and details` or follows a
  citation action.
- First expansions are staged: Knowledge Sources / Add source / source retry are
  reachable before Agent Runtime configuration, and Agent Runtime setup does not
  interrupt source-first onboarding.
- Agent Runtime add-runtime controls are collapsed by default and remain hidden
  until an explicit add/configure runtime action.
- Quickstart remains source-first: opening it first shows only `llmwiki-serve`
  Step 1, and runtime/bridge controls remain hidden until source readiness plus
  optional advanced expansion.
- Serve-only remains complete: with only `llmwiki-serve` and Local Development
  Runtime, the user can continue, ask a deterministic sample question, inspect
  graph/citation evidence, and close setup without a bridge, Hermes, DeepAgents,
  or external LLM endpoint.
- Inspector expansion is explicit and reversible: `Inspect map, pages, and
  details` reveals the inspector/right rail; citation clicks auto-reveal the
  relevant `Details` evidence; page and graph selections update `Details` after
  the inspector is open. `Review sources` remains a source-management action.
- Citation/details auto-reveal works on desktop and mobile; mobile users can
  return focus to the answer/citation after inspecting Details.
- Advanced runtime disclosure is consistent across Quickstart, sidebar/runtime
  cards, answer/run details, and any inspector-adjacent runtime prompts:
  `llmwiki-agent-bridge`, Hermes, DeepAgents, and OpenAI-compatible runtimes are
  optional advanced paths, not serve-only prerequisites.
- Failure recovery remains non-blocking for failed source checks, missing or
  failed bridge checks, unavailable citation/detail evidence, and Local I/O log
  controls; users can retry, dismiss/close, or continue serve-only.
- Local I/O logging stays default-on, redacted, bounded, and clearable/exportable,
  but its raw/debug details are less debug-forward than source readiness, first
  asking, and inspect affordances in the default first viewport.
- Accessibility coverage includes named collapsed/expanded controls, keyboard
  focus order through staged expansions, focus transfer to revealed inspector
  content, mobile back-to-answer focus, and focused axe scans for default,
  inspector-open, runtime-expanded, and logging states.
- Responsive coverage verifies no horizontal overflow at narrow widths for the
  default first screen, Knowledge Sources expansion, inspector/right rail reveal,
  Quickstart commands, add-runtime disclosure, and Local I/O controls.
- README/docs/screenshots match the implemented progressive disclosure state and
  avoid showing private paths, raw logs, tokens, or private endpoint values.

## Commands

```sh
npm run typecheck
npx vitest run src/App.test.tsx src/agentRuntimes.test.ts
npx playwright test e2e/chat.spec.ts --grep "quickstart|Hermes"
npm run check
npm run test:e2e:sample-matrix
npm run test:e2e:sample-matrix:bridge
```

For documentation-only changes in `llmwiki-docs`:

```sh
npm run check
```

For this Loop 3 docs/rubric worker pass:

```sh
git diff -- specs/quickstart-local-setup/spec.md specs/quickstart-local-setup/plan.md specs/quickstart-local-setup/tasks.md specs/quickstart-local-setup/tests.md specs/quickstart-local-setup/rubric.md
```

Loop 3 implementation validation uses focused unit and Playwright commands for
the acceptance bullets above before re-running the full release gate.
