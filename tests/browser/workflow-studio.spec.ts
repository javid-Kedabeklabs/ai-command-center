import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cc-onboarded', '1')
    localStorage.setItem('cc-mode', 'guided')
  })
  await page.goto('/?page=pipelines&onboarding=skip')
  await expect(page.getByLabel('Complexity mode')).toBeVisible()
})

test('all workflow modes remain accessible and share one canvas', async ({ page }) => {
  const workflowSelector = page.getByLabel('Workflow', { exact: true })
  await expect(workflowSelector).toBeVisible()

  for (const mode of ['easy', 'guided', 'pro', 'developer']) {
    await page.getByLabel('Complexity mode').getByRole('button', { name: mode, exact: true }).click()
    await expect(workflowSelector).toBeVisible()
    await expect(page.locator('.workflow-studio-v2')).toHaveClass(new RegExp(`mode-${mode}`))
    const report = await new AxeBuilder({ page }).analyze()
    const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
    expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])
  }
})

test('keyboard command palette opens and closes without losing workflow access', async ({ page }) => {
  await page.keyboard.press('Meta+k')
  await expect(page.locator('.palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.palette')).toBeHidden()
  await expect(page.getByLabel('Workflow', { exact: true })).toBeVisible()
})

test('Agent Architecture migration is explicit, reversible, and preserves ambiguous choices', async ({ page }) => {
  const editorId = 'browser-migration-editor'
  await page.request.post('/api/agents', { data: { id: editorId, avatar: '✍️', name: 'Editor', role: 'Editor', department: 'Editorial', model: 'lmstudio/test-writer', prompt: 'Edit carefully.', folder: '.tmp/browser-editor', permissions: 'readonly' } })
  await page.goto('/?page=agents&onboarding=skip')
  await expect(page.getByTestId('agent-migration-summary')).toContainText('architecture revision')

  const editorMigration = page.getByTestId(`agent-migration-${editorId}`)
  await expect(editorMigration).toContainText('Role decision required')
  const migrateButton = editorMigration.getByRole('button', { name: 'Create versioned architecture' })
  await expect(migrateButton).toBeDisabled()
  await editorMigration.getByLabel('Primitive for Editor').selectOption('writer')
  await expect(migrateButton).toBeEnabled()

  page.once('dialog', dialog => dialog.accept())
  await migrateButton.click()
  const identity = page.getByTestId(`agent-architecture-${editorId}`)
  await expect(identity).toContainText('writer primitive')
  await identity.click()
  await expect(identity).toContainText('Role Card: legacy-browser-migration-editor')

  page.once('dialog', dialog => dialog.accept())
  await identity.getByRole('button', { name: 'Use legacy fallback' }).click()
  await expect(page.getByTestId(`agent-migration-${editorId}`)).toContainText('Role decision required')
  await page.request.delete(`/api/agents/${editorId}`)

  const report = await new AxeBuilder({ page }).analyze()
  const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])
})

test('AI Collaboration truthfully exposes durable review-gated worker state', async ({ page }) => {
  await page.goto('/?page=collaboration&onboarding=skip')
  const center = page.getByTestId('collaboration-center')
  await expect(center).toBeVisible()
  await expect(center).toContainText('Codex owns architecture and integration')
  await expect(center).toContainText('Automatic integration: disabled')
  await expect(center).toContainText('Live dispatch remains disabled')
  const response = await page.request.get('/api/collaboration/status')
  expect(response.ok(), await response.text()).toBeTruthy()
  const status = await response.json()
  expect(status.dispatchEnabled).toBe(false)
  expect(status.policy).toMatchObject({ centralRuntimeWriter: 'codex', modifyingWorker: 'claude-fable', reviewer: 'qwen-read-only', automaticIntegration: false })
  const report = await new AxeBuilder({ page }).include('[data-testid="collaboration-center"]').analyze()
  const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])
})

test('keyboard editing, reduced motion, responsive layout, and canvas visuals remain deterministic', async ({ page }) => {
  const workflowId = 'browser-ux-deterministic'
  const workflow = {
    schemaVersion: 2,
    id: workflowId,
    name: 'Browser UX deterministic',
    environment: 'development',
    nodes: [
      { id: 'input', type: 'input', position: { x: 70, y: 150 }, data: { label: 'Keyboard input' } },
      { id: 'check', type: 'delay', position: { x: 360, y: 150 }, data: { label: 'Keyboard check', ms: 1 } },
      { id: 'output', type: 'output', position: { x: 650, y: 150 }, data: { label: 'Keyboard output' } },
    ],
    edges: [
      { id: 'input-check', source: 'input', target: 'check' },
      { id: 'check-output', source: 'check', target: 'output' },
    ],
  }
  const saved = await page.request.post('/api/workflows', { data: workflow })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  await page.reload()
  await page.getByLabel('Workflow', { exact: true }).selectOption(workflowId)
  await expect(page.locator('.react-flow__node')).toHaveCount(3)

  const check = page.locator('.react-flow__node[data-id="check"]')
  await check.click()
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.locator('.studio-notice')).toContainText('Copied 1 workflow item')
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('.studio-notice')).toContainText('Pasted 1 workflow item')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await page.keyboard.press('Escape')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  await page.keyboard.press('/')
  await expect(page.locator('.library-search input')).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await page.locator('.studio-node').first().evaluate(element => element.classList.add('state-running'))
  await expect.poll(() => page.locator('.studio-node').first().evaluate(element => {
    const style = getComputedStyle(element)
    return { animation: style.animationName, transitionSeconds: Number.parseFloat(style.transitionDuration) }
  })).toEqual({ animation: 'none', transitionSeconds: 0.00001 })

  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('.studio-canvas-region')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible()

  await page.locator('.studio-notice button').click().catch(() => undefined)
  await page.locator('.library-search input').fill('')
  await page.locator('.studio-canvas-region').getByRole('button', { name: 'Fit', exact: true }).click()
  await expect.poll(() => page.locator('.react-flow__viewport').getAttribute('style')).toContain('transform:')
  await expect(page.locator('.studio-canvas-region')).toHaveScreenshot('workflow-canvas.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('Company World authors durable empty departments without inventing work', async ({ page }) => {
  const name = `Browser Department ${Date.now().toString(36)}`
  await page.goto('/?page=world&onboarding=skip')
  await expect(page.getByText('2D Employee Operations Map')).toBeVisible()
  await page.getByRole('button', { name: 'Manage departments' }).click()
  await page.getByLabel('Department name').fill(name)
  await page.getByRole('button', { name: 'Create department' }).click()
  const department = page.locator('[data-department-id]').filter({ hasText: name })
  await expect(department).toContainText('0 workers')
  await expect(department).not.toContainText(/running|waiting|paused/i)
  const report = await new AxeBuilder({ page }).include('.company-world').analyze()
  const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])
  await page.on('dialog', dialog => dialog.accept())
  await department.getByRole('button', { name: `Delete ${name} department` }).click()
  await expect(department).toHaveCount(0)
})

test('reusable components round-trip only through staged manifest review', async ({ page }) => {
  const id = `browser-component-${Date.now().toString(36)}`
  const workflow = {
    schemaVersion: 2,
    id,
    name: `Browser reusable ${id}`,
    environment: 'development',
    metadata: { component: { reusable: true, archived: false, description: 'Portable browser fixture' } },
    nodes: [
      { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
      { id: 'out', type: 'output', position: { x: 300, y: 0 }, data: { label: 'Output' } },
    ],
    edges: [{ id: 'edge', source: 'in', target: 'out' }],
  }
  expect((await page.request.post('/api/workflows', { data: workflow })).ok()).toBe(true)
  const exportedResponse = await page.request.get(`/api/workflow-components/${id}/manifest`)
  expect(exportedResponse.ok()).toBe(true)
  const manifest = await exportedResponse.json()
  expect(manifest.rootComponentId).toBe(id)
  expect((await page.request.delete(`/api/workflows/${id}`)).ok()).toBe(true)
  const staged = await (await page.request.post('/api/workflow-components/imports', { data: manifest })).json()
  expect(staged.status).toBe('review-required')
  expect(staged.review.approvable).toBe(true)
  const approved = await (await page.request.post(`/api/workflow-components/imports/${staged.proposalId}/decision`, { data: { decision: 'approve' } })).json()
  expect(approved).toMatchObject({ ok: true, status: 'installed' })
  const restored = await (await page.request.get(`/api/workflows/${id}`)).json()
  expect(restored.metadata.component.reusable).toBe(true)
  expect(restored.nodes).toHaveLength(2)
  await page.goto('/?page=pipelines&onboarding=skip')
  await page.getByRole('button', { name: 'Reusable', exact: true }).click()
  const component = page.locator('.library-node').filter({ hasText: id }).last()
  await expect(component).toBeVisible()
  await expect(component.getByRole('button', { name: 'Export' })).toBeVisible()
  expect((await page.request.delete(`/api/workflows/${id}`)).ok()).toBe(true)
})

test('workflow settings truthfully manage every persisted trigger state', async ({ page }) => {
  const now = Date.now()
  await page.route('**/api/triggers/history?**', route => route.fulfill({ json: {
    items: [
      { id: 'delivery-interval', triggerId: 'trigger-interval', status: 'started', runId: 'run-interval', updatedAt: now },
      { id: 'delivery-deleted', triggerId: 'trigger-deleted', status: 'failed', runId: null, updatedAt: now - 1_000 },
    ],
    nextCursor: null,
  } }))
  await page.route('**/api/triggers?**', route => route.fulfill({ json: [
    { id: 'trigger-interval', workflowId: 'content-factory', type: 'interval', enabled: true, config: { intervalMs: 120_000, timezone: 'UTC', overlapPolicy: 'queue-one' } },
    { id: 'trigger-cron', workflowId: 'content-factory', type: 'cron', enabled: false, config: { cron: '0 9 * * 1-5', timezone: 'America/Los_Angeles', overlapPolicy: 'skip' } },
    { id: 'trigger-webhook', workflowId: 'content-factory', type: 'webhook', enabled: true, secretRevision: 4, webhookCredentialStatus: 'revoked', config: {} },
    { id: 'trigger-folder', workflowId: 'content-factory', type: 'folder', enabled: true, folderStatus: 'needs-review', folderValidationReason: 'Approved root is unavailable.', config: { path: '/approved/inbox', extensions: ['pdf'] } },
  ] }))

  await page.goto('/?page=pipelines&onboarding=skip')
  await page.getByLabel('Workflow', { exact: true }).selectOption('content-factory')
  await page.getByRole('button', { name: 'schedule', exact: true }).click()

  const manager = page.locator('.trigger-manager')
  const definitions = manager.locator('.trigger-manager-list')
  await expect(definitions.getByText('Interval', { exact: true })).toBeVisible()
  await expect(definitions.getByText('Cron schedule', { exact: true })).toBeVisible()
  await expect(definitions.getByText('Secure webhook', { exact: true })).toBeVisible()
  await expect(definitions.getByText('Watched folder', { exact: true })).toBeVisible()
  await expect(manager.getByText('Disabled', { exact: true })).toBeVisible()
  await expect(manager.getByText('Credential revoked', { exact: true })).toBeVisible()
  await expect(manager.getByText('Needs review', { exact: true })).toBeVisible()
  await expect(manager.getByText('Deleted trigger', { exact: true })).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Rotate credential' })).toBeEnabled()
  await expect(manager.getByRole('button', { name: 'Revoke' })).toBeDisabled()

  const report = await new AxeBuilder({ page }).include('.trigger-manager').analyze()
  const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])
})

test('live backend saves, versions, approves, completes, and exposes safe run evidence', async ({ page }) => {
  const suffix = Date.now().toString(36)
  const workflowId = `browser-evidence-${suffix}`
  const workflow = {
    schemaVersion: 2,
    id: workflowId,
    name: `Browser evidence ${suffix}`,
    settings: { restartRecovery: true },
    nodes: [
      { id: 'in', type: 'input', position: { x: 80, y: 160 }, data: { label: 'Input' } },
      { id: 'approve', type: 'human-approval', position: { x: 360, y: 160 }, data: { label: 'Owner approval', message: 'Approve the live browser journey', timeoutMs: 30_000 } },
      { id: 'out', type: 'output', position: { x: 640, y: 160 }, data: { label: 'Output' } },
    ],
    edges: [
      { id: 'edge-in-approve', source: 'in', target: 'approve' },
      { id: 'edge-approve-out', source: 'approve', target: 'out' },
    ],
  }

  const saveResponse = await page.request.post('/api/workflows', { data: workflow })
  expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy()
  const saved = await saveResponse.json()
  expect(saved.id).toBe(workflowId)

  const runResponse = await page.request.post(`/api/workflows/${workflowId}/run`, { data: { input: 'browser-live-payload' } })
  expect(runResponse.ok(), await runResponse.text()).toBeTruthy()
  const { runId } = await runResponse.json()

  let approval: any = null
  await expect.poll(async () => {
    const response = await page.request.get(`/api/runs/${runId}/detail`)
    const detail = await response.json()
    approval = Object.values(detail.control?.approvals || {})[0]
    return approval?.state
  }).toBe('pending')

  const worldWhileWaiting = await (await page.request.get('/api/company-world/state')).json()
  const authoritativeWorldRun = worldWhileWaiting.activeRuns.find((item: any) => item.id === runId)
  expect(authoritativeWorldRun).toMatchObject({ status: 'waiting-approval', currentNodeId: 'approve', pendingApprovalCount: 1 })
  expect(authoritativeWorldRun.checkpointRevision).toBeGreaterThan(0)
  expect(authoritativeWorldRun.activity).toBe('Waiting for 1 durable approval')
  expect(authoritativeWorldRun).not.toHaveProperty('events')

  const decisionResponse = await page.request.post(`/api/workflows/runs/${runId}/nodes/approve/approval`, { data: {
    decision: 'approved',
    commandId: `browser-approve-${suffix}`,
    expectedRevision: approval.revision,
    expectedSubjectHash: approval.subjectHash,
    comment: 'approved by live browser acceptance test',
  } })
  expect(decisionResponse.ok(), await decisionResponse.text()).toBeTruthy()

  await expect.poll(async () => {
    const response = await page.request.get(`/api/runs/${runId}/detail`)
    return (await response.json()).status
  }).toBe('done')

  await page.getByRole('button', { name: /Runs$/ }).click()
  await page.locator(`[data-run-id="${runId}"]`).click()
  const evidence = page.getByTestId('run-evidence')
  await expect(evidence).toBeVisible()
  await expect(evidence).toContainText('Evidence receipt')
  await expect(evidence).toContainText('approve approved')
  await expect(evidence).toContainText('out')
  await expect(evidence).not.toContainText('browser-live-payload')
})

test('workflow governance advances only through exact immutable candidate evidence', async ({ page }) => {
  const suffix = Date.now().toString(36)
  const workflowId = `browser-governance-${suffix}`
  const saveResponse = await page.request.post('/api/workflows', { data: {
    schemaVersion: 2,
    id: workflowId,
    name: `Browser governance ${suffix}`,
    environment: 'development',
    governance: { status: 'draft', locked: false },
    nodes: [
      { id: 'in', type: 'input', position: { x: 80, y: 160 }, data: { label: 'Input' } },
      { id: 'out', type: 'output', position: { x: 640, y: 160 }, data: { label: 'Output' } },
    ],
    edges: [{ id: 'edge-in-out', source: 'in', target: 'out' }],
  } })
  expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy()

  await page.reload()
  await page.getByLabel('Workflow', { exact: true }).selectOption(workflowId)
  await page.getByRole('button', { name: 'governance', exact: true }).click()
  const panel = page.getByTestId('workflow-governance')
  await expect(panel).toContainText('State: development')
  await panel.getByRole('button', { name: 'Prepare immutable candidate' }).click()
  await expect(panel).toContainText('DEVELOPMENT CANDIDATE')

  const candidatesResponse = await page.request.get(`/api/workflows/${workflowId}/candidates`)
  const [candidate] = await candidatesResponse.json()
  const candidateRunResponse = await page.request.post(`/api/workflows/${workflowId}/run`, { data: { input: 'candidate-evidence-output', candidateId: candidate.id, workflowVersion: candidate.workflowVersion } })
  const { runId: candidateRunId } = await candidateRunResponse.json()
  await expect.poll(async () => {
    const response = await page.request.get(`/api/runs/${candidateRunId}/detail`)
    return (await response.json()).status
  }).toBe('done')
  const suiteId = `browser-gate-${suffix}`
  const suiteResponse = await page.request.post('/api/evaluations', { data: { id: suiteId, name: `Browser gate ${suffix}`, workflowId, checks: [{ id: 'contains-output', type: 'contains', value: 'candidate-evidence-output' }] } })
  expect(suiteResponse.ok(), await suiteResponse.text()).toBeTruthy()
  const datasetId = `browser-dataset-${suffix}`, datasetSuiteId = `browser-dataset-gate-${suffix}`
  const datasetResponse = await page.request.post('/api/evaluation-datasets', { data: { id: datasetId, name: `Browser dataset ${suffix}`, cases: [{ id: 'exact-output', input: 'candidate-evidence-output', expected: 'candidate-evidence-output' }] } })
  expect(datasetResponse.ok(), await datasetResponse.text()).toBeTruthy()
  const datasetSuiteResponse = await page.request.post('/api/evaluations', { data: { id: datasetSuiteId, name: `Browser dataset gate ${suffix}`, workflowId, datasetId, checks: [{ id: 'deterministic', type: 'contains', value: 'candidate-evidence-output' }] } })
  expect(datasetSuiteResponse.ok(), await datasetSuiteResponse.text()).toBeTruthy()

  page.on('dialog', dialog => dialog.accept())
  await panel.getByRole('button', { name: 'Prepare exact Testing candidate' }).click()
  await expect(panel).toContainText('State: testing-candidate')
  await panel.getByRole('button', { name: 'Approve exact Testing candidate' }).click()
  await expect(panel).toContainText('State: testing-approved')
  await panel.getByRole('button', { name: 'Enter Testing with approved version' }).click()
  await expect(panel).toContainText('State: testing')
  await expect(panel).toContainText('Environment: testing')

  const lifecycleResponse = await page.request.get(`/api/workflows/${workflowId}/lifecycle`)
  const lifecycle = await lifecycleResponse.json()
  expect(lifecycle.approvals).toHaveLength(1)
  expect(lifecycle.approvals[0].candidateId).toBeTruthy()
  expect(lifecycle.approvals[0].workflowVersion).toBeTruthy()
  const report = await new AxeBuilder({ page }).include('[data-testid="workflow-governance"]').analyze()
  const blocking = report.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([])

  await page.getByRole('button', { name: /Advanced Tools/ }).click()
  await page.getByRole('button', { name: /Evaluation Lab$/ }).click()
  await page.getByLabel('Workflow', { exact: true }).selectOption(workflowId)
  await page.getByLabel('Attach evaluation to an exact workflow run').selectOption(candidateRunId)
  await expect(page.getByTestId('evaluation-run-evidence')).toContainText('Exact candidate evidence')
  const suiteCard = page.locator('.eval-suite').filter({ hasText: `Browser gate ${suffix}` })
  await suiteCard.getByRole('button', { name: 'Run evaluation' }).click()
  await expect(suiteCard).toContainText('Promotable receipt')
  await suiteCard.getByRole('button', { name: 'Set latest as baseline' }).click()
  await suiteCard.getByRole('button', { name: 'Run evaluation' }).click()
  await expect(suiteCard.getByTestId('evaluation-baseline-delta')).toContainText('Baseline 100% · +0 points')
  const datasetSuiteCard = page.locator('.eval-suite').filter({ hasText: `Browser dataset gate ${suffix}` })
  await datasetSuiteCard.getByTestId('dataset-case-runs').getByRole('combobox').selectOption(candidateRunId)
  await datasetSuiteCard.getByRole('button', { name: 'Run dataset evaluation' }).click()
  await expect(datasetSuiteCard).toContainText('100% · PASS')
  await expect(datasetSuiteCard).toContainText('Promotable receipt')

  const runList = await (await page.request.get('/api/runs')).json()
  const safeSummary = runList.find((item: any) => item.id === candidateRunId)
  expect(safeSummary).toMatchObject({ workflowId, workflowVersion: candidate.workflowVersion, candidateId: candidate.id, environment: 'development' })
  expect(safeSummary).not.toHaveProperty('dir')
})

test('controlled learning exposes deterministic failures for a human decision without mutating the source', async ({ page }) => {
  const suffix = Date.now().toString(36), workflowId = `browser-learning-${suffix}`
  const workflow = { schemaVersion: 2, id: workflowId, name: `Browser learning ${suffix}`, permissions: { 'read-files': true }, settings: { retries: 0 }, nodes: [{ id: 'missing', type: 'read-file', position: { x: 80, y: 160 }, data: { label: 'Missing fixture', path: 'missing.txt' } }], edges: [] }
  let response = await page.request.post('/api/workflows', { data: workflow })
  expect(response.ok(), await response.text()).toBeTruthy()
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await page.request.post(`/api/workflows/${workflowId}/run`, { data: { input: '' } })
    const { runId } = await response.json()
    await expect.poll(async () => (await (await page.request.get(`/api/runs/${runId}/detail`)).json()).status).toBe('failed')
  }

  await page.reload()
  await page.getByRole('button', { name: /Advanced Tools/ }).click()
  await page.getByRole('button', { name: /Evaluation Lab$/ }).click()
  await page.getByLabel('Workflow', { exact: true }).selectOption(workflowId)
  await page.getByRole('button', { name: 'Analyze failures for learning proposals' }).click()
  const proposal = page.locator(`.learning-proposal[data-workflow-id="${workflowId}"]`).filter({ hasText: 'Add a regression evaluation for the repeated failure' })
  await expect(proposal).toContainText('2 exact run receipts')
  await proposal.getByRole('button', { name: 'Reject' }).click()
  await expect(proposal).toContainText('rejected')
  const source = await (await page.request.get(`/api/workflows/${workflowId}`)).json()
  expect(source.settings.retries).toBe(0)
})

test('imported plugins require an exact manifest-bound review receipt', async ({ page }) => {
  const suffix = Date.now().toString(36)
  const pluginId = `browser-plugin-${suffix}`
  const installResponse = await page.request.post('/api/plugins/install', { data: { plugin: {
    id: pluginId,
    name: `Browser plugin ${suffix}`,
    version: '1.0.0',
    publisher: 'Browser acceptance fixture',
    license: 'MIT',
    permissions: [],
    dependencies: [],
    nodes: [],
  } } })
  const installed = await installResponse.json()
  expect(installed.trustStatus).toBe('untrusted')
  expect(installed.enabled).toBe(false)
  expect(installed.manifestHash).toMatch(/^[a-f0-9]{64}$/)

  const staleReview = await page.request.post(`/api/plugins/${pluginId}/review`, { data: { decision: 'approve', by: 'browser-test', expectedManifestHash: '0'.repeat(64) } })
  expect(staleReview.status()).toBe(409)
  const reviewResponse = await page.request.post(`/api/plugins/${pluginId}/review`, { data: { decision: 'approve', by: 'browser-test', expectedManifestHash: installed.manifestHash } })
  const reviewed = await reviewResponse.json()
  expect(reviewed.reviewReceipt.manifestHash).toBe(installed.manifestHash)
  expect(reviewed.reviewReceipt.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  const packageTest = await (await page.request.post(`/api/plugins/${pluginId}/test`)).json()
  expect(packageTest.passed).toBe(true)
  expect(packageTest.manifestHash).toBe(installed.manifestHash)
  const exported = await (await page.request.get(`/api/plugins/${pluginId}/export`)).json()
  expect(exported).toMatchObject({ schemaVersion: 1, kind: 'ai-command-center/plugin', manifestHash: installed.manifestHash, plugin: { id: pluginId, version: '1.0.0' } })
  expect(exported.plugin).not.toHaveProperty('trustStatus')

  await page.getByRole('button', { name: /Advanced Tools/ }).click()
  await page.getByRole('button', { name: /Extensions$/ }).click()
  const card = page.locator(`[data-plugin-id="${pluginId}"]`)
  await expect(card).toContainText('trusted')
  await expect(card).toContainText('Review receipt')
  await expect(card).toContainText('browser-test')
  await expect(card.getByRole('button', { name: 'Test package' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Export JSON' })).toBeVisible()

  await page.request.delete(`/api/plugins/${pluginId}`)
})
