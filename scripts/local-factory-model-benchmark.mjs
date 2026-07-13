#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createLmStudioFactoryClient } from '../server/local-factory/lmstudio-client.js'
import { loadLocalFactoryContext } from '../server/local-factory/context-loader.js'
import { validateLocalFactoryTask } from '../server/local-factory/task-schema.js'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/local-factory-benchmark/cases.json'), 'utf8'))
const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null
const concurrency = Number(process.argv.includes('--concurrency') ? process.argv[process.argv.indexOf('--concurrency') + 1] : 1)
if (![1, 2, 4].includes(concurrency)) throw new Error('concurrency must be 1, 2, or 4')
const client = createLmStudioFactoryClient()

const queue = [...cases], results = [], started = Date.now()
async function worker() {
  while (queue.length) {
    const current = queue.shift(), caseStarted = Date.now()
    const task = validateLocalFactoryTask({ schemaVersion: 1, taskId: `benchmark-${current.id}`, status: 'QUEUED', taskType: 'CODE_REVIEW', workerRole: 'REVIEWER', title: `Benchmark ${current.id}`, objective: current.objective, background: 'Known-answer repository benchmark. Cite exact evidence and do not invent findings.', contextFiles: [current.file], acceptanceCriteria: ['Return only mechanically supported findings.'], priority: 50, timeoutSeconds: 300, maxInputBytes: 100_000, maxOutputTokens: 2_048, temperature: 0.1, model: 'qwen-coder-factory' })
    const context = loadLocalFactoryContext({ repositoryRoot: root, files: task.contextFiles, maxInputBytes: task.maxInputBytes })
    try {
      const response = await client.run(task, context)
      const findings = response.result.findings, matched = new Set()
      let truePositive = 0, falsePositive = 0
      for (const finding of findings) {
        const index = current.expected.findIndex((expected, candidate) => !matched.has(candidate) && expected.category === finding.category && finding.startLine <= expected.endLine && finding.endLine >= expected.startLine)
        if (index >= 0) { matched.add(index); truePositive++ } else falsePositive++
      }
      results.push({ id: current.id, ok: true, latencyMs: Date.now() - caseStarted, truePositive, falsePositive, falseNegative: current.expected.length - matched.size, findingVerification: response.result.findingVerification, findings, model: response.model })
    } catch (error) {
      results.push({ id: current.id, ok: false, latencyMs: Date.now() - caseStarted, error: error.message, truePositive: 0, falsePositive: 0, falseNegative: current.expected.length })
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
const totals = results.reduce((sum, item) => ({ tp: sum.tp + item.truePositive, fp: sum.fp + item.falsePositive, fn: sum.fn + item.falseNegative }), { tp: 0, fp: 0, fn: 0 })
const precision = totals.tp / Math.max(1, totals.tp + totals.fp), recall = totals.tp / Math.max(1, totals.tp + totals.fn)
let physicalModels = null
try { physicalModels = JSON.parse(execFileSync('lms', ['ps', '--json'], { encoding: 'utf8' })) } catch {}
const report = { schemaVersion: 1, createdAt: new Date().toISOString(), concurrency, wallTimeMs: Date.now() - started, totals, precision, recall, f1: 2 * precision * recall / Math.max(Number.EPSILON, precision + recall), schemaValidRate: results.filter(item => item.ok).length / results.length, physicalModels, results: results.sort((a, b) => a.id.localeCompare(b.id)) }
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (report.schemaValidRate < 0.98) process.exitCode = 2
