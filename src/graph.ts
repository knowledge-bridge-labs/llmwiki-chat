import type { Connection, KnowledgeGraph } from './domain'

export function namespaceGraph(graph: KnowledgeGraph, source: Connection): KnowledgeGraph {
  const suffix = `::${source.id}`
  return {
    nodes: graph.nodes.map((node) => ({ ...node, id: `${node.id}${suffix}` })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: `${edge.source}${suffix}`,
      target: `${edge.target}${suffix}`,
    })),
  }
}

export function mergeGraphs(graphs: KnowledgeGraph[]): KnowledgeGraph {
  const nodes = new Map<string, KnowledgeGraph['nodes'][number]>()
  const edges = new Map<string, KnowledgeGraph['edges'][number]>()
  graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      const existing = nodes.get(node.id)
      nodes.set(node.id, existing ? mergeGraphNode(existing, node) : node)
    })
    graph.edges.forEach((edge) => edges.set(`${edge.source}:${edge.target}:${edge.relation}`, edge))
  })
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

export function emptyGraph(): KnowledgeGraph {
  return { nodes: [], edges: [] }
}

function mergeGraphNode(
  existing: KnowledgeGraph['nodes'][number],
  next: KnowledgeGraph['nodes'][number],
): KnowledgeGraph['nodes'][number] {
  const metadata = existing.metadata || next.metadata
    ? { ...(existing.metadata || {}), ...(next.metadata || {}) }
    : undefined
  return {
    ...existing,
    ...next,
    path: next.path || existing.path,
    metadata,
  }
}
