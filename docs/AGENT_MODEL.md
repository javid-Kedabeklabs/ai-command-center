# Agent Model

The durable target separates Agent Primitive, versioned Role Card, Agent Instance, Workflow Assignment, and Run. The current store provides three reusable legacy definitions (`coder`, `reasoner`, and `quick`) plus run records; complete persistence/runtime wiring remains in progress.

The 14 initial primitives are Orchestrator, Planner, Researcher, Analyst, Coder, Reasoner, Writer, Reviewer, Verifier, Router, Security, QA/Regression, Release Manager, and Quick Worker. A Role Card specializes one primitive with instructions, model policy, skills, tools, knowledge/memory scopes, permission profile, rubric/mode, assignment scope, department, organizational class, UI identity, and Company World identity. New fields use `primitiveId` and `roleCardId` to avoid collision with existing meanings of `role`.

Existing identity, avatar, model, prompt, working folder, permissions, skills, and workflow references are preserved through a preview-only migration. Ambiguous names require review. Per-instance overrides are explicit and resolved into isolated copies so one role cannot mutate another role sharing the same primitive.

Loops, retry, comparison fan-out, gates, scheduling, resource enforcement, formatting, deployment, health checks, and rollback are deterministic workflow/runtime services—not agent primitives. Full mapping and migration rules are in `docs/AGENT_ROLE_MAPPING.md`.
