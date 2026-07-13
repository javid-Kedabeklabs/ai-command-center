const plain = value => value && typeof value === 'object' && !Array.isArray(value)

export function normalizeWorkflowComments(comments) {
  return (Array.isArray(comments) ? comments : []).map((comment, index) => {
    const value = plain(comment) ? comment : {}
    const anchor = plain(value.anchor) && value.anchor.id
      ? { ...value.anchor, type: String(value.anchor.type || ''), id: String(value.anchor.id) }
      : null
    return {
      ...value,
      id: String(value.id || `comment-${index + 1}`),
      text: String(value.text || ''),
      position: plain(value.position)
        ? { ...value.position, x: Number(value.position.x) || 0, y: Number(value.position.y) || 0 }
        : { x: 0, y: 0 },
      anchor,
      resolved: value.resolved === true,
    }
  })
}

export function commentValidationErrors(comments, nodes = [], groups = []) {
  const errors = []
  const ids = new Set()
  const canvasIds = new Set([...(Array.isArray(nodes) ? nodes : []), ...(Array.isArray(groups) ? groups : [])].map(item => String(item?.id || '')).filter(Boolean))
  for (const comment of normalizeWorkflowComments(comments)) {
    if (!/^[\w-]+$/.test(comment.id)) errors.push(`every comment needs a safe id: ${comment.id || '(missing)'}`)
    else if (ids.has(comment.id)) errors.push(`duplicate comment id: ${comment.id}`)
    else ids.add(comment.id)
    if (canvasIds.has(comment.id)) errors.push(`comment id conflicts with a canvas item: ${comment.id}`)
    if (!comment.text.trim()) errors.push(`comment ${comment.id} needs text`)
    if (!Number.isFinite(comment.position.x) || !Number.isFinite(comment.position.y)) errors.push(`comment ${comment.id} needs a finite canvas position`)
    if (comment.anchor && !['node', 'group'].includes(comment.anchor.type)) errors.push(`comment ${comment.id} has an invalid anchor type`)
    if (comment.anchor && !/^[\w-]+$/.test(comment.anchor.id)) errors.push(`comment ${comment.id} has an invalid anchor id`)
  }
  return [...new Set(errors)]
}
