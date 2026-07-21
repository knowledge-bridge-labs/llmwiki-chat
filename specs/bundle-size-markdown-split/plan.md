# Plan

1. Add a `src/MarkdownRenderer.tsx` module that owns the Markdown parser stack
   imports and rendering components.
2. Move Markdown-specific rendering helpers for page Markdown display and
   wiki-link rows into the renderer module.
3. Keep App-owned citation matching and graph node lookup in `App.tsx`; pass
   them into the lazy renderer as callbacks.
4. Replace eager Markdown rendering in `App.tsx` with `React.lazy` +
   `Suspense` wrappers and lightweight status fallbacks.
5. Run type, lint, focused behavior tests, full App tests if feasible, build,
   and diff whitespace validation.

## Affected files

- `src/App.tsx`
- `src/MarkdownRenderer.tsx`
- `specs/bundle-size-markdown-split/*`

## Risks

- A static import from `App.tsx` back into the renderer would pull the Markdown
  parser stack into the entry chunk again; keep renderer imports lazy-only.
- Suspense fallbacks must not remove stable labels that tests and assistive
  technologies depend on.
- Citation matching and wiki-link target resolution must stay behaviorally
  identical even though the Markdown parser loads later.
