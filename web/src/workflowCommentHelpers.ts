import type { WorkflowComment } from './api'

export type CommentAnchorTarget = { id: string; type: 'node' | 'group'; label?: string }

export function visibleWorkflowComments(comments: WorkflowComment[], showResolved: boolean): WorkflowComment[] {
  return comments.filter(comment => showResolved || !comment.resolved)
}

export function commentAnchorStatus(comment: WorkflowComment, targets: CommentAnchorTarget[]): { state: 'none' | 'anchored' | 'missing'; label: string } {
  if (!comment.anchor) return { state: 'none', label: 'Canvas note' }
  const target = targets.find(item => item.id === comment.anchor?.id && item.type === comment.anchor?.type)
  if (!target) return { state: 'missing', label: `Missing ${comment.anchor.type} · ${comment.anchor.id}` }
  return { state: 'anchored', label: `Anchored to ${target.label || target.id}` }
}

export function moveWorkflowComment(comment: WorkflowComment, position: { x: number; y: number }): WorkflowComment {
  return { ...comment, position: { x: Number(position.x) || 0, y: Number(position.y) || 0 } }
}

export function isExecutableCanvasItem(item: { data?: Record<string, unknown> }): boolean {
  return item.data?.ntype !== '__group' && item.data?.ntype !== '__comment'
}
