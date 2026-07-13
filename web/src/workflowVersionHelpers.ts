export type SavedWorkflowVersion = { id: string; hash?: string; savedAt?: number }

export function currentWorkflowVersion<T extends SavedWorkflowVersion & { current?: boolean }>(versions: T[]) {
  return versions.find(version => version.current) || versions[0]
}

export function extractedSubworkflowData(label: string, workflowId: string, savedVersion: SavedWorkflowVersion) {
  if (!workflowId || !savedVersion?.id) throw new Error('A saved child workflow version is required before extraction can replace parent nodes.')
  return { label, workflowId, workflowVersion: savedVersion.id }
}

export function advanceSubworkflowPin(data: Record<string, unknown>, savedVersion: SavedWorkflowVersion) {
  if (!savedVersion?.id) throw new Error('A saved child workflow version is required to update this pin.')
  return { ...data, workflowVersion: savedVersion.id }
}
