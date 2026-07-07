import { describe, expect, it } from 'vitest'
import { mergeGraphs } from './graph'
import type { KnowledgeGraph } from './domain'

describe('mergeGraphs', () => {
  it('preserves existing node details when a later graph omits them', () => {
    const discoveredGraph: KnowledgeGraph = {
      nodes: [
        {
          id: 'page:hot::local-demo',
          label: 'Current Focus',
          kind: 'hot',
          path: 'hot.md',
          metadata: { source: 'manifest' },
        },
      ],
      edges: [],
    }
    const queryGraph: KnowledgeGraph = {
      nodes: [
        {
          id: 'page:hot::local-demo',
          label: 'Current Focus',
          kind: 'hot',
          metadata: { evidence: 'query' },
        },
      ],
      edges: [],
    }

    expect(mergeGraphs([discoveredGraph, queryGraph]).nodes[0]).toEqual({
      id: 'page:hot::local-demo',
      label: 'Current Focus',
      kind: 'hot',
      path: 'hot.md',
      metadata: { source: 'manifest', evidence: 'query' },
    })
  })
})
