# Production Dependency License Summary

The npm package includes the production browser bundle, public documentation,
metadata files, and retained license artifacts. It does not include a bridge
binary or embedded bridge implementation; Hermes, DeepAgents, and generic
OpenAI-compatible bridge workflows use the separate `llmwiki-agent-bridge`
package.

The authoritative production dependency license inventory is generated from
`package-lock.json` into [`../THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md).
Release builds copy the same file to `dist/THIRD_PARTY_LICENSES.md` so users who
deploy only the browser artifact retain the full notice file.

Keep the generated inventory current with:

```sh
npm run licenses:generate
npm run licenses:check
```

Do not maintain a second hand-written dependency table in this page. The
generated file records package names, versions, declared licenses, installed
paths, repository/homepage metadata, and retained top-level license, notice,
copying, or copyright files when they are present in installed npm packages.

Before publishing a public npm release, review the generated file together with
`package-lock.json` and upstream package metadata.
