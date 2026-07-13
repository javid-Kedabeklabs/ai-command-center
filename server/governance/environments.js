export const WORKFLOW_ENVIRONMENTS = Object.freeze(['development', 'testing', 'production'])

const ENVIRONMENT_SET = new Set(WORKFLOW_ENVIRONMENTS)

export function normalizeWorkflowEnvironment(value, { fallback = 'development' } = {}) {
  const environment = String(value ?? fallback).trim().toLowerCase()
  if (!ENVIRONMENT_SET.has(environment)) {
    const error = new Error('workflow environment must be Development, Testing, or Production')
    error.code = 'GOVERNANCE_INVALID_ENVIRONMENT'
    error.status = 400
    throw error
  }
  return environment
}
