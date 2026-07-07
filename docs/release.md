# Release Notes and Checklist

LLMWiki Chat uses a lightweight release process while public PR-based
development matures. There is no fixed release cadence documented here.

## Changelog

Keep notable user-facing, compatibility, setup, security, and documentation
changes in `CHANGELOG.md` under `Unreleased` until maintainers prepare a
versioned release.

Release notes should call out affected usage modes, Agent Runtime adapters, and
Knowledge Source endpoint protocols, especially `llmwiki-serve` end-to-end
usage, External Agent Runtime console usage, and HTTP, MCP-style JSON-RPC, or
A2A-style message compatibility changes. Do not claim an external runtime is
supported unless the runtime is registered as `ready`, has validation coverage,
and has clear setup documentation.

## Release Checklist

Before publishing a versioned release:

1. Move `CHANGELOG.md` `Unreleased` entries into a versioned section with a
   `YYYY-MM-DD` date, then create a fresh `Unreleased` section.
2. Run the baseline public validation gates:

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

3. For Knowledge Source endpoint compatibility claims, smoke test against a real
   local `llmwiki-serve` endpoint using each affected protocol:

   ```bash
   npm run test:e2e:live
   ```

   The package script can start two sample endpoints from a sibling
   `llmwiki-serve` checkout, or use `LLMWIKI_SERVE_ROOT`/
   `LLMWIKI_LIVE_SERVE_ROOT` when the checkout is elsewhere. It passes both
   `LLMWIKI_LIVE_SERVE_URL` and `LLMWIKI_LIVE_SERVE_URL_2` so multi-source
   provenance, citation, and graph namespacing coverage runs by default. To test
   one or more already running endpoints, set
   `LLMWIKI_LIVE_SERVE_URL=http://127.0.0.1:8765` or
   `LLMWIKI_LIVE_SERVE_URLS=url1,url2`; the script will not start local servers
   and will preserve any provided `LLMWIKI_LIVE_SERVE_URL_2` or
   `LLMWIKI_LIVE_SERVE_URLS`. Direct Playwright runs of `e2e/live-serve.spec.ts`
   still skip unless `LLMWIKI_LIVE_SERVE_URL` or `LLMWIKI_LIVE_SERVE_URLS` is
   set, so treat an all-skipped live run as not validated. For external runtime
   changes, run `npm run test:e2e:a2a-runtime` for the local real-process A2A
   protocol smoke.
   Also smoke test against a non-sensitive externally managed development runtime
   when claiming production runtime behavior.
4. If Playwright fails locally, inspect `playwright-report/index.html` and
   `test-results/`. If CI fails, open the failed `ci` run and download the
   `playwright-report` artifact from the run summary before deciding whether the
   failure is a release blocker.
5. Confirm README, CONTRIBUTING, adapter docs, and issue/PR templates reflect any
   new setup steps, validation expectations, or compatibility limits.
6. Confirm the release contains no credentials, token caches, private endpoint
   URLs or exports, raw sensitive logs, local environment files, screenshots with
   private infrastructure, or generated artifacts that are not meant to ship.
7. Confirm package metadata still lists the repository, issue tracker, homepage,
   Node/npm baseline, and runtime dependencies accurately.
8. Run `npm run pack:dry-run` and confirm the package contains only the
   freshly rebuilt production `dist/` output and public release documents, not
   bridge binaries, bridge implementation scripts, tests, Playwright traces,
   local artifacts, GitHub workflow internals, or private files. Normal
   `npm pack` and `npm publish` run the same clean release build through
   `prepack`; do not publish with lifecycle scripts disabled.
9. Prepare public release notes from the changelog. Avoid references to private
   planning, private incidents, or unreleased implementation history.

Before publishing to npm, run the central package-publication gate documented
in the sibling `llmwiki-docs` repository and confirm the toolchain release
status is at least `public-unpublished`.

Security support remains defined in `SECURITY.md`.
