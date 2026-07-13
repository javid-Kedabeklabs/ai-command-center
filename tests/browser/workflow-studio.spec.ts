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

  const runList = await (await page.request.get('/api/runs')).json()
  const safeSummary = runList.find((item: any) => item.id === candidateRunId)
  expect(safeSummary).toMatchObject({ workflowId, workflowVersion: candidate.workflowVersion, candidateId: candidate.id, environment: 'development' })
  expect(safeSummary).not.toHaveProperty('dir')
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

  await page.getByRole('button', { name: /Advanced Tools/ }).click()
  await page.getByRole('button', { name: /Extensions$/ }).click()
  const card = page.locator(`[data-plugin-id="${pluginId}"]`)
  await expect(card).toContainText('trusted')
  await expect(card).toContainText('Review receipt')
  await expect(card).toContainText('browser-test')

  await page.request.delete(`/api/plugins/${pluginId}`)
})
