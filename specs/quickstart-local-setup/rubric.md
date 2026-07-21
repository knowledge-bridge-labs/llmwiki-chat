# First-Time User Quickstart Rubric

Date: 2026-07-21
Status: loop-2 complete

This rubric scores whether `llmwiki-chat` gives a first-time user a clear,
non-blocking path from opening the app to a useful first source/evidence
inspection session.

The target for production-default approval is:

- total score >= 90 / 100,
- no item below 70% of its weight,
- `npm run check` passes,
- no required path depends on a real LLM endpoint, Hermes Agent, DeepAgents, or
  `llmwiki-agent-bridge`.

## Rubric

| ID | Criterion | Weight | Evidence method |
|---|---:|---:|---|
| R1 | Default first screen is calm, non-blocking, and source-first: no full quickstart checklist is shown until the user opts in, and sidebar order presents Knowledge Sources before Agent Runtime. | 12 | Unit/e2e assert no `Quickstart` region before `Show Quickstart`; unit asserts sidebar region order. |
| R2 | Source-first path: the opened quickstart starts with only `llmwiki-serve` Knowledge Source setup and test guidance. | 16 | Unit/e2e assert Step 1 is visible and runtime/bridge controls are hidden. |
| R3 | Serve-only path: a user with only `llmwiki-serve` can continue with Local Development Runtime / Agent Runtime defaults and inspect evidence without an external LLM endpoint. | 16 | Runtime default test, Agent Runtime section label assertions, quickstart Step 2 assertions, enabled suggested prompt after source readiness. |
| R4 | Optional advanced runtime disclosure: bridge, Hermes, DeepAgents, and OpenAI-compatible runtime guidance are clearly optional and hidden until requested. | 14 | Unit/e2e assert advanced runtime section is collapsed and bridge test appears only after expansion. |
| R5 | Failure recovery and exit: source/bridge failures explain next actions and allow retry, skip, finish, or close without trapping the user. | 12 | Tests assert source retry guidance, mocked bridge 404 recovery guidance, `Skip and close`, and `Continue serve-only`. |
| R6 | Accessibility and responsive layout: keyboard/screen-reader labels are clear and quickstart status/commands do not overflow on desktop or mobile widths. | 10 | ARIA role/name assertions, focused axe scans, and Playwright bounding-box overflow checks. |
| R7 | Documentation and links: README/spec/plan/tests match the UI and links point to reachable public docs. | 10 | Source review of README/spec/docs plus unit/e2e link href assertions. |
| R8 | Testability and safety: checks run without credentials, no browser-side process launch or secret storage is introduced. | 10 | `npm run check`, code review, existing browser boundary ADR. |

## Loop 1 score

| ID | Weight | Score | Current evidence | Gap / next improvement |
|---|---:|---:|---|---|
| R1 | 12 | 12 | `src/App.tsx` gates `QuickstartPanel` behind `quickstartEnabled`; unit/e2e assert default hidden. | None. |
| R2 | 16 | 16 | Step 1 source setup is the first opened panel; opening Quickstart moves focus to the panel; tests assert Step 2 and bridge controls are hidden until source readiness. | None for MVP. |
| R3 | 16 | 16 | Fresh default runtime is Local Development Runtime; Step 2 says no external LLM endpoint is required; tests assert asking is enabled after source readiness. | None for MVP. |
| R4 | 14 | 13 | Advanced runtime disclosure hides bridge/Hermes/DeepAgents until expanded and links to docs. | Future managed setup should detect configured model readiness from bridge status. |
| R5 | 12 | 10 | Source retry guidance, bridge missing guidance, skip/close, and serve-only continuation are present. | Add a dedicated visual state for failed source check if user testing shows the status chip is too subtle. |
| R6 | 10 | 9 | E2E checks quickstart status bounds at desktop and 500px widths; labels use named regions/buttons; unit/e2e assert focus moves to Quickstart when opened. | Manual screen-reader pass remains a follow-up outside the automated MVP gate. |
| R7 | 10 | 10 | Spec/tests/docs are aligned in this loop; UI links use hosted docs/GitHub README; README screenshot was refreshed with the source-first panel; public docs links returned HTTP 200. | None. |
| R8 | 10 | 10 | `npm run check` passes; quickstart still uses existing discovery actions and no process launcher. | None. |
| Total | 100 | 96 | Meets loop-1 production-default threshold. | Next loop should run a fresh-user manual/browser smoke and screen-reader pass. |

## Loop 2 score

| ID | Weight | Score | Current evidence | Gap / next improvement |
|---|---:|---:|---|---|
| R1 | 12 | 12 | Default Quickstart is still opt-in; unit/e2e assert no `Quickstart` region before `Show Quickstart`; unit asserts the sidebar places Knowledge Sources before Agent Runtime. | Score was already capped in Loop 1; Loop 2 improves source-first evidence rather than the numeric score. |
| R2 | 16 | 16 | Step 1 remains `llmwiki-serve` only; runtime/bridge controls remain hidden until source readiness and optional disclosure. | None. |
| R3 | 16 | 16 | Fresh default remains Local Development Runtime; the runtime management section is now labeled Agent Runtime instead of Agent Bridge; serve-only continuation remains enabled after source readiness. | Score was already capped in Loop 1; Loop 2 improves label/default clarity rather than the numeric score. |
| R4 | 14 | 13 | Advanced runtime disclosure still hides bridge/Hermes/DeepAgents until expanded and keeps bridge-specific docs/card names. | Future managed setup should detect configured model readiness from bridge status. |
| R5 | 12 | 12 | Source retry guidance remains; mocked bridge 404 now shows explicit recovery to start/restart `llmwiki-agent-bridge`, confirm `http://127.0.0.1:8788`, or skip/continue serve-only. | Watch first-run feedback for whether bridge recovery should become a persistent checklist item. |
| R6 | 10 | 10 | Role/focus assertions remain; Playwright checks desktop/mobile status bounds and 500px Step 1 command overflow; focused axe scans cover default empty, opened quickstart, mobile command, and advanced states. | Manual screen-reader pass remains a follow-up and was not claimed. |
| R7 | 10 | 10 | Spec/plan/tests/rubric now match Loop 2 sidebar naming, recovery, responsive, and AX evidence; README screenshot was refreshed and visually checked for Knowledge Sources before Agent Runtime. | None. |
| R8 | 10 | 10 | `@axe-core/playwright` is locked as a dev dependency; `npm run check` passes, including audit with 0 vulnerabilities. | Re-run full `npm run check` only if more changes land before release. |
| Total | 100 | 99 | Meets loop-2 production-default threshold without claiming manual screen-reader validation. | Keep manual screen-reader pass and fresh-user smoke as follow-ups. |

## Loop notes

- The first successful user path is now `Show Quickstart` -> `Test sample source`
  -> `Continue serve-only`.
- `llmwiki-agent-bridge`, Hermes, DeepAgents, and external LLM endpoints are
  optional advanced paths, not prerequisites.
- The current MVP remains browser-safe: it shows commands and probes existing
  endpoints; it does not install packages or start processes.
- Loop 2 keeps the persistent sidebar source-first and clarifies that the
  runtime section is for Agent Runtime selection, with Local Development Runtime
  as the default and bridge as optional.
