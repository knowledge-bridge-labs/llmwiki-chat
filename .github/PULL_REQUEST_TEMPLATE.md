## Summary

<!-- What changed, and why? Keep this focused on user-visible behavior,
compatibility, security, documentation, or project maintenance impact. -->

## Prior Discussion

- [ ] This is a small, self-contained fix or documentation change.
- [ ] I linked the issue or discussion where direction was agreed for a
      substantial or ambiguous change.
- [ ] Not applicable.

## Usage Mode Impact

<!-- Check all that apply and explain compatibility impact. -->

- [ ] `llmwiki-serve` end-to-end usage
- [ ] External Agent Runtime console usage
- [ ] Both supported usage modes
- [ ] No user-facing usage mode impact

## Runtime and Endpoint Impact

- [ ] Agent Runtime adapter
- [ ] Mock Agent development adapter
- [ ] HTTP Knowledge Source endpoint
- [ ] MCP Knowledge Source endpoint
- [ ] A2A Knowledge Source endpoint
- [ ] Chat UI
- [ ] Graph/details inspector
- [ ] Documentation-only change
- [ ] CI or repository maintenance

## Type

- [ ] Feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Refactor
- [ ] Test
- [ ] CI or security maintenance

## Validation

- [ ] `npm run check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run test:e2e`
- [ ] `npm run test:e2e:a2a-runtime`
- [ ] `npm run test:e2e:live` when Knowledge Source endpoint compatibility changed
- [ ] `npm run build`
- [ ] `npm run pack:dry-run`
- [ ] `npm audit --audit-level=moderate`

<!-- For documentation-only changes, mark skipped checks as not run and explain why. -->

## Documentation and Release Notes

- [ ] I updated README, CONTRIBUTING, CHANGELOG, or docs when behavior, setup,
      compatibility, validation, or release expectations changed.
- [ ] I documented Knowledge Source endpoint protocol impact for HTTP, MCP, or
      A2A changes.
- [ ] I documented runtime adapter impact for Hermes or DeepAgents named A2A
      slots, Copilot as an external MCP/A2A-consuming runtime candidate,
      `Mock Agent`, or `Custom A2A`.
- [ ] Not applicable.

## Security and Data Handling

- [ ] I did not include credentials, tokens, private endpoint URLs or exports,
      local environment files, raw sensitive logs, or screenshots exposing
      private infrastructure.
- [ ] I did not treat `Mock Agent` output as the production answer-quality
      baseline.
- [ ] I followed `SECURITY.md` for any suspected vulnerability.

## Notes for Reviewers

<!-- Mention affected runtime, knowledge-source protocol, UI flow, compatibility
concern, skipped validation, follow-up work, or any AI-assisted implementation
area that needs closer maintainer review. -->
