import assert from 'node:assert/strict'
import { createDepartment, deleteDepartment, normalizeOrganization } from '../server/organization/departments.js'

const agents = [{ id: 'a', department: 'Engineering' }]
const initial = normalizeOrganization(null, agents)
assert.equal(initial.departments[0].name, 'Engineering')
const created = createDepartment(initial, { name: 'Customer Success', color: '#123abc' }, agents)
assert.equal(created.department.id, 'customer-success')
assert.equal(created.organization.revision, 1)
assert.throws(() => createDepartment(created.organization, { name: 'Customer Success' }, agents), error => error.code === 'DEPARTMENT_EXISTS')
assert.throws(() => deleteDepartment(created.organization, 'engineering', agents, 1), error => error.code === 'DEPARTMENT_IN_USE')
assert.throws(() => deleteDepartment(created.organization, 'customer-success', agents, 0), error => error.code === 'DEPARTMENT_REVISION_STALE')
const deleted = deleteDepartment(created.organization, 'customer-success', agents, 1)
assert.equal(deleted.departments.some(item => item.id === 'customer-success'), false)
assert.equal(deleted.revision, 2)
assert.throws(() => createDepartment(initial, { name: 'Unsafe', color: 'red' }, agents), error => error.code === 'DEPARTMENT_COLOR_INVALID')
console.log('organization tests: 9/9 passed')
