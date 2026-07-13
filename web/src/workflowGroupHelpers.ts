export type CanvasPoint = { x: number; y: number }

export type CanvasHierarchyNode = {
  id: string
  parentId?: string
  position: CanvasPoint
  hidden?: boolean
  data?: Record<string, unknown>
}

const isGroup = (node: CanvasHierarchyNode) => node.data?.ntype === '__group'
const isExecutable = (node: CanvasHierarchyNode) => !isGroup(node) && node.data?.ntype !== '__comment'

export function hierarchyDepth(nodes: CanvasHierarchyNode[], nodeId: string): number {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  let depth = 0
  let parentId = byId.get(nodeId)?.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    depth += 1
    parentId = byId.get(parentId)?.parentId
  }
  return depth
}

export function orderHierarchyNodes<T extends CanvasHierarchyNode>(nodes: T[]): T[] {
  const originalOrder = new Map(nodes.map((node, index) => [node.id, index]))
  return [...nodes].sort((left, right) => {
    const depthDelta = hierarchyDepth(nodes, left.id) - hierarchyDepth(nodes, right.id)
    if (depthDelta) return depthDelta
    const groupDelta = Number(!isGroup(left)) - Number(!isGroup(right))
    if (groupDelta) return groupDelta
    const explicitDelta = Number(left.data?.order ?? originalOrder.get(left.id) ?? 0) - Number(right.data?.order ?? originalOrder.get(right.id) ?? 0)
    return explicitDelta || (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
  })
}

export function absoluteCanvasPosition(nodes: CanvasHierarchyNode[], nodeId: string): CanvasPoint {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  let current = byId.get(nodeId)
  let x = 0
  let y = 0
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    x += Number(current.position?.x) || 0
    y += Number(current.position?.y) || 0
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return { x, y }
}

export function descendantGroupIds(nodes: CanvasHierarchyNode[], groupId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!isGroup(node) || !node.parentId) continue
    children.set(node.parentId, [...(children.get(node.parentId) || []), node.id])
  }
  const descendants = new Set<string>()
  const pending = [...(children.get(groupId) || [])]
  while (pending.length) {
    const id = pending.shift()!
    if (descendants.has(id)) continue
    descendants.add(id)
    pending.push(...(children.get(id) || []))
  }
  return descendants
}

export function recursiveMemberNodeIds(nodes: CanvasHierarchyNode[], groupId: string): string[] {
  const groupIds = new Set([groupId, ...descendantGroupIds(nodes, groupId)])
  return nodes.filter(node => isExecutable(node) && !!node.parentId && groupIds.has(node.parentId)).map(node => node.id)
}

export function validateReparent(nodes: CanvasHierarchyNode[], movingIds: string[], targetParentId?: string): string | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (targetParentId && (!byId.has(targetParentId) || !isGroup(byId.get(targetParentId)!))) return 'The destination section no longer exists.'
  for (const id of movingIds) {
    const moving = byId.get(id)
    if (!moving) return `The selected item ${id} no longer exists.`
    if (!targetParentId || !isGroup(moving)) continue
    if (id === targetParentId) return 'A section cannot contain itself.'
    if (descendantGroupIds(nodes, id).has(targetParentId)) return 'A section cannot be moved inside one of its descendants.'
  }
  return null
}

export function rootSelectionIds(nodes: CanvasHierarchyNode[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds)
  const byId = new Map(nodes.map(node => [node.id, node]))
  return selectedIds.filter(id => {
    const seen = new Set<string>()
    let parentId = byId.get(id)?.parentId
    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return false
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
    return true
  })
}

export function reparentPreservingAbsolute<T extends CanvasHierarchyNode>(nodes: T[], movingIds: string[], targetParentId?: string): T[] {
  const error = validateReparent(nodes, movingIds, targetParentId)
  if (error) throw new Error(error)
  const roots = new Set(rootSelectionIds(nodes, movingIds))
  const targetPosition = targetParentId ? absoluteCanvasPosition(nodes, targetParentId) : { x: 0, y: 0 }
  const absolute = new Map([...roots].map(id => [id, absoluteCanvasPosition(nodes, id)]))
  return nodes.map(node => {
    if (!roots.has(node.id)) return node
    const point = absolute.get(node.id)!
    const next = { ...node, position: { x: point.x - targetPosition.x, y: point.y - targetPosition.y } }
    if (targetParentId) return { ...next, parentId: targetParentId }
    const { parentId: _parentId, ...withoutParent } = next
    return withoutParent as T
  })
}

export function applyRecursiveVisibility<T extends CanvasHierarchyNode>(nodes: T[]): T[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  return nodes.map(node => {
    const seen = new Set<string>()
    let parentId = node.parentId
    let hidden = false
    let ancestorDisabled = false
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      if (parent.data?.collapsed === true) { hidden = true; break }
      if (parent.data?.disabled === true) ancestorDisabled = true
      parentId = parent.parentId
    }
    return { ...node, hidden, data: { ...(node.data || {}), ancestorDisabled } }
  })
}
