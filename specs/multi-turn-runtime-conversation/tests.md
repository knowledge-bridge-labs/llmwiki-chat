# Tests

## Acceptance

- MCP bridge runtime arguments include `query`, A2A `message`, `messages`,
  conversation IDs, selected sources, and tools.
- Custom A2A runtime request body includes the same additive shape.
- Redacted turn audit remains separate from raw prompt/answer content.
- Chat reset clears current conversation state and starts a new thread id.

## Commands

```sh
npm run typecheck
npx vitest run src/agentRuntimes.test.ts src/App.test.tsx
npm run check
```
