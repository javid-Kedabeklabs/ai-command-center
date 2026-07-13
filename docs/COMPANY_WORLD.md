# 2D Employee Operations Map

The Employee Operations Map is an operational projection, not a separate simulation database.

The static 2D Operations Map is implemented from `/api/company-world/state`: persisted agents/departments/workflows, active run records, latest runtime events, model/service/resource status, assignment, cancellation, and navigation. Consistency tests prove runs appear only while active.

Interactive offices, cinematic 3D, and employee animation are explicitly deferred and excluded from the current product definition of done. They are not advertised as installable render modes. Any future reconsideration must use this same real-state projection and remain optional.

Visible employees remain unique Role Cards and Agent Instances even when they share a runtime primitive. The map may vary display name, static avatar, department, skills, assignment, and textual status without creating duplicate runtime engines. Advanced inspection links the employee to its `primitiveId`, `roleCardId`/version, permissions, and rubric. No visual identity may share mutable memory or configuration with another instance implicitly.
