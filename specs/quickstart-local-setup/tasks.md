# Tasks

- [x] Add quickstart panel and actions.
- [x] Add unit coverage for panel rendering and safe actions.
- [x] Add Playwright coverage for quickstart visibility.
- [x] Make Quickstart opt-in rather than default-rendered in the empty state.
- [x] Make the current quickstart source-first and progressively disclose
      runtime/bridge setup only after source readiness.
- [x] Make Local Development Runtime the fresh default runtime while preserving
      persisted user selections.
- [x] Add source failure/retry guidance and serve-only skip/close actions.
- [x] Move bridge, Hermes, DeepAgents, and generic runtime guidance behind
      optional advanced setup.
- [x] Add first-time-user rubric scoring for the quickstart flow.
- [x] Add sample matrix metadata coverage.
- [x] Add sample matrix multi-source global query flow.
- [x] Update quickstart docs and release wording.
- [x] Run typecheck, unit tests, focused e2e tests, and full `npm run check` for
      the current quickstart loop.

## Loop 2

- [x] Render Knowledge Sources before Agent Runtime in the left sidebar.
- [x] Rename the runtime management section to visible `Agent Runtime` and ARIA
      `Agent runtime` while preserving bridge runtime card names and
      bridge-specific docs.
- [x] Add explicit optional bridge failure recovery text for failed local bridge
      checks.
- [x] Add unit coverage for sidebar order, runtime section naming, and mocked
      bridge 404 recovery.
- [x] Add Playwright coverage for mocked bridge 404 recovery and 500px Step 1
      command overflow.
- [x] Add focused quickstart axe scans for default/open/mobile/advanced states
      after `@axe-core/playwright` installed cleanly.
- [x] Refresh README demo screenshot with the source-first sidebar and Agent
      Runtime label.
- [x] Stabilize Custom A2A/source URL and long-prompt test setup after full
      validation exposed `user.type` URL interleaving in jsdom.
- [x] Run Loop 2 focused validation commands and full `npm run check`.

## Loop 3

- [x] Record Loop 3 first-screen progressive disclosure scope in spec, plan,
      tests, and rubric without claiming implementation completion.
- [x] Keep the default first screen and first viewport calm: source readiness,
      ask box, and compact opt-in actions are primary.
- [x] Ensure Graph, Pages, and Details are not shown by default before the
      explicit inspect action or citation action.
- [x] Keep Knowledge Sources and source retry/add flows as the first expansion
      path before Agent Runtime configuration.
- [x] Keep Agent Runtime add-runtime controls collapsed until an explicit
      add/configure runtime action.
- [x] Preserve the Quickstart source-first flow and `llmwiki-serve` Step 1.
- [x] Preserve a complete serve-only Local Development Runtime path with no
      bridge, Hermes, DeepAgents, or external LLM endpoint required.
- [x] Make advanced runtime disclosure consistent across Quickstart, sidebar,
      runtime cards, inspector-adjacent prompts, and answer/run details.
- [x] Auto-reveal the inspector/right rail Details view for citations, and keep
      page/graph selections updating Details after the inspector is open, with a
      clear mobile back path to the answer.
- [x] Keep failure recovery non-blocking for source, bridge/runtime,
      citation/detail, and Local I/O states.
- [x] Keep Local I/O logging default-on and redacted, but less debug-forward in
      the default first viewport while retaining opt-out, clear, copy, and export
      controls.
- [x] Add focused unit/Playwright coverage for default hidden inspector panels,
      staged source/runtime expansions, collapsed add-runtime, inspector reveal,
      citation/details auto-reveal, responsive layout, and accessibility.
- [x] Refresh README/docs/screenshots after implementation lands and verify they
      do not expose private paths, tokens, raw logs, or endpoint secrets.
- [x] Run Loop 3 full `npm run check` release gate after focused validation.

## Loop 4

- [x] Add a first-user operational state matrix for app-only/no services,
      missing serve, serve-only ready, bridge absent, accidental unready
      advanced runtime selection, Local I/O opt-out/clear, unavailable
      citation/detail evidence, and live serve.
- [x] Update the rubric with a numeric Loop 4 operational readiness gate that
      preserves the Loop 3 progressive disclosure score as 99/100 but requires
      additional operational evidence before production-default first-time
      approval.
- [x] Add acceptance commands for the cold-start no-services e2e and live serve
      e2e.
- [x] Land or confirm the isolated cold-start no-services e2e evidence.
- [x] Run and record the cold-start no-services e2e command:
      `npx playwright test e2e/chat.spec.ts --grep "cold-start no-services"`
      (4 passed).
- [x] Align live serve e2e with the progressive inspector model and stable
      source display-name behavior.
- [x] Harden `scripts/run-live-serve-e2e.mjs` to start the synced
      `llmwiki-serve` executable directly and pass explicit local CORS origins.
- [x] Run and record the live serve e2e command:
      `LLMWIKI_LIVE_SERVE_SKIP_SYNC=1 npm run test:e2e:live` (8 passed in the
      local Windows dev run; clean release gate remains `npm run test:e2e:live`).
- [x] Add live citation auto-reveal coverage from a hidden inspector and
      cold-start advanced-runtime accident recovery coverage.
- [x] Run and record the full Loop 4 release gate:
      `npm run check` (passed).
- [x] Score Loop 4 operational readiness only after the cold-start, live serve,
      and full release-gate commands select the intended tests where applicable
      and pass.
- [x] Mark Loop 4 complete only after the operational evidence is present and
      the rubric score meets the Loop 4 gate.
