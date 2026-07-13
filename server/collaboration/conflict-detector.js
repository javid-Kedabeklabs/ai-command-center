const GLOBAL_LOCK_PATTERNS = Object.freeze([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
  'server/index.js', 'web/src/WorkflowStudio.tsx',
  'server/migrations/**', 'migrations/**', 'database/migrations/**',
])

const normalize = pattern => String(pattern || '').replace(/^\.\//, '').replace(/\/{2,}/g, '/')
const firstMeta = pattern => pattern.search(/[*?\[\]{}]/)
const prefix = pattern => {
  const value = normalize(pattern)
  const index = firstMeta(value)
  return (index < 0 ? value : value.slice(0, index)).replace(/\/+$/, '')
}
const hasMeta = pattern => firstMeta(normalize(pattern)) >= 0

function globToRegExp(glob) {
  let source = '^'
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      source += '.*'; index++
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

export function patternsOverlap(leftInput, rightInput) {
  const left = normalize(leftInput)
  const right = normalize(rightInput)
  if (!left || !right) return true // invalid/unknown ownership must fail closed
  if (left === right) return true
  if (!hasMeta(left) && globToRegExp(right).test(left)) return true
  if (!hasMeta(right) && globToRegExp(left).test(right)) return true
  const a = prefix(left), b = prefix(right)
  if (!a || !b) return true
  if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return true
  return false
}

export function lockedResourcesForPatterns(patterns, locks = GLOBAL_LOCK_PATTERNS) {
  const resources = []
  for (const pattern of patterns || []) {
    for (const lock of locks) if (patternsOverlap(pattern, lock)) resources.push(lock)
  }
  return [...new Set(resources)]
}

export function detectOwnershipConflicts(candidate, activeReservations = [], { globalLocks = GLOBAL_LOCK_PATTERNS } = {}) {
  const candidatePatterns = Array.isArray(candidate?.patterns) ? candidate.patterns : []
  const conflicts = []
  if (!candidate?.taskId || candidatePatterns.length === 0) {
    return [{ type: 'INVALID_RESERVATION', taskId: candidate?.taskId || null, reason: 'taskId and patterns are required' }]
  }
  for (const active of activeReservations) {
    if (!active || active.taskId === candidate.taskId || active.released === true) continue
    if (candidate.readOnly === true || active.readOnly === true) continue
    for (const candidatePattern of candidatePatterns) {
      for (const activePattern of active.patterns || []) {
        if (patternsOverlap(candidatePattern, activePattern)) {
          conflicts.push({ type: 'FILE_SCOPE_OVERLAP', taskId: active.taskId, candidatePattern, activePattern })
        }
      }
    }
    const candidateLocks = lockedResourcesForPatterns(candidatePatterns, globalLocks)
    const activeLocks = lockedResourcesForPatterns(active.patterns || [], globalLocks)
    for (const resource of candidateLocks) {
      if (activeLocks.includes(resource)) conflicts.push({ type: 'GLOBAL_LOCK_CONFLICT', taskId: active.taskId, resource })
    }
  }
  return conflicts.filter((item, index, all) => index === all.findIndex(other => JSON.stringify(other) === JSON.stringify(item)))
}

export function assertOwnershipAvailable(candidate, activeReservations, options) {
  const conflicts = detectOwnershipConflicts(candidate, activeReservations, options)
  if (conflicts.length) {
    const error = new Error('file ownership reservation conflicts with active work')
    error.code = 'FILE_OWNERSHIP_CONFLICT'
    error.conflicts = conflicts
    throw error
  }
  return Object.freeze({ ...candidate, patterns: Object.freeze([...candidate.patterns]) })
}

export { GLOBAL_LOCK_PATTERNS }
