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
