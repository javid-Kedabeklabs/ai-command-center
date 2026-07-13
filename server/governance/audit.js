const SAFE_OUTCOMES = new Set(['accepted', 'denied'])
const SAFE_ENVIRONMENTS = new Set(['development', 'testing', 'production'])

function boundedIdentifier(value, fallback = null) {
  const text = String(value ?? '').trim()
  return text && /^[a-z0-9_.:-]{1,160}$/i.test(text) ? text : fallback
}

export function governanceAuditDetail({ operation, outcome, workflowId, code, environment } = {}) {
  return {
    operation: boundedIdentifier(operation, 'unknown'),
    outcome: SAFE_OUTCOMES.has(outcome) ? outcome : 'denied',
    workflow: boundedIdentifier(workflowId),
    code: boundedIdentifier(code),
    environment: SAFE_ENVIRONMENTS.has(environment) ? environment : null,
  }
}

export function governanceErrorResponse(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : 409,
    body: {
      error: String(error?.message || 'governance mutation denied').slice(0, 240),
      code: boundedIdentifier(error?.code, 'GOVERNANCE_MUTATION_DENIED'),
    },
  }
}
