# ADR: Agent Primitives and Role Cards

Status: accepted as an additive, nondestructive architecture amendment, 2026-07-13.

## Context

The earlier plan described many specialized job titles in ways that could be mistaken for distinct runtime engines. This duplicates prompts, permissions, tools, evaluation behavior, and maintenance while conflating reasoning with deterministic workflow services.

## Decision

Use approximately 14 reusable reasoning primitives. Preserve the large expressive organization as versioned Role Cards, isolated Agent Instances, and Workflow Assignments. Keep runtime scheduling, resources, approval, triggers, formatting, deployment, health, and rollback in deterministic services. Easy Mode preserves role identities; advanced modes expose the underlying composition.

## Alternatives

One runtime type per job title was rejected as duplicative. One completely generic agent was rejected because explicit capability contracts, evaluation modes, and safety boundaries remain useful. A destructive immediate migration was rejected because existing identifiers, prompts, permissions, and workflow references require preview and rollback.

## Consequences

New domain workers usually require packages and configuration rather than runtime code. Resolver isolation and regression tests must prevent configuration or memory leakage between roles sharing a primitive. Legacy readers and aliases remain until verified migration. Ambiguous mappings require review. UI/Company World identities remain distinct from runtime implementation.
