# Changelog

All notable changes to LLMWiki Chat will be documented here.

This project follows a lightweight changelog format until versioned releases
begin. Dates use `YYYY-MM-DD`.

## Unreleased

- _No changes yet._

## 0.1.1 - 2026-07-21

- Refined the first-run experience so Quickstart stays opt-in, source readiness
  appears before optional runtime/bridge setup, and Graph/Pages/Details remain
  behind explicit inspection or citation actions.
- Added operational first-user gates for cold-start/no-services, missing
  `llmwiki-serve`, serve-only readiness, advanced-runtime recovery, Local I/O
  visibility, citation/detail recovery, and live `llmwiki-serve` evidence.
- Hardened live `llmwiki-serve` E2E startup on Windows by using the synced local
  executable when available and passing explicit local CORS origins.
- Kept the main ask button neutral (`Ask selected source` / `Ask selected
  sources`) so sample wiki titles do not read like product-specific primary
  actions.

## 0.1.0 - 2026-07-21

- Added tokenless npm Trusted Publishing release workflow and documentation for
  the first public npm package.
- Added CODEOWNERS for the planned Knowledge Bridge Labs maintainer team and
  hardened the automated PR review guide's changed-file rendering.
- Polished the README first screen with badges, public-preview status,
  cross-repo toolchain positioning, and a clearer what/what-not/how-it-works
  overview.
- Split Hermes, DeepAgents, and generic OpenAI-compatible bridge workflows out
  to the separate `llmwiki-agent-bridge` companion package; `llmwiki-chat` no
  longer packages, tests, or documents an embedded bridge binary.
- Added a usage-question issue form so public support routing works while blank
  issues remain disabled.
- Added a README demo screenshot generated from a live local `llmwiki-serve`
  sample source and `llmwiki-chat` dev server.
- Updated maintainer and vulnerability-reporting wording so public governance
  routes point at Knowledge Bridge Labs without temporary transfer language.
- Expanded third-party notices with direct runtime dependency ranges, licenses,
  and upstream homes.
- Made package dry-runs and normal npm pack/publish lifecycle packaging rebuild
  a clean `dist/` immediately before the package is assembled so stale local
  build output cannot ship.
- Persist user-defined Knowledge Source connections locally, merge the starter
  sample source on startup, and block asking until every selected source is
  ready.
- Collapsed ready Knowledge Source setup controls and add-source forms by
  default, moved protocol/latency metadata behind details, and removed mobile
  source-management scroll traps.
- Reframed the first-run chat surface around the selected LLMWiki source, with
  runtime and local endpoint details kept as supporting metadata.
- Added a Details-panel `Write question` flow that drafts a page-scoped question
  into the main composer without auto-running it, preserving user review before
  an agent call.
- Tightened mobile first-viewport density so the source-first opening screen
  keeps the composer visible on phone-sized layouts.
- Added a reusable `npm run pack:dry-run` package gate and CI check so release
  candidates verify npm tarball contents after building.
- Simplified citation Details so the primary evidence stays visible while source
  refs and related graph context are tucked behind focused disclosures.
- Improved mobile navigation so the first keyboard focus starts in the chat
  workflow, source management sits below the answer workspace, and inline
  citation buttons have descriptive accessible labels.
- Polished the first-run knowledge map so users write an explicit question
  before asking, inspect pages instead of raw node terminology, and see clearer
  empty-state and disabled-action styling.
- Added self-contained fresh-clone quickstart guidance for local
  `llmwiki-serve` setup, prerequisites, `npm ci`, LAN dev-server binding, and
  npm package inclusion of linked docs and community files.
- Improved first-run chat UX with an empty composer, mobile answer-start reveal,
  citation detail return path, and restrained scroll affordances.
- Added Agent Runtime URL validation: external runtimes now require public HTTPS
  URLs, with loopback HTTP(S) reserved for local development and private-network
  or other special-use IPv4/IPv6 targets blocked.
- Validate A2A Knowledge Source agent-card message URLs with a source-specific
  policy so Agent Runtime private development overrides do not permit unsafe
  Knowledge Source redirects.
- Added regression coverage for rendered markdown answers, including links,
  code blocks, GFM tables, and sanitized unsafe HTML from external runtimes.
- Added answer-scope and inspector-scope UI so users can distinguish the latest
  answer evidence graph from the currently selected source graph.
- Added and documented the opt-in live `llmwiki-serve` Playwright smoke gate for
  HTTP, MCP, and A2A source compatibility claims. The live smoke runs only when
  `LLMWIKI_LIVE_SERVE_URL` is set.
- Added a Playwright Custom A2A smoke that talks to a real local test runtime
  process while keeping external runtime Knowledge Source URL policy intact.
- Added fresh-clone quickstart guidance and Playwright artifact lookup for local
  and CI failures.
- Limited npm package contents to the production build and public release
  documents.
- Clarified that `Local Development Runtime` is the UI label for the `Mock
  Agent` development adapter.
- Added public PR operating guidance for substantial changes, prior discussion,
  and low-effort or unverified generated contributions.
- Clarified that `Mock Agent` and `Custom A2A` are the direct runtime paths, while
  Hermes and DeepAgents are A2A-compatible named runtime slots and Copilot is an
  external runtime candidate for agents that consume MCP-style JSON-RPC or
  A2A-style message tool surfaces; none are product-validated yet.
- Documented the Agent Runtime versus Knowledge Source boundary, including that
  Copilot is not a validated built-in adapter in this repository.
- Clarified the two supported usage modes: `llmwiki-serve` end-to-end usage and
  External Agent Runtime console usage with separate Knowledge Source endpoint
  protocol configuration for LLMWiki-compatible HTTP, MCP-style JSON-RPC, or
  A2A-style message endpoints.
- Documented that `Mock Agent` is a development adapter, not the production
  answer-quality baseline.
- Documented the mock-first development flow for in-progress `llmwiki-serve`
  work and the `LLMWIKI_LIVE_SERVE_URL` opt-in live E2E smoke command.
- Added support routing, ownership hints, and grouped dependency maintenance for
  public PR-based collaboration.
- Added repository/package metadata, Node/npm baseline documentation, stricter
  live E2E validation wording, security fallback routing, and dependency notice
  cleanup for public release hygiene.
- Expanded contribution and GitHub issue/PR templates for OSS collaboration
  readiness.
- Added an Agent Runtime adapter contract, validation expectations, and a
  lightweight release checklist for public PR-based development.
- Added GitHub workflow and dependency maintenance configuration for public
  collaboration readiness.
- Added an Agent Runtime query flow where a selected runtime uses selected
  LLMWiki knowledge sources as tools.
- Added agent status, tool call trace, citations, and graph/detail continuity in
  the chat UI.
- Documented local `llmwiki-serve` integration and OSS contribution checks.
- Initial React client for querying served LLMWiki knowledge graphs.
- Added connection inventory, Markdown answers, citation chips, graph overview,
  node list, and details panel.
- Added CI quality gates for lint, typecheck, unit tests, E2E tests, build, and
  dependency audit.
