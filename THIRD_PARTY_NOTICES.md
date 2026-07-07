# Third-Party Notices

LLMWiki Chat is licensed under Apache-2.0. It depends on third-party npm
packages that are distributed under their own licenses. The npm package ships
the built browser app in `dist/`, public docs, metadata files, and the local
bridge binary listed in `package.json`.

The complete dependency graph and package metadata are recorded in
`package-lock.json`. Review that file together with the upstream package license
files before publishing a release artifact.

## Direct Runtime Dependencies

| Package | Version range | License | Homepage |
| --- | --- | --- | --- |
| `react` | `^19.2.3` | MIT | <https://react.dev/> |
| `react-dom` | `^19.2.3` | MIT | <https://react.dev/> |
| `react-markdown` | `^10.1.0` | MIT | <https://github.com/remarkjs/react-markdown> |
| `rehype-sanitize` | `^6.0.0` | MIT | <https://github.com/rehypejs/rehype-sanitize> |
| `remark-gfm` | `^4.0.1` | MIT | <https://github.com/remarkjs/remark-gfm> |

## Bundled Production Dependency Summary

The production dependency graph resolved for the browser bundle is summarized
in [docs/production-dependency-licenses.md](docs/production-dependency-licenses.md).
That file is included in npm package dry-runs because the package publishes
`docs/`.

Full upstream license, copyright, notice, and attribution text retained from
installed production dependency packages is generated into
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Keep it current with:

```sh
npm run licenses:generate
npm run licenses:check
```

Release builds copy that file into `dist/THIRD_PARTY_LICENSES.md` so users who
deploy only the browser artifact retain the same notices.

## Development Dependencies

Development and test tooling is listed in `package.json` and resolved in
`package-lock.json`. These packages are not bundled into the application build
unless explicitly imported by runtime code.
