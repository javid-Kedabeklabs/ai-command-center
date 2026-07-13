import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalModelFactory } from '../server/local-factory/index.js'

if (process.env.CC_LIVE_LOCAL_FACTORY !== '1') {
  console.error('Refusing live model usage without CC_LIVE_LOCAL_FACTORY=1')
  process.exit(2)
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const factory = createLocalModelFactory({ repositoryRoot, concurrency: 4, maxQueue: 8 })
const pilotId = Date.now().toString(36)
const common = {
  schemaVersion: 1,
  status: 'QUEUED',
  background: 'This is a read-only live factory pilot. Do not claim to edit files or execute tests.',
  priority: 50,
  timeoutSeconds: 300,
  maxInputBytes: 120_000,
  maxOutputTokens: 2_048,
  temperature: 0.1,
  model: 'qwen-coder-factory',
}

const tasks = [
  {
    ...common, taskId: `local-pilot-scheduler-${pilotId}`, taskType: 'REPOSITORY_AUDIT', workerRole: 'EXPLORER',
    title: 'Audit dependency scheduler', objective: 'Identify correctness and cancellation risks in the bounded dependency scheduler.',
    contextFiles: ['server/runtime/scheduler.js'], acceptanceCriteria: ['Identify only evidence-backed findings.', 'Recommend focused deterministic tests.'],
  },
  {
    ...common, taskId: `local-pilot-pool-tests-${pilotId}`, taskType: 'TEST_DESIGN', workerRole: 'TEST_ENGINEER',
    title: 'Design worker pool tests', objective: 'Design additional deterministic tests for priority, cancellation, shutdown, and fairness.',
    contextFiles: ['server/local-factory/worker-pool.js'], acceptanceCriteria: ['Return concrete test cases.', 'Do not claim that tests were run.'],
  },
  {
    ...common, taskId: `local-pilot-context-security-${pilotId}`, taskType: 'CODE_REVIEW', workerRole: 'REVIEWER',
    title: 'Review context isolation', objective: 'Review repository context isolation for traversal, links, secret paths, and size controls.',
    contextFiles: ['server/local-factory/context-loader.js', 'server/local-factory/task-schema.js'], acceptanceCriteria: ['Separate verified behavior from remaining risks.', 'Recommend bounded remediations.'],
  },
  {
    ...common, taskId: `local-pilot-client-review-${pilotId}`, taskType: 'CODE_REVIEW', workerRole: 'IMPLEMENTATION_ADVISOR',
    title: 'Review LM Studio client', objective: 'Review timeout, cancellation, response bounds, model pinning, and structured result handling.',
    contextFiles: ['server/local-factory/lmstudio-client.js', 'server/local-factory/result-parser.js'], acceptanceCriteria: ['Identify concrete defects or state that none were found.', 'Recommend focused tests.'],
  },
]

const startedAt = Date.now()
try {
  const settled = await Promise.allSettled(tasks.map(task => factory.submit(task)))
  const report = settled.map((entry, index) => entry.status === 'fulfilled'
    ? { taskId: tasks[index].taskId, status: entry.value.result.status, summary: entry.value.result.summary, findings: entry.value.result.findings.length, risks: entry.value.result.risks.length, model: entry.value.model, usage: entry.value.usage }
    : { taskId: tasks[index].taskId, status: 'FAILED', error: String(entry.reason?.message || entry.reason).slice(0, 500) })
  console.log(JSON.stringify({ model: 'qwen-coder-factory', concurrency: 4, durationMs: Date.now() - startedAt, tasks: report }, null, 2))
  if (settled.some(entry => entry.status === 'rejected')) process.exitCode = 1
} finally {
  factory.shutdown('live pilot complete')
}
