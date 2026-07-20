# Tests

## Acceptance

- Local I/O logging is checked by default and the panel is visible.
- Default run stores prompt and answer canaries in localStorage JSONL.
- Stored entries include runtime request payload body/summary and response
  metadata.
- Opting out suppresses future raw storage and clears stored raw entries.
- Clear control removes persisted entries.
- API-key, bearer-token, token-field, and credential-bearing URL canaries are
  redacted from persisted entries.
- Existing multi-turn runtime conversation behavior still passes.

## Commands

```sh
npx vitest run src/App.test.tsx --testNamePattern "local I/O|multi-turn|bounded conversation"
npx vitest run src/agentRuntimes.test.ts
npm run typecheck
npm run lint
```
