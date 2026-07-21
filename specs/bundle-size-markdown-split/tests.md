# Tests

## Focused behavior

- Assistant answer Markdown links, code blocks, GFM tables, blocked images, and
  XSS sanitization continue to pass in `src/App.test.tsx`.
- Inline citation anchors still render as graph-synchronizing buttons and keep
  existing citation matching behavior.
- Selected page Markdown still renders GFM tables, skips raw HTML, blocks media,
  converts wiki links to chips/buttons, and keeps
  `aria-label="Selected page markdown"`.

## Validation commands

```sh
npm run typecheck
npm run lint
npx vitest run src/App.test.tsx -t "markdown|citation|selected page|XSS|html|image|GFM"
npm run build
git diff --check
```

If feasible for runtime, also run:

```sh
npx vitest run src/App.test.tsx
```

The build must complete without Vite's default chunk-size warning.
