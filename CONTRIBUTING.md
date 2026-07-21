# Contributing

Thanks for helping improve LLMWiki Chat.

This project is being prepared for public OSS collaboration. Keep changes small,
reviewable, and explicit about how they affect Agent Runtime adapters,
LLMWiki-compatible Knowledge Source endpoint protocols, and the UI flows that
connect them.

## Usage Modes to Preserve

Changes should keep both supported usage modes clear and working:

1. `llmwiki-serve` end-to-end: the client connects to a local or hosted
   `llmwiki-serve` HTTP, MCP-style JSON-RPC, or A2A-style message endpoint.
2. External Agent Runtime console: the client connects to an externally managed
   Agent Runtime, while LLMWiki-compatible Knowledge Source endpoints connect
   separately through HTTP, MCP-style JSON-RPC, or A2A-style message Knowledge
   Source endpoint protocol adapters. The client acts as the console for source
   selection, traces, citations, and graph context.

Do not collapse these into a single assumed deployment model. PRs that affect
setup, endpoint compatibility, runtime adapters, or UI flows should state which
mode is affected.

Treat Agent Runtimes and Knowledge Sources as separate integration surfaces.
This repository is the console that lets a user choose sources and a runtime; it
does not ship or operate a production runtime for them. Hermes, DeepAgents, and
Copilot are external Agent Runtime slots; Copilot is modeled as an external
candidate for agents that consume MCP-style JSON-RPC or A2A-style message tool
surfaces, not as a built-in integration. This repository does not currently
include product-specific validation or a validated built-in Copilot adapter.

## Development Setup

Run the chat client against a separate `llmwiki-serve` process when validating
the end-to-end LLMWiki flow. Start the server from the `llmwiki-serve` project
with a wiki folder:

```bash
uv sync --extra dev
uv run llmwiki-serve serve ./examples/sample-wiki --host 127.0.0.1 --port 8765
```

Then start this client:

```bash
npm ci
npm run dev
```

Use Node.js 22.12 or newer and npm 10 or newer. The package metadata and CI both
target the Node 22 line.

The default knowledge source is `http://127.0.0.1:8765`. Use the Knowledge
Sources panel to test that endpoint or add additional development endpoints.

For External Agent Runtime console work, start the client with `npm run dev`,
configure the non-sensitive development runtime under Agent Runtime, then add
Knowledge Source endpoints through the Knowledge Sources panel and select the
matching Knowledge Source endpoint protocol. Do not commit endpoint values, auth
material, screenshots, or logs that expose private infrastructure or sensitive
data.

For Hermes, DeepAgents, or generic OpenAI-compatible local runtime bridge
workflows, run the separate `llmwiki-agent-bridge` companion service from a
sibling checkout or npm package. This repository should not reintroduce an
embedded bridge implementation, bridge binary, or bridge-specific test script.
Configure the bridge with `LLMWIKI_AGENT_BRIDGE_BASE_URL`,
`LLMWIKI_AGENT_BRIDGE_MODEL`, and `LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE`. Use
`LLMWIKI_AGENT_BRIDGE_SOURCE_POLICY` and
`LLMWIKI_AGENT_BRIDGE_ALLOWED_SOURCE_ORIGINS` for server-side source access
policy. If the bridge requires browser callers to authenticate, set
`LLMWIKI_AGENT_BRIDGE_BEARER_TOKEN` in the bridge process and enter that value
as the runtime bearer token in `llmwiki-chat`.

For adapter development, `Mock Agent` is available as a local development
runtime and appears in the UI as `Local Development Runtime`. It is not a
benchmark for production answer quality. Today, production answer quality can be
evaluated through `Custom A2A` against an external A2A-style runtime. Hermes
and DeepAgents should be documented as A2A-style named runtime slots, not
fully validated product integrations. Copilot should remain an external runtime
candidate for agents that consume MCP-style JSON-RPC or A2A-style message tool
surfaces, not a built-in implementation. Generic A2A cards should use
`Custom A2A`; named slots should become ready only when the runtime card
identity matches the selected slot.

If the matching `llmwiki-serve` change is not ready yet, keep UI and tool-flow
development moving with `Mock Agent`, then rerun the same scenario against a
real serve endpoint with `npm run test:e2e:live` before claiming HTTP,
MCP-style JSON-RPC, or A2A-style message Knowledge Source endpoint
compatibility. The live script can start two sibling `llmwiki-serve` sample
endpoints for multi-source provenance coverage, or you can point it at one or
more already running endpoints.

## Contribution Flow

1. Open or find an issue for reproducible bugs, focused feature requests, or
   documentation gaps. Follow `SECURITY.md` for suspected vulnerabilities.
2. Work on a topic branch and keep the diff scoped to the issue or PR goal.
3. Update tests and docs when endpoint behavior, adapter behavior, setup, or user
   flows change.
4. Fill out the pull request template, including affected usage mode, runtime or
   endpoint impact, validation, and security/data-handling checks.
5. Respond to review by pushing follow-up commits. Do not rewrite unrelated
   project history or revert changes outside your PR scope.

For substantial or ambiguous changes, open an issue or discussion first and get
agreement on the direction before investing in a large pull request. Examples
include new Agent Runtime contracts, new Knowledge Source protocol behavior,
large UI workflow changes, authentication changes, release automation, or any
change that expands the supported deployment model.

Maintainers may close low-effort, unverified, or mostly generated issues and PRs
when they do not include a clear problem statement, implementation rationale, and
reproducible validation. AI-assisted contributions are welcome, but contributors
remain responsible for understanding, testing, and maintaining the change.

## Pull Requests

- Keep changes focused and explain the user-facing behavior or maintenance need.
- Use the pull request template and fill in the validation checklist honestly.
- Add or update tests for behavior changes.
- Update `README.md`, `CHANGELOG.md`, `docs/agent-runtime-adapters.md`, or
  related docs when setup, endpoint contracts, agent behavior, or user workflows
  change.
- Document whether the change affects Hermes or DeepAgents named A2A slots,
  Copilot as an external runtime candidate for agents that consume MCP-style
  JSON-RPC or A2A-style message tool surfaces, `Mock Agent`, `Custom A2A`,
  HTTP, MCP-style JSON-RPC, A2A-style message endpoints, `llmwiki-serve`
  end-to-end usage, External Agent Runtime console usage, Knowledge Source
  endpoint protocol behavior, or docs only.
- Do not commit secrets, credentials, token caches, local environment files,
  private endpoint exports, raw sensitive logs, or generated artifacts that are
  not meant to ship.
- Follow the existing React, TypeScript, and CSS patterns in the repository.
- Follow `CODE_OF_CONDUCT.md` in all project spaces.

## Quality Checks

Run these baseline checks before opening a pull request. They mirror
`package.json` and the CI workflow:

```bash
npm run check
```

For focused local iteration, the same gate expands to:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run test:e2e:a2a-runtime
npm run build
npm run pack:dry-run
npm audit --audit-level=moderate
```

For Knowledge Source endpoint compatibility changes, also run the opt-in live
smoke test against a real `llmwiki-serve` endpoint and report a non-skipped
summary:

```bash
npm run test:e2e:live
```

The script looks for `LLMWIKI_SERVE_ROOT`, `LLMWIKI_LIVE_SERVE_ROOT`, or a
sibling `../llmwiki-serve` checkout. It syncs that checkout with `uv`, starts
two `examples/sample-wiki` servers on free loopback ports, waits for `/health`,
and passes them to Playwright as `LLMWIKI_LIVE_SERVE_URL` and
`LLMWIKI_LIVE_SERVE_URL_2`. To use one or more already running endpoints
instead, set `LLMWIKI_LIVE_SERVE_URL=http://127.0.0.1:8765` or
`LLMWIKI_LIVE_SERVE_URLS=url1,url2`; the script will not start local servers and
will preserve any provided `LLMWIKI_LIVE_SERVE_URL_2` or
`LLMWIKI_LIVE_SERVE_URLS`. Set `LLMWIKI_LIVE_SERVE_SINGLE_SOURCE=1` only when a
single local source smoke is intentional.

`npm run test:e2e` uses Playwright. If Chromium is missing locally, run:

```bash
npx playwright install chromium
```

When Playwright fails locally, inspect `playwright-report/index.html` and
`test-results/` for traces, screenshots, and failure attachments. In GitHub
Actions, open the failed `ci` run and download the `playwright-report` artifact
from the run summary. Do not commit `playwright-report/`, `test-results/`, or
`artifacts/`.

Run `npm run pack:dry-run` to remove `dist/`, rebuild the production output, and
confirm the npm package contains only the production build, public docs, and
release metadata. Normal `npm pack` and `npm publish` also run that clean
release build through `prepack`; do not publish with lifecycle scripts disabled.
Do not ship tests, Playwright traces, local artifacts, private files, or GitHub
workflow internals in the package.

Direct Playwright runs of `e2e/live-serve.spec.ts` still skip when neither
`LLMWIKI_LIVE_SERVE_URL` nor `LLMWIKI_LIVE_SERVE_URLS` is set.
Endpoint-compatibility PRs should use the package script above or explicit
external URL env vars and report a non-skipped Playwright result.

For documentation-only changes, say which checks were not run and why in the
pull request. Do not invent validation results.

GitHub Actions run the same package-script quality gates in `ci.yml`. Additional
repository checks include dependency review for manifest and workflow changes,
Dependabot update PRs, and CodeQL analysis for JavaScript/TypeScript security
scanning once the repository is public. Private repositories skip those optional
GitHub-security jobs unless maintainers enable the required GitHub settings.

## Adapter and Endpoint Contributions

- Treat `llmwiki-chat` as the UI and console for external runtimes. Do not assume
  the client owns production answer composition unless the adapter contract says
  so.
- Keep Knowledge Source endpoint protocol changes separate from Agent Runtime
  support claims. A working HTTP, MCP-style JSON-RPC, or A2A-style message
  source adapter does not mean Hermes, DeepAgents, Copilot, or any other runtime
  is product-validated.
- Keep `Mock Agent` changes limited to development ergonomics, local testing, and
  trace rendering. Do not position mock output as the expected answer-quality
  baseline.
- Do not add client-side keyword or if/else intent classifiers for routing user
  questions. Runtime adapters should pass selected source descriptors and tool
  descriptions to the Agent Runtime so the runtime decides which tools to call.
- Treat `Custom A2A` as the generic external Agent Runtime path for cards that
  do not identify a named runtime slot. Hermes and DeepAgents share the A2A
  runtime contract as named slots. Copilot is an external runtime candidate for
  agents that consume MCP-style JSON-RPC or A2A-style message tool surfaces and
  also requires matching runtime identity. Do not describe any of them as
  product-validated integrations until they have dedicated adapter contracts and
  validation.
- For HTTP, MCP-style JSON-RPC, or A2A-style message changes, document the
  Knowledge Source endpoint contract and compatibility impact in the PR.
- If an adapter needs authentication, document the configuration surface and
  validation approach without including real values, private URLs, request logs,
  credentials, or screenshots that expose sensitive data.

See [docs/agent-runtime-adapters.md](docs/agent-runtime-adapters.md) for the
runtime model this repository documents.

## Release Notes

Keep `CHANGELOG.md` current for notable user-facing, setup, compatibility,
security, or documentation changes. See [docs/release.md](docs/release.md) before
publishing a versioned release.

## Issues

Use public issues for reproducible bugs, focused feature requests, and
documentation gaps. For suspected security vulnerabilities, follow `SECURITY.md`
instead of opening a public issue.

For support routing and answer-quality report expectations, see `SUPPORT.md`.
