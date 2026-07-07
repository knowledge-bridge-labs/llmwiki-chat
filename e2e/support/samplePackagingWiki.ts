import type { Page, Route } from '@playwright/test'

export async function routeSamplePackagingWiki(page: Page, baseUrl: string): Promise<void> {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '')
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }

  await page.route(`${cleanBaseUrl}/manifest`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    await route.fulfill({
      headers: corsHeaders,
      json: {
        title: 'Sample Packaging LLMWiki',
        description: 'Synthetic packaging operations knowledge base.',
        adapter: 'llmwiki-markdown',
        implementation: 'atomicstrata/llm-wiki-compiler',
        page_count: 4,
        approved_page_count: 4,
      },
    })
  })

  await page.route(`${cleanBaseUrl}/graph?limit=500`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    await route.fulfill({
      headers: corsHeaders,
      json: {
        nodes: [
          { id: 'page:hot', label: 'Current Focus', kind: 'hot', path: 'hot.md' },
          { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic', path: 'artwork-review.md' },
          { id: 'heading:hot-current-focus', label: 'Current Focus', kind: 'heading', path: 'hot.md' },
          { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
        ],
        edges: [
          { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
          { source: 'page:hot', target: 'heading:hot-current-focus', relation: 'contains' },
          { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
        ],
      },
    })
  })

  await page.route(`${cleanBaseUrl}/query`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    await route.fulfill({
      headers: corsHeaders,
      json: {
        wiki_title: 'Sample Packaging LLMWiki',
        orientation: [
          {
            title: 'Current Focus',
            role: 'hot',
            snippet: 'Required label copy and release readiness.',
          },
          {
            title: 'Sample Packaging LLMWiki',
            role: 'index',
            snippet: 'Packaging artwork review and requester returns.',
          },
        ],
        evidence: [
          {
            page_id: 'hot',
            title: 'Current Focus',
            path: 'hot.md',
            snippet: 'Required label copy and release readiness are current focus items.',
            source_refs: ['SRC-HOT'],
          },
          {
            page_id: 'artwork-review',
            title: 'Artwork Review Process',
            path: 'artwork-review.md',
            snippet: 'Artwork review checks required copy, barcode placement, and approval state.',
            source_refs: ['SRC-ART-001'],
          },
        ],
        graph: {
          nodes: [
            { id: 'page:hot', label: 'Current Focus', kind: 'hot' },
            { id: 'page:artwork-review', label: 'Artwork Review Process', kind: 'topic' },
            { id: 'heading:hot-current-focus', label: 'Current Focus', kind: 'heading', path: 'hot.md' },
            { id: 'source:SRC-HOT', label: 'SRC-HOT', kind: 'source_ref' },
          ],
          edges: [
            { source: 'page:hot', target: 'page:artwork-review', relation: 'links_to' },
            { source: 'page:hot', target: 'heading:hot-current-focus', relation: 'contains' },
            { source: 'page:hot', target: 'source:SRC-HOT', relation: 'cites' },
          ],
        },
      },
    })
  })

  await page.route(`${cleanBaseUrl}/read/**`, async (route) => {
    if (await fulfillCorsOptions(route, corsHeaders)) return
    const pageId = decodeURIComponent(route.request().url().slice(`${cleanBaseUrl}/read/`.length))
    const pageBody = sampleReadPages[pageId] || sampleReadPages[pageId.replace(/\.md$/, '')]
    if (!pageBody) {
      await route.fulfill({
        status: 404,
        headers: corsHeaders,
        json: { found: false, reason: 'not found' },
      })
      return
    }
    await route.fulfill({
      headers: corsHeaders,
      json: pageBody,
    })
  })
}

async function fulfillCorsOptions(route: Route, headers: Record<string, string>): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false
  await route.fulfill({ status: 204, headers })
  return true
}

const sampleReadPages: Record<string, { id: string; title: string; path: string; text: string; source_refs?: string[] }> = {
  'hot.md': {
    id: 'hot',
    title: 'Current Focus',
    path: 'hot.md',
    source_refs: ['SRC-HOT'],
    text: [
      '# Current Focus',
      '',
      'Required label copy and release readiness are current focus items.',
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| State | Ready |',
    ].join('\n'),
  },
  hot: {
    id: 'hot',
    title: 'Current Focus',
    path: 'hot.md',
    source_refs: ['SRC-HOT'],
    text: '# Current Focus\n\nRequired label copy and release readiness are current focus items.',
  },
  'artwork-review.md': {
    id: 'artwork-review',
    title: 'Artwork Review Process',
    path: 'artwork-review.md',
    source_refs: ['SRC-ART-001'],
    text: '# Artwork Review Process\n\nArtwork review checks required copy, barcode placement, and approval state.',
  },
  'artwork-review': {
    id: 'artwork-review',
    title: 'Artwork Review Process',
    path: 'artwork-review.md',
    source_refs: ['SRC-ART-001'],
    text: '# Artwork Review Process\n\nArtwork review checks required copy, barcode placement, and approval state.',
  },
}
