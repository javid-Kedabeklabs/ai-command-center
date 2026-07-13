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
