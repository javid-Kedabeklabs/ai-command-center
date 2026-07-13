# AI Command Center Architecture

AI Command Center is a local-first React/TypeScript client with a Node/Express control plane. Portable workflow definitions remain JSON; high-volume operational stores may move to SQLite only through tested migrations.

The architectural invariant is one canonical, versioned workflow document. Easy, Guided, Pro, and Developer modes are projections of that document. The runtime consumes the same document after migration, static validation, permission checks, and typed-port validation.

Current backend modules include workflow schema migration, typed ports, dependency scheduling, persistent trigger services, and the existing route/runtime host. Incremental extraction from `server/index.js` is tracked in [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md).

Operational truth flows from persisted runs and runtime events to the Workflow Studio, Run Center, Evaluation Lab, and Company World. Visualization layers must never invent work.
