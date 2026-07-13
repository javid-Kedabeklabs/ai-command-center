const plain = value => value && typeof value === 'object' && !Array.isArray(value)

export function normalizeWorkflowGroups(groups, nodes = []) {
  const source = Array.isArray(groups) ? groups : []
  const nodeMembership = new Map()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.id && node?.groupId) nodeMembership.set(String(node.id), String(node.groupId))
  }

  return source.map((group, index) => {
    const value = plain(group) ? group : {}
    const nodeIds = []
    const seen = new Set()
    for (const id of Array.isArray(value.nodeIds) ? value.nodeIds : []) {
      const normalized = String(id)
      if (!seen.has(normalized)) { seen.add(normalized); nodeIds.push(normalized) }
    }
    for (const [nodeId, groupId] of nodeMembership) {
      if (groupId === String(value.id || '') && !seen.has(nodeId)) { seen.add(nodeId); nodeIds.push(nodeId) }
    }
    return {
      ...value,
      id: String(value.id || `group-${index + 1}`),
      parentGroupId: value.parentGroupId ? String(value.parentGroupId) : null,
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : index,
      collapsed: value.collapsed === true,
      disabled: value.disabled === true,
      nodeIds,
    }
  })
}

export function groupValidationErrors(groups, nodes = []) {
  const normalized = normalizeWorkflowGroups(groups, nodes)
  const errors = []
  const byId = new Map()
  for (const group of normalized) {
    if (!/^[\w-]+$/.test(group.id)) errors.push(`every group needs a safe id: ${group.id || '(missing)'}`)
    else if (byId.has(group.id)) errors.push(`duplicate group id: ${group.id}`)
    else byId.set(group.id, group)
  }

  const nodeIds = new Set((Array.isArray(nodes) ? nodes : []).map(node => node?.id).filter(Boolean).map(String))
  const owners = new Map()
  for (const group of normalized) {
    if (group.parentGroupId && !byId.has(group.parentGroupId)) errors.push(`group ${group.id} references missing parent group ${group.parentGroupId}`)
    if (group.parentGroupId === group.id) errors.push(`group ${group.id} cannot contain itself`)
    for (const nodeId of group.nodeIds) {
      if (!nodeIds.has(nodeId)) errors.push(`group ${group.id} references missing node ${nodeId}`)
      if (owners.has(nodeId) && owners.get(nodeId) !== group.id) errors.push(`node ${nodeId} belongs to multiple groups: ${owners.get(nodeId)}, ${group.id}`)
      else owners.set(nodeId, group.id)
    }
  }
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.groupId && !byId.has(String(node.groupId))) errors.push(`node ${node.id} references missing group ${node.groupId}`)
    if (node?.groupId && owners.has(String(node.id)) && owners.get(String(node.id)) !== String(node.groupId)) errors.push(`node ${node.id} has conflicting group membership`)
  }

  for (const group of normalized) {
    const seen = new Set([group.id])
    let parentId = group.parentGroupId
    while (parentId) {
      if (seen.has(parentId)) { errors.push(`cyclic group parentage detected at ${group.id}`); break }
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentGroupId || null
    }
  }
  return [...new Set(errors)]
}

export function descendantGroupIds(groups, groupId) {
  const normalized = normalizeWorkflowGroups(groups)
  const children = new Map()
  for (const group of normalized) {
    if (!group.parentGroupId) continue
    const list = children.get(group.parentGroupId) || []
    list.push(group.id); children.set(group.parentGroupId, list)
  }
  const result = new Set(), pending = [...(children.get(String(groupId)) || [])]
  while (pending.length) {
    const id = pending.shift()
    if (result.has(id)) continue
    result.add(id); pending.push(...(children.get(id) || []))
  }
  return result
}

export function nodeIdsInGroupTree(groups, nodes, groupId) {
  const normalized = normalizeWorkflowGroups(groups, nodes)
  const groupIds = new Set([String(groupId), ...descendantGroupIds(normalized, groupId)])
  const result = new Set()
  for (const group of normalized) if (groupIds.has(group.id)) for (const nodeId of group.nodeIds) result.add(nodeId)
  for (const node of Array.isArray(nodes) ? nodes : []) if (groupIds.has(String(node?.groupId || ''))) result.add(String(node.id))
  return result
}

export function disabledWorkflowNodeIds(groups, nodes) {
  const normalized = normalizeWorkflowGroups(groups, nodes)
  const disabled = new Set()
  for (const group of normalized) {
    if (!group.disabled) continue
    for (const nodeId of nodeIdsInGroupTree(normalized, nodes, group.id)) disabled.add(nodeId)
  }
  return disabled
}
