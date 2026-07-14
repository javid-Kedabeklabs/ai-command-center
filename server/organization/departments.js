const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const COLORS = ['#8b7cf6', '#42b9d0', '#44b974', '#f0a34a', '#db6fa8', '#7c91e8']

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }) }
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function name(value) { const result = String(value || '').trim().slice(0, 80); if (!result) fail('DEPARTMENT_NAME_REQUIRED', 'department name is required'); return result }
function color(value, index = 0) { const result = String(value || COLORS[index % COLORS.length]).toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(result)) fail('DEPARTMENT_COLOR_INVALID', 'department color must be a six-digit hex value'); return result }

export function normalizeOrganization(raw, agents = []) {
  const source = raw?.schemaVersion === 1 && Array.isArray(raw.departments) ? raw : { schemaVersion: 1, revision: 0, departments: [] }
  const departments = [], seen = new Set()
  for (const [index, item] of source.departments.entries()) {
    const id = String(item?.id || slug(item?.name))
    if (!SAFE_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    departments.push({ id, name: name(item.name), color: color(item.color, index), order: Number.isFinite(Number(item.order)) ? Number(item.order) : index })
  }
  for (const agent of agents) {
    const departmentName = String(agent?.department || 'General Operations').trim() || 'General Operations'
    const id = slug(departmentName) || 'general-operations'
    if (!seen.has(id)) { seen.add(id); departments.push({ id, name: departmentName.slice(0, 80), color: color(null, departments.length), order: departments.length }) }
  }
  departments.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return { schemaVersion: 1, revision: Math.max(0, Number(source.revision) || 0), departments }
}

export function createDepartment(organization, input, agents = []) {
  const current = normalizeOrganization(organization, agents), departmentName = name(input?.name), id = String(input?.id || slug(departmentName))
  if (!SAFE_ID.test(id)) fail('DEPARTMENT_ID_INVALID', 'department id must contain lowercase letters, numbers, or hyphens')
  if (current.departments.some(item => item.id === id || item.name.toLowerCase() === departmentName.toLowerCase())) fail('DEPARTMENT_EXISTS', 'department already exists', 409)
  const department = { id, name: departmentName, color: color(input?.color, current.departments.length), order: current.departments.length }
  return { organization: { ...current, revision: current.revision + 1, departments: [...current.departments, department] }, department }
}

export function deleteDepartment(organization, id, agents = [], expectedRevision) {
  const current = normalizeOrganization(organization, agents)
  if (Number(expectedRevision) !== current.revision) fail('DEPARTMENT_REVISION_STALE', 'organization revision is stale', 409)
  const department = current.departments.find(item => item.id === id)
  if (!department) fail('DEPARTMENT_NOT_FOUND', 'department not found', 404)
  if (agents.some(agent => String(agent.department || 'General Operations') === department.name)) fail('DEPARTMENT_IN_USE', 'move all workers before deleting this department', 409)
  return { ...current, revision: current.revision + 1, departments: current.departments.filter(item => item.id !== id).map((item, order) => ({ ...item, order })) }
}
