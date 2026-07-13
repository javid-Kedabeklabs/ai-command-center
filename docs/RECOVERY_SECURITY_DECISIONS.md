# Recovery, Security, and AI-Factory Decision Record

Status: ACTIVE DESIGN CONTRACT

Recorded: 2026-07-13
Inputs: three independent, repository-free expert responses supplied by the owner. These inputs are advisory evidence, not authority. Repository behavior, deterministic tests, and the canonical product contract remain authoritative.

## Central invariant

The recovery contract is **exactly-once-or-stop**:

> A logical node execution may recover automatically only when the runtime proves the effect did not happen, deduplicates it with a stable logical operation key, or reconciles it to an authoritative receipt. Otherwise it becomes durably `needs_review`.

The product must never claim universal exactly-once delivery to an external system. It guarantees that each effect is either proven once, safely retryable, or durably stopped for review.

## Expert-answer disposition, questions 1–20

| # | Topic | Decision | Delivery status | How it helped |
|---:|---|---|---|---|
| 1 | Per-node checkpoint schema | ADOPT, adapted to the existing atomic-JSON store. Use logical execution keys, versioned per-node state, physical attempts, runtime epochs, input hashes, effect phase, output/receipt references, and snapshot revision. Do not make a new JSONL journal mandatory before proving it improves the current store. | NEXT CRITICAL SLICE | Replaced the unsafe single `lastNodeId`/topological-prefix recovery model with a concrete migration target. |
| 2 | Idempotency/reconciliation | ADOPT `exactly-once-or-stop` and per-node-class policies. Operation keys remain stable across attempts. | NEXT CRITICAL SLICE | Gives one honest rule for HTTP, file, MCP, process, model, and trigger recovery. |
| 3 | Durable approval/pause | ADOPT durable approval CAS and command receipts. Manual pause is an orthogonal state and approval never clears it. | PLANNED AFTER 1–2 | Resolves restart loss, stale decisions, malformed decisions, and replay behavior without conflating pause states. |
| 4 | Loopback HTTP hardening | ADOPTED IN PART. Exact loopback Host/Origin/Fetch-Metadata boundary and browser session are implemented. Retain cookie/session design unless a measured token-file design improves usability and safety. Add route-specific idempotency/intent receipts incrementally for destructive operations. | IMPLEMENTED; residual hardening open | Confirmed the chosen request-class separation and identified future duplicate-Host, forwarded-header, and durable-intent tests. |
| 5 | Central redaction | ADOPTED IN PART. Central API/run/checkpoint/audit/artifact/export redaction and exact resolved-secret registration are implemented. Streaming subprocess/model/MCP chunk redaction, safe evidence DTOs, and broader encoded-canary proof remain. | IMPLEMENTED CORE; expansion open | Validated that sink-level centralization is preferable to node-by-node scrubbing and supplied a stronger canary matrix. |
| 6 | Symlink-safe filesystem | ADOPTED PRACTICAL NODE/MACOS BOUNDARY. Canonical roots, parent-chain `lstat`, regular-file checks, safe parent creation, final `O_NOFOLLOW`, and integrated escape tests are implemented. Do not claim full adversarial TOCTOU elimination. | IMPLEMENTED CORE; CAS/root identity open | Prevented a false security claim and established the correct residual-risk wording and future native-helper seam. |
| 7 | Deny-wins permissions | ADOPTED. Environment, parent/subworkflow, workflow, node, custom-node, and plugin policy can only narrow authority. Testing/Production require exact reviewed grants; unknown environments/capabilities fail closed. | IMPLEMENTED CORE | Directly closed permission restoration and undeclared plugin/custom capability paths. |
| 8 | Shell/Python policy | REJECT `sandbox-exec` as a supported production security boundary. Preserve full Development functionality. Testing/Production require explicit exact reviewed capabilities today; release policy may deny these nodes until a supported sandbox/reconciliation contract passes. | POLICY PARTIAL; release decision open | Avoids an unsupported/deprecated sandbox project while preserving the long-term full product scope. |
| 9 | Hermetic crash journey | ADOPT. Build one deterministic multi-crash journey using temporary app/brain/home state, fake HTTP/MCP/model/trigger services, explicit failpoints, immutable workflow version, parallel branches, approval, trigger dedupe, restart, and canary evidence. | PLANNED AFTER 1–3 | Converts release readiness from prose and host-dependent scripts into one reproducible integration contract. |
| 10 | Property/model testing | ADOPT incrementally after the pure execution reducer exists. Start with deterministic generated traces without adding a library; add `fast-check` only if shrinking materially improves diagnosis. | PLANNED | Identifies stale-attempt, crash-order, approval-conflict, cancellation, and permission-monotonicity bugs example tests miss. |
| 11 | Delegation metrics | ADOPT accepted calendar lead time, first-pass acceptance, review/rework, escaped defects, queue wait, and task class/risk. Routing changes require a meaningful measured advantage. | FOUNDATION EXISTS; instrumentation open | Replaces model reputation and raw response speed with verified delivery economics. |
| 12 | Worker allocation | ADOPT. Codex owns state/security semantics and integration; Fable gets stable isolated UI/test contracts; Qwen remains cited read-only reconnaissance/pre-review until promoted. | ACTIVE POLICY | Prevents multiple writers from independently designing the same security-critical contract. |
| 13 | Local-model benchmark | ADOPT repo-specific frozen tasks, hidden tests, citation support, structured output, forbidden-file checks, throughput, VRAM, and acceptance/rework metrics. No promotion from public benchmarks alone. | FUTURE, NOT RELEASE CRITICAL | Provides a safe answer to whether another local model actually makes this project faster. |
| 14 | Embeddings/reranking | DEFER. First measure lexical/import-graph context recall. Adopt only if fixed-token-budget task acceptance or review time improves materially without VRAM contention. | DEFERRED EXPERIMENT | Prevents retrieval infrastructure from displacing release-critical runtime work. |
| 15 | Controlled learning | ADOPT. Observations are append-only; learned artifacts may improve routing, task packets, retrieval hints, prompts, and checklists but never authority, security policy, gates, or expected test results. All promotions are versioned, evaluated, reviewed, canaried, and reversible. | CONTRACT EXISTS; implementation dependency-gated | Turns “self-learning” into controlled evidence-based improvement rather than unsafe self-modification. |
| 16 | Blocker fingerprints | ADOPT failure-class retry budgets, environment hashes, explicit progress invariants, and quarantine after repeated no-progress. No blind retry of ambiguous effects or host permission failures. | FOUNDATION EXISTS; refine with runtime work | Prevents death loops without prematurely quarantining failures after a causal environment change. |
| 17 | `server/index.js` seams | ADOPT narrow characterization-backed seams only: request guard, safe filesystem/output, run store, pure execution reducer, and approval reducer. No broad route rewrite or TypeScript conversion. | FIRST THREE PARTLY EXTRACTED; reducer/store next | Reduces the central collision point while avoiding a destabilizing rewrite. |
| 18 | Verification cadence | ADOPT risk/cadence tiers: focused deterministic gates per patch, full integration at checkpoint, crash/property/race suites nightly, packaging/host/rollback gates at release candidate. | PARTLY ACTIVE | Preserves fast feedback without using narrow tests to make broad release claims. |
| 19 | Work ordering | ADOPT adjusted sequence: permission/filesystem checkpoint; per-node snapshot/reducer; side-effect adapters; durable approval/pause; hermetic journey; evidence expansion; release burn-down. | ACTIVE PLAN | Keeps one central-runtime writer on the dependency spine and lets stable tests/UI work parallelize later. |
| 20 | AI-worker improvements | ADOPT contract-complete task packets, deterministic model/service fixtures, cited Qwen pre-review, failure categorization, and measured context caching only when supported by the current local server. | PARTLY ACTIVE; measurement open | Targets review/rework and test latency rather than merely increasing agent count. |

## Rejected or corrected expert claims

1. **Never include attempt count in an external idempotency key.** The key identifies one logical effect and must remain stable across retries. `hash(workflowId, nodeId, attemptCount)` is unsafe.
2. **Do not assume an MCP server can query a prior JSON-RPC transaction.** Retry/reconciliation authority must come from an explicitly trusted tool contract, stable operation ID, or companion status query.
3. **Do not make deterministic model sampling a recovery guarantee.** Model retries can differ despite temperature/seed; persist accepted output and keep model tools as separate effect nodes.
4. **Do not trust MCP annotations by themselves.** They are advisory unless bound to a trusted, reviewed server/tool registry entry.
5. **Do not ship `sandbox-exec` as a supported production boundary.** A development experiment is not a release security guarantee.
6. **Do not load every Keychain secret at startup for redaction.** Resolve only authorized references at transport boundaries and register those exact values in memory.
7. **Do not accept `text/plain` for general state-changing APIs.** Route-specific content types are explicit; ordinary mutations use JSON.
8. **Do not require a new database or append-only journal merely because the design is attractive.** The current atomic single-writer JSON store remains canonical until a fault test proves a migration is necessary.
9. **Do not use global “two retries” logic.** Permission, stale-version, conflict, ambiguous-effect, schema, transient network, and deterministic test failures require different policies.
10. **Do not automatically merge embedding clusters or model findings.** Exact fingerprints remain authoritative; semantic grouping is advisory.

## Accepted recovery model

### Logical execution identity

`execKey` identifies one logical node invocation:

```text
SHA-256(
  runId
  || workflowVersionHash
  || inheritedSubworkflowPath
  || nodeId
  || loopIteration
  || fanoutOrdinal
  || fanoutItemHash
)
```

Physical attempts change across retry/restart. `execKey` and the external `operationKey` do not.

### Snapshot shape

```js
{
  schemaVersion: 2,
  revision: 12,
  runId,
  workflowVersionId,
  workflowVersionHash,
  runtimeEpoch,
  nodes: {
    [execKey]: {
      nodeId,
      inputHash,
      state: 'pending|running|waiting|succeeded|failed|cancelled|needs_review',
      attemptsStarted: 1,
      activeAttempt: {
        id,
        number,
        runtimeEpoch,
        phase: 'claimed|effect_prepared|effect_inflight|effect_confirmed|committing'
      },
      effect: {
        operationKey,
        requestHash,
        state: 'prepared|inflight|confirmed|ambiguous',
        receiptRef
      },
      wait: { kind: 'approval|effect_review', ref },
      outputRef,
      outputHash,
      lastErrorRef
    }
  }
}
```

The scheduler derives readiness from the immutable DAG and terminal predecessor states. A persisted ready queue is never the sole recovery source. Worker results commit only when execution key, input hash, runtime epoch, and current attempt ID still match.

### Restart rules

| Recovered state | Required action |
|---|---|
| `running`, no external effect | Abandon old epoch attempt and retry within budget. |
| effect `prepared` | Safe to retry because dispatch was not authorized. |
| effect `inflight` | Reconcile; never blindly retry an uncooperative mutation. |
| effect `confirmed` | Finalize output/success without reissuing the effect. |
| effect `ambiguous` | Persist `needs_review`. |
| `succeeded`, `failed`, `cancelled` | Never execute as a fresh attempt during recovery. |
| waiting on approval | Restore the same durable approval record. |

## Effect policy

- HTTP read-only requests may retry under a bounded transient policy. Mutations retry only with destination-supported idempotency or authoritative reconciliation.
- File writes use expected prior state, same-directory temporary content, flush, atomic replacement, and final hash receipt. Append becomes immutable segments or compare-and-swap.
- MCP mutations require trusted registry policy plus stable operation ID/status reconciliation; otherwise ambiguity stops.
- Shell, Python, and custom executables are assumed externally effectful unless a reviewed pure or check/apply contract proves otherwise.
- Model generation is computational, but accepted output is checkpointed; hidden tool calls are prohibited and tools execute as separate nodes.
- Trigger delivery retains its persisted delivery identity and deduplication contract.

## Durable approval and pause

Approval binds to exact run, logical node execution, workflow version, input, effective permission hash, requested action, and redacted argument hash. The decision API requires approval ID, expected revision/subject hash, strict decision enum, and globally unique command ID. Exact replays return the original receipt; conflicting replay returns conflict; stale state fails precondition. The decision is durably committed before a success response.

Manual pause has its own generation and idempotent pause/resume commands. Approval never resumes a manually paused run.

## Hermetic release journey

The required journey uses temporary state and deterministic fake services. It must prove:

1. Typed graph validation and immutable version binding.
2. Parallel branch execution.
3. Crash after remote effect commit but before local receipt.
4. Reconciliation without a second logical effect.
5. Crash while approval is pending.
6. Durable approval replay/conflict/stale semantics.
7. Duplicate trigger delivery converging on one run.
8. Atomic artifact completion.
9. Redacted evidence through restart and export.
10. Hostile request rejection.

No assertion may rely on sleeps, a live model, the user Keychain, persistent product data, or LaunchAgent availability.

## Controlled learning artifacts

Append-only observations may record task class, repository revision, route, worker, task-packet version, acceptance, review/rework, test failures, blockers, rollbacks, and escaped defects. Derived candidates may contain task templates, retrieval hints, prompt fragments, failure signatures, checklists, routing priors, and benchmark cases.

Security policy, authority, redaction rules, retry authority, release gates, code ownership, and expected test results are never model-writable. Candidate learning artifacts require historical replay, independent review, low-risk canary use, immutable version/hash, and pointer-based rollback. Routing evidence decays; security incident lessons require explicit retirement.

## Measurement contract

The routing objective is verified accepted work per lead-attention hour, with calendar lead time as the principal delivery metric. Track queue wait, worker latency, first-pass acceptance, review time, rework, gate failures, quarantine, escaped defects, and accepted requirement weight by task class/risk/size. A routing/model change must demonstrate a meaningful advantage without quality or security regression.

## Next implementation sequence

1. Commit and host-verify the completed permission/filesystem slice.
2. Add characterization tests for the legacy checkpoint/recovery behavior.
3. Introduce the versioned per-node snapshot and pure transition/recovery reducer.
4. Route node classes through effect preparation/inflight/confirmation/reconciliation.
5. Add durable `needs_review` and effect-review commands.
6. Add durable approval and orthogonal manual pause.
7. Build the hermetic multi-crash release journey.
8. Add property/model traces, streaming canary expansion, and release burn-down.

## Explicit non-goals for this critical path

- No database or workflow-engine replacement.
- No `sandbox-exec` production claim.
- No broad `server/index.js` rewrite.
- No second canonical workflow representation.
- No new local model based on marketing benchmarks.
- No embeddings/reranking without the measured A/B gate.
- No uncontrolled self-modifying prompts, skills, policies, tests, or routing.
- No blind retry of ambiguous effects or known host/sandbox blockers.
