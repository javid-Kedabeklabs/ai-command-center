import { defineConfig } from '@playwright/test'

const port = 18171

export default defineConfig({
  testDir: './tests/browser',
  outputDir: '.tmp/playwright-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['json', { outputFile: '.tmp/playwright-report.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npm run build && PORT=${port} ACC_DATA_DIR=.tmp/playwright-data ACC_BRAIN_DIR=.tmp/playwright-brain ACC_SKIP_AGENT_MIRROR=1 node server/index.js`,
    url: `http://127.0.0.1:${port}/api/system`,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
