export function dependencyLayers(nodes, edges) {
  const ids = nodes.map(node => node.id)
  const indegree = new Map(ids.map(id => [id, 0]))
  const outgoing = new Map(ids.map(id => [id, []]))
  for (const edge of edges) {
    if (!outgoing.has(edge.source) || !indegree.has(edge.target)) continue
    outgoing.get(edge.source).push(edge.target)
    indegree.set(edge.target, indegree.get(edge.target) + 1)
  }
  let ready = ids.filter(id => indegree.get(id) === 0)
  const layers = [], visited = []
  while (ready.length) {
    const layer = ready
    layers.push(layer); visited.push(...layer); ready = []
    for (const id of layer) for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1)
      if (indegree.get(target) === 0) ready.push(target)
    }
  }
  if (visited.length !== ids.length) throw new Error('workflow contains a cycle')
  return layers
}

export async function runDependencyGraph(nodes, edges, options) {
  const parallelism = Math.max(1, Math.min(Number(options.parallelism) || 1, 32))
  const layers = dependencyLayers(nodes, edges)
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    if (options.cancelled?.()) break
    const layer = layers[layerIndex]
    options.onLayer?.(layer, layerIndex)
    let cursor = 0, firstError = null
    const worker = async () => {
      while (!firstError && !options.cancelled?.()) {
        const index = cursor++
        if (index >= layer.length) return
        try { await options.execute(layer[index]) }
        catch (error) { firstError ||= error }
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallelism, layer.length) }, worker))
    if (firstError) throw firstError
  }
}
