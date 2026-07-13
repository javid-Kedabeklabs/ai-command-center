# Governance and Promotion Hardening Plan

Status: REQUIRED SECURITY WORK. The current partial governance implementation is not sufficient for production promotion or Continuous Evolution. Use Development for active authoring until this plan is verified.

Checkpoint 2026-07-13: commits `0b66977` and `d924120` implement and verify the first shared mutation boundary. Ordinary save, restore, delete, bundle overwrite, trigger mutation, reusable-component mutation, and learning adoption reject locked or malformed Production records; reserved fields and unsafe import identities fail closed; imported agents cannot retain elevated permissions; import/learning decisions are single-use; and learning creates an immutable Development candidate instead of mutating its source. Evidence: governance 14/14 live, import 4/4, trigger store 17/17, reusable components 9/9, evaluation 3/3, security 4/4, runtime contract 36/36, smoke 30/30, TypeScript/build, Gitleaks, and completed HTTP-200 host receipt `host-371067bb007b2655`. Exact operational candidates/runs, exact evaluation evidence, enforced multi-step lifecycle, permission/secret ceilings, migration, and truthful lifecycle UI remain required.

Checkpoint 2026-07-13: commit `ac10328` implements immutable operational candidates and exact evaluation evidence. Candidate and persisted-run records bind workflow/version/source, operational, permission, named-secret-manifest, dependency, and environment hashes. Evaluation suites have deterministic definition hashes; empty/unknown checks fail closed; ad hoc output is non-promotable; promotable records require an exact completed persisted run and candidate; and promotion requires explicitly selected integrity-bound evidence rather than mutable latest history. Stale workflow/suite, cross-candidate, incomplete, missing, and tampered evidence is rejected. Evidence: immutable evidence 7/7, exact live gate 8/8, governance 14/14, import 4/4, trigger 17/17, components 9/9, security 4/4, recovery 36/36, smoke 30/30, TypeScript/build, and Gitleaks. Additive migration, enforced multi-step lifecycle, permission/secret ceilings, and truthful lifecycle UI remain required.

Checkpoint 2026-07-13: the additive lifecycle core is implemented and verified against fresh isolated state. It normalizes Development/Testing/Production without discarding safe extensions, marks inconsistent legacy Production and legacy approval/evaluation history review-required or legacy-unbound, rejects direct promotion, enforces exact candidate/hash/gate bindings through Testing and Production, records immutable single-use approvals via append-only consumption records, and creates integrity-bound deployment/rollback records. Evidence: lifecycle 16 pure + 2 live, immutable evidence 7/7, exact evaluation 9/9, import 4/4, security 4/4, Phase 0 contract 37/37, live secret references 5/5, trigger store 17/17, reusable components 9/9, smoke 30/30, TypeScript, production build, and clean diff checks. Host request `host-b532365979b0ff78` completed with HTTP 200; a final integrated host reload remains required after commit. Permission/secret ceilings and truthful lifecycle UI remain open, so Production is not yet release-trusted.

## Confirmed gaps

- Ordinary workflow save trusts client-controlled `_unlock` and preserves unknown fields, allowing a lock bypass.
- Ordinary saves can directly set `environment: production`; new workflows can be created there without a valid locked deployment lifecycle.
- Locked workflows can currently be deleted or restored without the same production guard.
- Bundle overwrite and direct learning-proposal application can mutate workflow JSON outside a shared governance boundary.
- Evaluation promotion checks use mutable/latest history rather than exact workflow, version, candidate, suite, run, evaluator, and permission/secret/dependency hashes.
- Empty suites and unknown check kinds can pass; ad hoc caller-supplied output is not distinguished from promotable persisted-run evidence.
- Direct Development-to-Production promotion exists without mandatory Testing evidence or a single-use exact human decision.
- Permission behavior is default-allow unless explicitly denied; environment ceilings and a general named-secret resolver are incomplete.

## Required implementation order

### 1. One mutation boundary

Create `server/governance/environments.js`, `server/governance/mutations.js`, and `server/governance/audit.js`. Every save, environment transition, restore, delete, import, trigger mutation, reusable-component mutation, learning application, and future Evolution adoption must pass through it.

Reject reserved server-owned fields such as `_unlock` from ordinary saves. Ordinary saves cannot change environment. New Testing/Production records cannot be created through the draft-save endpoint. Sensitive operations require expected hashes, explicit actions/reasons/actors, and redacted accepted/denied audit evidence.

### 2. Backward-compatible migration

Add an additive canonical migration that validates only Development, Testing, and Production; normalizes lifecycle and integrity state; stores immutable candidate/approval/deployment references; and preserves unknown safe fields. Inconsistent legacy Production records become `review-required`, not silently trusted. Legacy approvals/evaluation histories remain visible but `legacy-unbound` and cannot satisfy gates. Back up and report before persisted rewrites.

### 3. Exact immutable candidates and runs

Define a canonical operational hash covering graph, code/prompts, settings, permissions, named secret references, dependencies, triggers, evaluations, plugin/custom-node pins, and subworkflow pins. Exclude mutable audit timestamps. Runs bind exact workflow/version/candidate, effective permission and secret-manifest hashes, environment, and executor/schema version.

### 4. Exact evaluation evidence

Create versioned evaluation schema/store/runner modules and bind every promotable result to suite definition/hash, workflow, exact candidate, persisted run, environment, evaluator version, and timestamp. Reject empty/unknown checks. Caller-supplied output is explicitly non-promotable. Editing any operational field or suite invalidates prior evidence.

### 5. Enforced lifecycle

Required sequence:

`Development candidate -> approved for Testing -> in Testing -> production candidate -> exact human production approval -> deployed -> monitored/accepted or rolled back`

No direct Development-to-Production transition. Compatibility routes must require exact target/version/hash, selected gate-result IDs, and a single-use approval-decision ID. Promotion re-resolves under lock, verifies exact hashes/gates/dependencies/permissions/secrets/reviews, creates deployment and rollback records, locks executable content, and audits all references.

### 6. Secrets and permission ceilings

Add canonical capabilities and deny-wins composition across environment, workflow, node, agent, plugin/custom node, and inherited policies. Testing denies external publication/destructive effects by default; Production requires an explicit reviewed allowlist. Requested plugin/custom-node permissions are ceilings requiring review, never implicit grants.

General secrets are named references only, with values in macOS Keychain. APIs expose configured/missing status, never values. Resolve immediately before authorized execution; never persist values in workflows, runs, checkpoints, logs, prompts, errors, exports, or artifacts. Inline credential-shaped fields fail at save/import/promotion boundaries.

### 7. Imports, learning, and Evolution

Imports cannot overwrite Production identities and imported executables remain Development/import-review. Imported agents cannot retain elevated permissions without a separate permission decision. Learning and Evolution produce immutable Development candidates and human-readable diffs; approval authorizes candidate creation, never direct production mutation. Autonomy Levels 0–5 stop at their documented ceilings.

### 8. Truthful lifecycle UI

Replace direct environment editing with lifecycle status/actions: prepare/approve Testing, prepare/approve Production, unlock into a Development revision, rollback, and inspect exact candidate/gates/permissions/secrets/stale evidence. No UI action may imply a promotion the backend cannot prove.

## Verification

Add `scripts/governance-lifecycle-tests.mjs` and expand evaluation/import/security tests to cover lock bypass, reserved fields, environment spoofing, protected save/restore/delete/import/learning/trigger paths, stale hashes, forbidden transitions, invalid suites, non-promotable ad hoc evidence, cross-candidate evidence, suite invalidation, permission/secret/dependency invalidation, environment ceilings, exact single-use decisions, rollback, redacted audit, migration, and restart durability.

Governance is verified only when every mutation uses the shared guard; runs/evaluations/approvals/deployments bind exact immutable hashes; the environment sequence is enforced; permissions/secrets have runtime ceilings; Production cannot be changed through alternate routes; rollback is exact and audited; migrations preserve legacy data without trusting it; and focused plus live regression gates pass.

This plan is a prerequisite for `docs/CONTINUOUS_EVOLUTION.md` implementation.
