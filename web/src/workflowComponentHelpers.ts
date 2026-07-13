export type ReusableWorkflowComponent = {
  id: string
  name: string
  description: string
  nodeCount: number
  currentVersionId: string | null
  currentVersionHash: string | null
  available: boolean
  archived: boolean
  unavailableReason: string | null
}

export function reusableComponentNodeData(component: ReusableWorkflowComponent) {
  if (!component.available || !component.currentVersionId) throw new Error(component.unavailableReason || 'This reusable component has no current saved snapshot.')
  return {
    label: component.name,
    description: component.description,
    workflowId: component.id,
    workflowVersion: component.currentVersionId,
  }
}
