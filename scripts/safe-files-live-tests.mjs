import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.env.CC_URL
const dataDir = process.env.CC_DATA_DIR
const brainDir = process.env.CC_BRAIN_DIR
if (!base || !dataDir || !brainDir) throw new Error('CC_URL, CC_DATA_DIR, and CC_BRAIN_DIR are required; this suite refuses to use persistent application state')

let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); console.log(`  PASS  ${name}`); passed++ } catch (error) { console.error(`  FAIL  ${name}\n        ${error.message}`); failed++ } }
async function request(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: body == null ? {} : { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) })
  const text = await response.text(); let value
  try { value = JSON.parse(text) } catch { value = text }
  return { response, body: value }
}
async function waitRun(id) {
  for (let index = 0; index < 100; index++) {
    const result = await request(`/api/runs/${id}/detail`)
    if (!['running', 'paused'].includes(result.body?.status)) return result.body
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('run timed out')
}

console.log('== integrated symlink-safe filesystem boundary ==')
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-safe-files-live-'))
const outsideFile = path.join(outside, 'outside.txt')
fs.writeFileSync(outsideFile, 'must-not-cross-boundary')
const resolvedBrainDir = path.resolve(brainDir)
fs.mkdirSync(resolvedBrainDir, { recursive: true })
const fileLink = path.join(resolvedBrainDir, 'escape-live.md')
const directoryLink = path.join(resolvedBrainDir, 'escape-live-dir')
for (const target of [fileLink, directoryLink]) { try { fs.unlinkSync(target) } catch {} }
fs.symlinkSync(outsideFile, fileLink)
fs.symlinkSync(outside, directoryLink)

await test('AgentBrain API refuses file and directory symlink traversal for reads and writes', async () => {
  const results = await Promise.all([
    request('/api/brain/file?path=escape-live.md'),
    request('/api/brain/file', 'POST', { path: 'escape-live.md', content: 'overwrite-attempt' }),
    request('/api/brain/file?path=escape-live-dir%2Foutside.txt'),
    request('/api/brain/file', 'POST', { path: 'escape-live-dir/new.txt', content: 'create-attempt' }),
  ])
  if (results.some(result => result.response.status !== 400)) throw new Error(JSON.stringify(results.map(result => ({ status: result.response.status, body: result.body }))))
  if (fs.readFileSync(outsideFile, 'utf8') !== 'must-not-cross-boundary' || fs.existsSync(path.join(outside, 'new.txt'))) throw new Error('an outside file was changed')
})

const workflowId = 'safe-files-live-artifact'
await request(`/api/workflows/${workflowId}`, 'DELETE')
await test('run artifact API refuses a symlink planted inside a completed run workspace', async () => {
  const workflow = {
    schemaVersion: 2,
    id: workflowId,
    name: 'Safe files live artifact',
    permissions: { 'write-files': true },
    nodes: [
      { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
      { id: 'write', type: 'write-file', position: { x: 300, y: 0 }, data: { label: 'Write', path: 'output.txt' } },
      { id: 'out', type: 'output', position: { x: 600, y: 0 }, data: { label: 'Output' } },
    ],
    edges: [{ id: 'a', source: 'in', target: 'write' }, { id: 'b', source: 'write', target: 'out' }],
  }
  let result = await request('/api/workflows', 'POST', workflow); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  result = await request(`/api/workflows/${workflowId}/run`, 'POST', { input: 'safe-output' }); if (!result.response.ok) throw new Error(JSON.stringify(result.body))
  const run = await waitRun(result.body.runId); if (run.status !== 'done') throw new Error(JSON.stringify(run))
  const planted = path.join(run.dir, 'escape.txt'); fs.symlinkSync(outsideFile, planted)
  const artifact = await request(`/api/runs/${run.id}/artifact?name=escape.txt`)
  if (artifact.response.status !== 400 || String(artifact.body).includes('must-not-cross-boundary')) throw new Error(JSON.stringify({ status: artifact.response.status, body: artifact.body }))
})

await request(`/api/workflows/${workflowId}`, 'DELETE')
for (const target of [fileLink, directoryLink]) { try { fs.unlinkSync(target) } catch {} }
fs.rmSync(outside, { recursive: true, force: true })
console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`)
process.exitCode = failed ? 1 : 0
