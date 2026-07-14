# Evaluation Model

Evaluation suites contain versioned checks and bounded history. Deterministic checks support contains, not-contains, minimum length, JSON validity, regular expressions, maximum persisted-run duration, and absence of unresolved effect review. Artifact adapters consume typed version-1 visual-regression, Axe/accessibility, and security reports from the exact persisted run directory. Each result binds the report filename and SHA-256; missing, malformed, oversized, wrong-kind, or failing reports fail closed. Results include score, pass/fail, individual evidence, timestamp, exact candidate/run provenance, and optional baseline comparison; attached results are persisted into the run record.

Workflows may declare required evaluation IDs as production promotion gates. Missing or failing exact evidence blocks promotion. Visual, accessibility, and security artifact reports may supplement deterministic checks but may never be the sole judge for consequential promotion. Model-graded evaluators remain a later optional adapter and will have the same restriction.

Artifact report shape:

```json
{
  "schemaVersion": 1,
  "kind": "visual | accessibility | security | model",
  "passed": true,
  "evaluatorVersion": "required for model reports",
  "rubricHash": "64-character SHA-256 required for model reports",
  "summary": {
    "pixelDiffRatio": 0,
    "critical": 0,
    "serious": 0,
    "high": 0,
    "score": 90
  }
}
```

Visual suites configure an artifact and optional `maxDiffRatio`; accessibility suites may configure `maxCritical` and `maxSerious`; security suites may configure `maxCritical` and `maxHigh`; model reports require a versioned evaluator, rubric SHA-256, bounded 0–100 score, and optional `minScore` (80 by default). Model grading is produced by an ordinary permission-controlled local or optional external model workflow and persisted as a run artifact—there is no hidden evaluation egress. The simple browser editor accepts the artifact filename and fail-closed defaults. Rich thresholds remain available through the canonical JSON API. Artifact/model reports cannot be the sole production judge.

Learning proposals are durable, versioned, source-hash-bound observations. Stable finding fingerprints deduplicate repeated analysis while accumulating exact run IDs. Decisions carry replay-safe command receipts. An approval may create a deterministic, separate Development candidate, but never edits the observed source or promotes anything automatically. If the source hash changes after observation, approval fails stale. The candidate must pass the ordinary evaluation and Development/Testing/Production lifecycle, preserving its immutable versions and rollback receipts.

Versioned datasets persist separately from suites. Each case has a stable ID, input, expected value, and `equals`, `contains`, or canonical `json-equals` matcher. Dataset definition hashes cover every case. A promotable dataset receipt requires exactly one completed persisted run per case, all bound to the same immutable candidate, workflow version, environment, permissions, secret manifest, and dependency hashes. Aggregate evidence stores case input/output hashes and run IDs; missing, duplicate, path-invalid, cross-candidate, or stale dataset evidence fails closed. The browser lets the owner author datasets, attach them to suites, map exact candidate runs to cases, and execute the aggregate gate.
