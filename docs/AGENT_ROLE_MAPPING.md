# Agent Primitive and Role Card Amendment

Status: audit complete; additive schema foundation in progress; no legacy data migrated.

## Model

```text
Agent Primitive
  + versioned Role Card
  + isolated Agent Instance
  + Workflow Assignment
  = visible specialized worker
```

The initial primitive vocabulary is `ORCHESTRATOR`, `PLANNER`, `RESEARCHER`, `ANALYST`, `CODER`, `REASONER`, `WRITER`, `REVIEWER`, `VERIFIER`, `ROUTER`, `SECURITY`, `QA_REGRESSION`, `RELEASE_MANAGER`, and `QUICK_WORKER`. New primitives require evidence of fundamentally different reasoning/runtime behavior that cannot be expressed by instructions, skills, rubrics, scopes, permissions, tools, or workflow configuration.

Role Cards are versioned references to a primitive plus display identity, department, organizational class (`CORE`, `SHARED_SERVICE`, `DOMAIN_SPECIALIST`, `MISSION`), instructions, model policy, skills, tools, knowledge/memory scopes, permission profile, rubric/mode, assignment scope, UI identity, and Company World profile. Per-instance overrides are explicit and audited; resolution must deep-copy mutable configuration.

## Audited current state

The live agent store currently has three reusable definitions: `coder`, `reasoner`, and `quick`, mapping to `CODER`, `REASONER`, and `QUICK_WORKER`. Most other named workers are templates, labels, or plan concepts rather than independent runtime types. Existing IDs and workflow references must be preserved. Existing fields named `role` have multiple meanings, so new persistence uses explicit `primitiveId` and `roleCardId`.

The current `coder` definition includes broad permissions. Migration preview preserves this fact but flags it for explicit permission review rather than silently expanding or reducing access.

## Consolidation rules

- Critic/Visual Critic/Code Reviewer/Requirement Evaluator/Relevance Scorer/Judge become `REVIEWER` Role Cards with rubric and `REVIEW_ONE|COMPARE_N|MERGE_BEST|SCORE_ONLY|APPROVE_OR_REJECT`; critique iteration is a bounded workflow loop.
- Citation/Fact/Contradiction roles become `VERIFIER` with different skills and scopes.
- Web/document/chapter/repository/transcript research roles become `RESEARCHER` assignments and tool profiles.
- Security roles share `SECURITY`; browser QA, benchmark, and regression roles share `QA_REGRESSION`.
- Telemetry/performance/routing analysis roles share `ANALYST`; only logical selection uses `ROUTER`.
- Python/frontend/creative frontend roles share `CODER`; writing roles share `WRITER`.
- Executive managers/directors are visible Role Cards over `ORCHESTRATOR`, `ANALYST`, or `REASONER` as appropriate.
- Ambiguous labels—such as Editor, Refiner, Multi-Model, creative production titles, General Assistant, and some executive roles—remain preview-only until reviewed.

Human approval is a Human Gate. Loops, retry, voting, comparison fan-out, timeouts, budgets, triggers, checkpoints, scheduling, formatting, schema validation, deterministic tests, deployment, health checks, and rollback are workflow/runtime services—not LLM primitives. Hardware and concurrency are enforced by the deterministic Resource Scheduler.

## Nondestructive migration order

1. Inventory named agents and references.
2. Add primitive, Role Card, rubric, version, and legacy-reader schemas.
3. Resolve Role Cards into current runtime configuration without behavior changes.
4. Generate a preview preserving ID/name/prompt/model/avatar/folder/tools/skills/permissions and provenance; flag ambiguity.
5. Update UI advanced views while preserving Easy Mode identities and Company World employees.
6. Move behavioral aliases to deterministic services while retaining compatible readers.
7. Migrate only verified records; keep source and rollback evidence.

Department packs package Role Cards, skills, knowledge/tool/rubric/permission references, and workflow templates; they normally add no primitive runtime code.
