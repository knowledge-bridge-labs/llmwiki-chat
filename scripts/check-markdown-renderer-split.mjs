import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const distRoot = resolve(process.cwd(), 'dist')
const assetsRoot = join(distRoot, 'assets')
const indexHtmlPath = join(distRoot, 'index.html')
const failures = []

if (!existsSync(indexHtmlPath)) {
  console.error('dist/index.html is missing. Run npm run build first.')
  process.exit(1)
}

if (!existsSync(assetsRoot)) {
  console.error('dist/assets is missing. Run npm run build first.')
  process.exit(1)
}

const html = readFileSync(indexHtmlPath, 'utf8')
const entryFiles = moduleScriptSources(html)
  .map((source) => ({ source, path: distAssetPath(source) }))
  .filter(({ source, path }) => {
    if (!path) {
      failures.push(`Module script ${source} is not a local dist asset.`)
      return false
    }

    if (!existsSync(path)) {
      failures.push(`Module script ${source} does not exist at ${path}.`)
      return false
    }

    return true
  })

if (!entryFiles.length) {
  failures.push('No built module script entry was found in dist/index.html.')
}

const rendererChunkNames = readdirSync(assetsRoot)
  .filter((fileName) => /^MarkdownRenderer-[A-Za-z0-9_-]+\.js$/.test(fileName))
  .sort()
const rendererChunkName = rendererChunkNames[0]
const rendererChunkPath = rendererChunkName ? join(assetsRoot, rendererChunkName) : ''

if (rendererChunkNames.length !== 1) {
  failures.push(`Expected exactly one MarkdownRenderer JS chunk, found ${rendererChunkNames.length}: ${rendererChunkNames.join(', ') || 'none'}.`)
}

const entryText = entryFiles.map(({ path }) => readFileSync(path, 'utf8')).join('\n')
const rendererText = rendererChunkPath && existsSync(rendererChunkPath)
  ? readFileSync(rendererChunkPath, 'utf8')
  : ''

if (rendererChunkName && !entryText.includes(rendererChunkName)) {
  failures.push(`Entry JS does not reference ${rendererChunkName} as a lazy chunk.`)
}

const forbiddenEntryMarkers = [
  { marker: 'micromark', reason: 'Markdown parser internals' },
  { marker: 'mdast', reason: 'Markdown AST internals' },
  { marker: 'hast-util', reason: 'HTML AST renderer internals' },
  { marker: 'property-information', reason: 'HTML property metadata internals' },
  { marker: 'page-markdown-card', reason: 'MarkdownRenderer component markup' },
  { marker: 'wiki-link-row', reason: 'MarkdownRenderer wiki-link row rendering' },
  { marker: 'Selected page markdown', reason: 'Page MarkdownRenderer accessible label' },
  { marker: 'No markdown was returned for this page.', reason: 'Page MarkdownRenderer empty-state copy' },
]
const leakedMarkers = forbiddenEntryMarkers
  .filter(({ marker }) => entryText.includes(marker))
  .map(({ marker, reason }) => `${marker} (${reason})`)

if (leakedMarkers.length) {
  failures.push(`Entry JS contains Markdown parser/renderer markers: ${leakedMarkers.join(', ')}.`)
}

const requiredRendererMarkers = [
  { marker: 'micromark', reason: 'Markdown parser internals' },
  { marker: 'page-markdown-card', reason: 'MarkdownRenderer component markup' },
  { marker: 'Selected page markdown', reason: 'Page MarkdownRenderer accessible label' },
]
const missingRendererMarkers = requiredRendererMarkers
  .filter(({ marker }) => !rendererText.includes(marker))
  .map(({ marker, reason }) => `${marker} (${reason})`)

if (missingRendererMarkers.length) {
  failures.push(`MarkdownRenderer chunk is missing expected parser/renderer markers: ${missingRendererMarkers.join(', ')}.`)
}

if (failures.length) {
  console.error('MarkdownRenderer bundle split check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const entrySummary = entryFiles
  .map(({ path }) => `${basename(path)} (${formatBytes(statSync(path).size)})`)
  .join(', ')
const rendererSummary = `${rendererChunkName} (${formatBytes(statSync(rendererChunkPath).size)})`

console.log(`MarkdownRenderer bundle split check passed: entry ${entrySummary}; renderer ${rendererSummary}.`)

function moduleScriptSources(htmlText) {
  const scriptTags = htmlText.match(/<script\b[^>]*>/gi) || []
  return scriptTags.flatMap((tag) => {
    if (!/\btype=["']module["']/i.test(tag)) return []
    const sourceMatch = tag.match(/\bsrc=["']([^"']+\.js(?:[?#][^"']*)?)["']/i)
    return sourceMatch ? [sourceMatch[1]] : []
  })
}

function distAssetPath(source) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return ''
  const relativeSource = source.split(/[?#]/)[0].replace(/^\/+/, '')
  return resolve(distRoot, relativeSource)
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes`
}
