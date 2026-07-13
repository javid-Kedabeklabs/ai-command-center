# Continuous Intelligence and Controlled Evolution

Status: REQUIRED, dependency-gated. This document records the product contract for the External Intelligence and Technology Scout and the Internal Quality, Learning and Optimization Director. Implementation must begin only after durable runtime, evaluation, permission enforcement, and environment-promotion foundations are verified.

## Safety invariant

The only allowed lifecycle is:

`autonomous discovery -> autonomous analysis -> isolated sandbox experiment -> automated evaluation -> human-controlled adoption`

External content, telemetry, model output, discoveries, and experiments are evidence. They are never privileged instructions. No component may silently rewrite or promote production code, workflows, prompts, skills, permissions, plugins, tools, models, providers, or agent definitions.

## Departments

### External Intelligence and Technology Scout

The department monitors user-approved, terms-compliant sources and produces evidence-backed discoveries. Initial adapters are GitHub and user-supplied RSS/URLs; YouTube uses an approved Data API. Instagram, TikTok, Reddit, and other restricted sources are available only when an authorized API and suitable account eligibility exist. Unauthorized scraping is prohibited.

Agent templates:

- External Intelligence Director
- Source Monitor
- Trend Detector
- Content and Transcript Analyst
- Repository Analyst
- Architecture Comparison Agent
- Security Inspector
- License and Provenance Inspector
- Relevance Scoring Agent
- Sandbox Integration Engineer
- Benchmark Engineer
- Recommendation Writer

Discovery pipeline:

`source event -> normalized metadata -> deduplication -> claim extraction -> supporting evidence -> credibility -> architecture comparison -> capability gap -> relevance/risk/effort -> versioned proposal -> optional sandbox experiment`

Repository analysis is static-first. It records license, provenance, activity, maintainers, releases, issues, CI/tests, dependencies and install scripts, permissions, filesystem/network/secrets behavior, advisories, architecture, compatibility, and maintenance cost. Candidate code is not executed during initial inspection. Prefer native implementation of a useful design pattern over importing an external framework.

### Internal Quality, Learning and Optimization Director

The department analyzes persisted run, node, event, error, retry, timeout, cancellation, approval, evaluation, artifact, correction, rating, version, model, context, resource, tool, trigger, incident, and rollback evidence.

Agent templates:

- Internal Quality Director
- Runtime Telemetry Analyst
- Failure Pattern Detector
- Manager Feedback Analyst
- Agent Performance Analyst
- Workflow Efficiency Analyst
- Prompt and Skill Optimizer
- Model Routing Analyst
- Regression Engineer
- Security and Permission Auditor
- Release and Rollback Manager

Analysis includes normalized error clusters and correlations across workflows, agents, models, skills, tools, inputs, and environments. Efficiency findings cover duplicate work, redundant calls, excessive context or summarization, ineffective loops, unused skills, slow nodes, excessive retries, dead branches, unnecessary permissions, and stale or contradictory memory.

The manager satisfaction signal is transparent and configurable. It may use explicit ratings, accept/reject decisions, correction amount, reruns, replacements, unmodified approvals, export/deployment, abandonment, and restores. Every contribution and weight is visible and individually enabled or disabled. It never claims to infer emotion.

## Shared persisted lifecycle

Every transition is validated, persisted, versioned, and audited:

`DISCOVERED -> NORMALIZED -> EVIDENCE_COLLECTED -> SCORED -> PROPOSAL_CREATED -> SANDBOX_READY -> EXPERIMENT_RUNNING -> EXPERIMENT_COMPLETED -> SECURITY_REVIEWED -> LICENSE_REVIEWED -> REGRESSION_TESTED -> AWAITING_APPROVAL -> APPROVED_FOR_DEVELOPMENT -> IN_DEVELOPMENT -> APPROVED_FOR_TESTING -> IN_TESTING -> APPROVED_FOR_PRODUCTION -> DEPLOYED -> MONITORING -> ACCEPTED`

Terminal alternatives are `REJECTED`, `DUPLICATE`, `INCOMPATIBLE`, `UNSAFE`, `LICENSE_BLOCKED`, `INCONCLUSIVE`, `DEFERRED`, and `ROLLED_BACK`.

Transitions are monotonic except an explicit, audited rollback. Approval records bind to exact immutable proposal, experiment, evaluation, security-review, license-review, and candidate hashes; stale approvals never apply to a changed candidate.

## Autonomy levels

- Level 0, Observe: collect and report only.
- Level 1, Recommend: create proposals, never implementations.
- Level 2, Experiment: create isolated temporary prototypes and benchmarks only.
- Level 3, Development Integration: create a development branch or pull request after configured gates; no testing or production promotion.
- Level 4, Testing Promotion: promote an explicitly approved development candidate to testing and run relevant regression suites; no production promotion.
- Level 5, Production Candidate: prepare a candidate. Executable, permission, provider, migration, security-sensitive, and all final production promotions require explicit human approval.

Automatic rollback is permitted only under a preapproved, versioned health policy.

## Core entities

The durable model includes `intelligence_sources`, `intelligence_watchlists`, `intelligence_events`, `discoveries`, `discovery_evidence`, `repository_analyses`, `trend_clusters`, `improvement_findings`, `improvement_proposals`, `proposal_versions`, `experiments`, `experiment_runs`, `benchmark_results`, `security_reviews`, `license_reviews`, `approval_decisions`, `deployments`, `deployment_health`, `rollbacks`, `satisfaction_signals`, `failure_clusters`, and `optimization_findings`.

Every entity has a stable ID, timestamps, status, provenance, workspace, optional project, creator agent, version, and audit references. High-volume/event entities should use transactional persistence with migrations, portable exports, and backup/restore evidence rather than ad hoc JSON mutation.

## Proposal contract

A proposal records title, source and discovery date, credibility, summary, current behavior, finding and missing capability, implementation, affected components/files/workflows/agents/skills/permissions, dependencies, license, security/compatibility/migration risks, maintenance burden, expected quality/performance/resource effects, effort, test and benchmark plans, rollback plan, recommendation, confidence, and evidence references.

Human-readable architecture, workflow, prompt, skill, permission, dependency, and code diffs are required where applicable.

## Experiment isolation

Each experiment uses a temporary Git branch or worktree and workspace, restricted filesystem and network, no production secrets, isolated dependencies, bounded CPU/memory where practical, timeout and output limits, audit logs, and cleanup. Static inspection precedes execution of untrusted installation code.

Experiments cannot modify production workflows, data stores, AgentBrain, credentials, plugins, global package environments, or files outside the sandbox. Baseline and candidate are compared on success, coverage, quality, accuracy, citations, tests, latency, context/tokens, RAM/disk/model behavior, reliability, security, accessibility, interaction complexity, and maintenance cost.

## Source and scheduling policy

Watchlists store name, source type, URL/API ID, search terms, frequency, authentication reference, enabled state, priority, trust, tags, last check/success, and safe error state. Credentials remain secret references.

Persistent schedules use caching, conditional requests, webhooks, quotas, deduplication, backoff, and explicit source policies. They do not poll unnecessarily. Source payloads have bounded size and retention.

## API and UI surfaces

The Evolution Center contains Overview, External Intelligence, Internal Performance, Discoveries, Proposals, Experiments, Evaluations, Approvals, Adopted Improvements, Rejected Improvements, Watchlists, and Policies.

APIs cover source/watchlist CRUD, monitoring control and scans, discoveries, proposals, experiments and cancellation, benchmark comparison, approval/rejection, environment promotions, production preparation and approval, rollback, internal findings, satisfaction configuration, timeline, and report export. Every write validates permissions and writes a redacted audit event.

## Implementation program

This subsystem is dependency-gated and divided into bounded slices:

1. Evolution schema/store, migrations, immutable state transitions, proposal schema, permission checks, and audit/redaction tests.
2. Watchlists UI and scheduler integration, starting with deterministic fixture sources.
3. GitHub adapter using approved APIs, conditional requests, deduplication, static repository analysis, license/security review, and deterministic fixtures.
4. Internal run-analysis adapter, transparent satisfaction calculation, error normalization/clustering, and optimization findings.
5. Isolated experiment lifecycle with temporary worktree/workspace, no secrets, restricted execution, cleanup, cancellation, and restart recovery.
6. Baseline-versus-candidate benchmarks and binding evaluation/security/license gates.
7. Approval and development/testing/production promotion integration with exact candidate hashes and rollback.
8. Remaining approved source adapters, Evolution Center detail surfaces, policies, timelines, exports, and operational hardening.

Do not begin slice 1 until the durable execution, evaluation, permission, and promotion foundations it relies on are verified. Do not begin source-adapter expansion before the source/store security model and deterministic fixture suite pass.

## Verification and definition of done

Required deterministic coverage includes ingestion and deduplication, GitHub and YouTube fixtures, restricted-source behavior, persistent schedules, static analysis, license/security rejection, proposal versioning, sandbox boundaries, benchmarks, regression failures, approvals and environment limits, production blocking, rollback, transparent satisfaction calculation, clustering, prompt-injection separation, secret leakage, restart recovery, and concurrent duplicate events.

Completion requires functional configuration and monitoring, approved GitHub and YouTube APIs, graceful restricted-source failure, structured repository and architecture analysis, internal telemetry/failure/satisfaction analysis, versioned proposals, isolated experiments, comparative evaluation, enforced security/license/regression gates, visible diffs, controlled promotions, rollback, audited transitions, working Evolution Center UI, and synchronized documentation.
