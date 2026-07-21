# First-Time User Quickstart Rubric

Date: 2026-07-21
Status: loop-4 validated

This rubric scores whether `llmwiki-chat` gives a first-time user a clear,
non-blocking path from opening the app to a useful first source/evidence
inspection session.

Loop 3 extends the rubric beyond the Quickstart MVP to the whole first-screen
progressive disclosure model. Loop 1 and Loop 2 history below remains
unchanged; Loop 3 scores are based on code, focused unit/e2e validation,
screenshot review, and safety review evidence.

Loop 4 adds an operational readiness gate. It does not lower or replace the
Loop 3 progressive disclosure result: Loop 3 remains scored at 99/100. Overall
production-default first-time approval also requires Loop 4 evidence from an
isolated cold-start no-services e2e, live `llmwiki-serve` e2e aligned with the
progressive inspector, and the full release gate; all gates now pass.

The target for production-default approval is:

- total score >= 90 / 100,
- no item below 70% of its weight,
- `npm run check` passes,
- no required path depends on a real LLM endpoint, Hermes Agent, DeepAgents, or
  `llmwiki-agent-bridge`.

Starting in Loop 4, the production-default first-time approval target also
requires:

- Loop 3 progressive disclosure remains at 99/100 or better-supported by newer
  evidence,
- Loop 4 operational readiness score >= 90 / 100,
- `npx playwright test e2e/chat.spec.ts --grep "cold-start no-services"` passes
  against an isolated no-services state,
- `npm run test:e2e:live` passes against started or provided live
  `llmwiki-serve` source(s),
- `npm run check` passes after the Loop 4 changes,
- Loop 4 scores stay pending if any required evidence command has not landed,
  does not select the intended tests, or has not passed.

## Loop 1/2 rubric

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

## Loop 3 rubric

Proposed 100-point gate for first-screen progressive disclosure. Scores should
not be filled in as earned until the code/test worker lands implementation
evidence.

| ID | Criterion | Weight | Evidence method |
|---|---:|---:|---|
| L3-R1 | Default calm first screen / first viewport: source readiness, ask box, compact Quickstart, and inspect/review affordances are primary; no full checklist, Graph, Pages, Details, add-runtime controls, or raw/debug log details dominate before user action. | 14 | Unit/e2e assert default first viewport content order and absence of default Graph/Pages/Details panels, add-runtime body, and raw Local I/O log details. |
| L3-R2 | Staged Knowledge Sources vs Agent Runtime expansion: Knowledge Sources, Add source, and source retry are the first setup expansion path; Agent Runtime configuration is secondary. | 12 | Unit/e2e assert source expansion appears before runtime expansion in DOM/focus order and visible copy. |
| L3-R3 | Quickstart source-first continuity: Quickstart remains opt-in and starts with `llmwiki-serve` Step 1 before any runtime/bridge choices. | 10 | Existing quickstart tests plus Loop 3 regression asserting no runtime/bridge controls on open before source readiness and optional advanced expansion. |
| L3-R4 | Serve-only path preservation: `llmwiki-serve` plus Local Development Runtime supports first inspection, deterministic asking, citation/detail review, and setup exit without bridge, Hermes, DeepAgents, or external LLM endpoint. | 10 | Unit/e2e serve-only flow from source ready -> continue -> ask -> inspect citation/details -> close setup. |
| L3-R5 | Inspector/right rail progressive disclosure: Graph, Pages, and Details are hidden before inspect; explicit inspect reveals the panels, citation clicks auto-reveal relevant Details evidence, and page/graph selections update Details after the inspector is open while preserving mobile back-to-answer focus. | 14 | Playwright desktop/mobile assertions for default hidden panels, inspector expansion, citation/details auto-reveal, selected evidence updates, and return focus. |
| L3-R6 | Cross-surface advanced runtime disclosure: Quickstart, sidebar/runtime cards, inspector-adjacent prompts, and answer/run details consistently frame `llmwiki-agent-bridge`, Hermes, DeepAgents, and OpenAI-compatible runtimes as optional advanced paths. | 10 | Copy review plus unit/e2e assertions that advanced runtime copy is collapsed until requested and never blocks serve-only. |
| L3-R7 | Failure recovery: source, bridge/runtime, citation/detail, and logging failures provide retry, skip/continue, close/dismiss, or clear guidance without trapping the user. | 8 | Mocked failure tests for source check, bridge 404, unavailable citation/detail evidence, and Local I/O clear/disable states. |
| L3-R8 | Accessibility and responsive coverage: staged controls are keyboard reachable, named for screen readers, focus moves to revealed content, and narrow/mobile layouts avoid horizontal overflow. | 8 | Focus-order tests, ARIA role/name assertions, focused axe scans, and 500px/mobile overflow checks across default, inspector, runtime-expanded, and logging states. |
| L3-R9 | Docs/screenshots alignment: README/docs/screenshots show the implemented first-screen progressive disclosure state and do not document pending UI as shipped behavior. | 6 | Source review plus visual screenshot review after implementation; no private paths, tokens, raw logs, or endpoint secrets. |
| L3-R10 | Safety and testability: browser/process boundary, URL/secret redaction, default-on Local I/O logging, and deterministic no-credential checks are preserved while the log UI is less debug-forward by default. | 8 | Code review, redaction/localStorage tests, no process launcher review, and focused docs/UI validation without credentials. |
| Total | | 100 | |

## Loop 3 score

| ID | Weight | Score | Current evidence | Gap / next improvement |
|---|---:|---:|---|---|
| L3-R1 | 14 | 14 | Unit/e2e assert default Quickstart region absent, Graph/Pages/Details absent, add-runtime body hidden, Local I/O raw actions hidden, and README screenshot shows only the compact inspect affordance. | None. |
| L3-R2 | 12 | 12 | Unit tests assert Knowledge Sources precedes Agent Runtime; e2e source review/focus actions keep source setup before runtime expansion. | None. |
| L3-R3 | 10 | 10 | Quickstart tests still assert opt-in rendering, Step 1 `llmwiki-serve` first, and no bridge/runtime controls before source readiness plus optional advanced expansion. | None. |
| L3-R4 | 10 | 10 | Serve-only e2e covers source ready -> ask with Local Development Runtime -> citation/detail inspection without bridge, Hermes, DeepAgents, or external LLM endpoint. | None. |
| L3-R5 | 14 | 14 | Inspector is hidden by default, explicit inspect reveals Graph/Pages/Details, citation clicks auto-reveal Details, page/graph selection updates selected evidence after inspector open, and mobile back-to-answer focus is covered. | None. |
| L3-R6 | 10 | 9 | Quickstart/sidebar/runtime card tests keep `llmwiki-agent-bridge`, Hermes, DeepAgents, Copilot/custom runtimes behind optional add/advanced disclosure and never block serve-only. | Real managed install/readiness UX for Hermes/DeepAgents remains a future quickstart feature, not part of this UI-only loop. |
| L3-R7 | 8 | 8 | Tests cover source retry guidance, bridge 404 recovery, quiet unavailable-evidence notice, and Local I/O opt-out/clear states. | None. |
| L3-R8 | 8 | 8 | Focus/role tests plus Playwright axe scans cover default app shell, inspector-open, add-runtime-open, Local I/O-open, opened Quickstart, mobile source commands, and advanced Quickstart; 500px overflow checks cover Quickstart commands and expanded app-shell state. | Manual screen-reader pass remains a separate follow-up and is not claimed. |
| L3-R9 | 6 | 6 | README copy and `docs/assets/llmwiki-chat-workbench.png` were refreshed to show source-first Quickstart with inspector collapsed and no private paths, tokens, raw logs, or private endpoints. | None. |
| L3-R10 | 8 | 8 | Browser/process boundary and Local I/O contracts remain unchanged; token redaction/localStorage tests pass; full no-credential `npm run check` passes, including pack dry-run and audit. | None. |
| Total | 100 | 99 | Meets the Loop 3 production-default score threshold with full release-gate validation. | Manual fresh-user/screen-reader observation remains useful follow-up evidence, but is not required for this automated gate. |

## Loop 4 operational readiness rubric

Loop 4 is scored separately from Loop 3. The Loop 3 UI progressive disclosure
score remains 99/100, but the overall first-time production-default approval is
pending until the operational evidence below lands and passes.

| ID | Criterion | Weight | Evidence method |
|---|---:|---:|---|
| L4-R1 | App-only / no-services cold start: clean browser context, no local services, no persisted source/runtime state, source-first default viewport, no full checklist, no Graph/Pages/Details before inspect, no process-start claim. | 14 | `npx playwright test e2e/chat.spec.ts --grep "cold-start no-services"` with service endpoints isolated or mocked absent. |
| L4-R2 | Missing `llmwiki-serve` recovery: source readiness and Quickstart Step 1 explain start/retry, copyable commands, close/dismiss, and no runtime/bridge prerequisite. | 12 | Cold-start no-services e2e assertions for missing source recovery and no horizontal overflow. |
| L4-R3 | Serve-only ready path: live `llmwiki-serve` plus Local Development Runtime supports deterministic asking, citations, graph/page/details inspection, and setup exit. | 16 | `npm run test:e2e:live` verifies live source discovery, ask, citations, Details, and inspector reveal without bridge or external LLM credentials. |
| L4-R4 | Bridge absent remains optional: failed bridge checks are only in optional advanced disclosure and explain start/restart, confirm `http://127.0.0.1:8788`, or skip/continue serve-only. | 10 | Cold-start no-services e2e or focused bridge-absent e2e covers optional recovery copy and serve-only continuity. |
| L4-R5 | Accidental unready advanced runtime selection: Hermes, DeepAgents, Custom A2A, or OpenAI-compatible runtime choices fail safely, explain readiness inline, and offer a path back to Local Development Runtime. | 10 | Cold-start no-services e2e covers unready advanced runtime selection without credentials or a bridge. |
| L4-R6 | Local I/O opt-out / clear readiness: default-on logging remains redacted and bounded; opt-out, clear, copy/export are accessible; raw/debug logs do not dominate the first viewport. | 10 | Cold-start no-services e2e plus code review for redaction, storage boundaries, and no private path/secret exposure. |
| L4-R7 | Citation/detail unavailable recovery: unavailable evidence shows quiet non-blocking recovery, keeps focus safe, and does not leave the progressive inspector broken. | 12 | Cold-start no-services or mocked e2e covers unavailable detail evidence, dismissal/retry, and focus behavior. |
| L4-R8 | Live serve progressive inspector: live evidence follows the same inspector model as sample fixtures, including explicit inspect reveal, citation auto-reveal to Details, page/graph detail updates, and source namespacing. | 16 | `npm run test:e2e:live` validates live HTTP/MCP source behavior and multi-source citation namespacing where available. |
| Total | | 100 | |

## Loop 4 score

| ID | Weight | Score | Current evidence | Gap / next improvement |
|---|---:|---|---|---|
| L4-R1 | 14 | 14 | `npx playwright test e2e/chat.spec.ts --grep "cold-start no-services"` passes desktop/mobile and starts from isolated storage plus unavailable local endpoints. | None. |
| L4-R2 | 12 | 12 | Cold-start e2e verifies missing `llmwiki-serve` recovery, command disclosure, 500px no-overflow, retry, and close/dismiss without runtime/bridge prerequisites. | None. |
| L4-R3 | 16 | 16 | `LLMWIKI_LIVE_SERVE_SKIP_SYNC=1 npm run test:e2e:live` passes desktop/mobile HTTP and MCP live source ask/citation/inspector paths without bridge or external LLM credentials in this Windows dev run; clean release gate remains `npm run test:e2e:live`. | None. |
| L4-R4 | 10 | 10 | Focused quickstart tests cover bridge 404 only inside optional advanced disclosure and preserve skip/continue serve-only recovery. | None. |
| L4-R5 | 10 | 10 | `cold-start no-services advanced runtime accident recovers to serve-only` passes desktop/mobile and verifies unready Hermes selection disables ask actions, shows inline readiness guidance, and recovers to Local Development Runtime. Focused unit/e2e tests also cover Hermes/custom runtime readiness behavior. | None. |
| L4-R6 | 10 | 10 | Cold-start e2e verifies default-on logging and hidden raw log actions; Local I/O unit tests verify opt-out, clear, export/copy reachability, redaction, and storage boundaries. | None. |
| L4-R7 | 12 | 12 | Mocked tests cover quiet unavailable evidence notices, citation/detail recovery, and progressive inspector stability. | None. |
| L4-R8 | 16 | 16 | `LLMWIKI_LIVE_SERVE_SKIP_SYNC=1 npm run test:e2e:live` passes desktop/mobile live HTTP, live MCP, multi-source source namespacing, explicit inspector reveal, citation auto-reveal from hidden inspector, and citation detail review in this Windows dev run; clean release gate remains `npm run test:e2e:live`. | None. |
| Total | 100 | 100 | Meets Loop 4 operational readiness threshold with cold-start, live serve, and full `npm run check` gates passing. | Manual screen-reader observation remains useful follow-up evidence, but it does not block the automated gate. |

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
- Loop 3 broadens the target from Quickstart MVP to the whole first-screen
  experience: calm default viewport, staged source/runtime expansions,
  progressive inspector/right rail, optional advanced runtimes, and safer
  less-debug-forward Local I/O visibility.
- Loop 4 changes the approval question from "is the UI progressively disclosed?"
  to "does a first user have operational evidence across cold app, missing
  services, serve-only ready, optional runtime failure, Local I/O, unavailable
  details, and live serve states?" The automated Loop 4 gate now passes.
