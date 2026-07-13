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
