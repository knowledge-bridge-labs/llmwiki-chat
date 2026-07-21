# Bundle Size Markdown Split

## Problem

The production Vite build emits a single JavaScript entry chunk around
503,965 bytes, which is about 3,965 bytes above Vite's default 500 kB chunk
warning threshold. The overage is small, but the Markdown renderer stack is
only needed when answers or selected pages render Markdown.

## Goals

- Split Markdown rendering into a lazy production chunk.
- Keep the main entry chunk below the default Vite warning threshold.
- Preserve assistant answer Markdown behavior: GFM, sanitized HTML handling,
  blocked media, and citation anchors rendered as buttons.
- Preserve selected page Markdown behavior: GFM, `skipHtml`, sanitized output,
  wiki-link row/button rendering, blocked media, and
  `aria-label="Selected page markdown"`.
- Avoid new dependencies, version changes, screenshots, or warning-limit
  configuration changes.

## Non-goals

- No redesign of citation matching, graph selection, or page-read behavior.
- No package version change.
- No `chunkSizeWarningLimit` increase.
- No screenshot updates unless a later visual validation proves they are
  necessary.

## Requirements

- Move eager imports of `react-markdown`, `remark-gfm`, and
  `rehype-sanitize/defaultSchema` out of `App.tsx` and into a lazy-loaded
  Markdown renderer module.
- Use `React.lazy` and `Suspense` from `App.tsx` with lightweight fallbacks.
- Avoid circular imports; App-owned citation and graph lookup behavior remains
  passed into the renderer through callbacks.
- Existing focused tests for Markdown, citations, page Markdown, and XSS
  behavior continue to pass.

## Architecture decision

No ADR is needed. This change does not alter public contracts, persistence,
runtime/source ownership, security defaults, or cross-repo workflow. It is an
internal client bundle layout change that preserves the existing UI behavior.
