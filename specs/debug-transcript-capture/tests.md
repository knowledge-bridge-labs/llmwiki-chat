# Tests

## Acceptance

- Raw debug transcript panel is absent/off by default.
- Prompt/answer text is not written to localStorage or sessionStorage.
- Enabling the toggle displays prompt/answer for the current tab only.
- Disabling the toggle hides and clears captured entries.

## Commands

```sh
npx vitest run src/App.test.tsx --testNamePattern "debug transcript"
npm run check
```
