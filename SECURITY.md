# Security Policy

## Supported Versions

Security fixes are applied to the current `main` branch until the project
publishes versioned releases. After releases begin, supported versions will be
listed here.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting for this repository when available:
`https://github.com/knowledge-bridge-labs/llmwiki-chat/security/advisories/new`.

If private vulnerability reporting is unavailable, open a public issue only to
request a private security contact path, then stop. Do not include exploitable
details, private data, credentials, private wiki content, request logs,
screenshots, or proof-of-concept payloads in a public issue, pull request, or
discussion.

Include:

- affected version or commit
- steps to reproduce
- expected impact
- affected protocol or area, such as HTTP, MCP, A2A, dependency handling, build
  configuration, browser client behavior, or documentation guidance
- minimal redacted logs, traces, or proof-of-concept details when they are needed
  to reproduce the issue

Do not include real credentials, bearer tokens, private endpoint URLs, exported
private content, raw sensitive logs, local environment files, or screenshots that
expose private infrastructure.

Maintainers should acknowledge reports within 7 days and provide a remediation
or status update as soon as practical.

## Scope

This policy covers:

- the LLMWiki Chat browser client and project configuration in this repository
- GitHub Actions, dependency automation, and release configuration
- documentation that could lead contributors to expose credentials, private
  endpoints, or sensitive data
- adapter behavior for LLMWiki-compatible HTTP, MCP, and A2A endpoint access

Vulnerabilities in upstream packages should also be reported to the relevant
upstream maintainers. Dependency issues that affect this repository can still be
reported here when a coordinated fix, pin, or mitigation is needed.

## Non-Security Reports

Use public issues for reproducible product bugs, feature requests, documentation
gaps, adapter compatibility questions, or answer-quality concerns from a real
external runtime.

`Mock Agent` is a development adapter. Mock answer quality is not treated as a
security vulnerability or a production-quality regression by itself.

## Accidental Disclosure

If a secret, private endpoint, or sensitive export is accidentally posted in this
repository, notify the maintainers privately, rotate or revoke the exposed value
outside the repository, and coordinate cleanup before adding more public context.
