# Open-question ledger

This is the durable memory for material questions discovered through self-review. Ask “what are the open questions?” at any time and report every `OPEN` entry here. Never delete an entry; close it with evidence or supersede it explicitly.

Allowed states: `OPEN`, `ANSWERED`, `CLOSED`, `SUPERSEDED`.

## Q-0001 — Can a read-only Fable dispatch observe unreviewed source changes?

- Status: CLOSED
- Opened: 2026-07-13
- Last reviewed: 2026-07-13
- Owner: Codex
- Question: Contract hashes verify committed content, but could a read-only worker run in the dirty primary checkout and inspect different uncommitted source?
- Why it matters: That would break the reviewed-base claim even though the packet’s Git hashes passed.
- Current evidence: The dispatcher now checks primary-checkout cleanliness for every task before contract verification and permits only explicitly allowlisted runtime-data dirt.
- Next evidence needed: None.
- Resolution evidence: `server/collaboration/dispatcher.js`, `server/collaboration/worktree-manager.js`, and the `dirty-read-only` case in `scripts/collaboration-dispatcher-tests.mjs`.

## Q-0002 — Which project license should govern the public release?

- Status: OPEN
- Opened: 2026-07-13
- Last reviewed: 2026-07-13
- Owner: Project owner
- Question: Should the repository use MIT, Apache-2.0, AGPL-3.0, or another owner-selected license?
- Why it matters: Engineering packaging is verified, but the project remains `UNLICENSED` and cannot honestly be called open source.
- Current evidence: `package.json` and `docs/IMPLEMENTATION_STATUS.md` identify the legal release blocker.
- Next evidence needed: An explicit owner choice followed by a committed license and matching package/documentation metadata.
- Resolution evidence: Pending.

## Q-0003 — Does Fable reduce accepted calendar time in this repository?

- Status: OPEN
- Opened: 2026-07-13
- Last reviewed: 2026-07-13
- Owner: Codex
- Question: After review, rework, and integration overhead, which bounded task classes are genuinely faster with Fable than with Codex?
- Why it matters: Raw generation speed is not a valid delegation metric; only accepted delivery time without boundary or escaped defects justifies default routing.
- Current evidence: One real modifying pilot succeeded; the shadow metrics store has insufficient comparable observations for promotion.
- Next evidence needed: At least twelve accepted comparable observations with baseline estimates and all declared quality thresholds satisfied.
- Resolution evidence: Pending in `/api/collaboration/metrics` and the durable collaboration metrics store.

## Q-0004 — Does Qwen pre-review measurably reduce lead review cost?

- Status: OPEN
- Opened: 2026-07-13
- Last reviewed: 2026-07-13
- Owner: Codex
- Question: Does read-only Qwen pre-review catch useful issues without false blocking or adding more latency than it saves?
- Why it matters: An extra reviewer is acceleration only if it lowers accepted lead-review time without weakening authority boundaries.
- Current evidence: Qwen remains advisory and has no automatic authority; the promotion threshold has not accumulated enough observations.
- Next evidence needed: Twenty measured reviews, at least 25% accepted findings, zero false blockers, and lower median Codex review time.
- Resolution evidence: Pending in `/api/collaboration/metrics` and the durable collaboration metrics store.

## Q-0005 — Should the pinned local coding model be replaced?

- Status: OPEN
- Opened: 2026-07-13
- Last reviewed: 2026-07-13
- Owner: Codex
- Question: Does a candidate local model outperform the pinned `qwen-coder-factory` on the repository-specific benchmark without memory, latency, schema-validity, or citation regressions?
- Why it matters: Replacing a stable local model based on vendor claims could reduce reliability and compete for local resources.
- Current evidence: The current six-case baseline is recorded; replacement remains gated and no candidate has cleared it.
- Next evidence needed: Complete the same repo-specific benchmark for the candidate and apply the declared promotion thresholds.
- Resolution evidence: Pending in `docs/LOCAL_MODEL_FACTORY.md` and benchmark receipts.
