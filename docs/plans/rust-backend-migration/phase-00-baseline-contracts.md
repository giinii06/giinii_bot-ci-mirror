# Phase 00 — Baseline & compatibility contracts

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** none
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Freeze observable Bun/TypeScript behavior and its contracts before any Rust implementation.

- [ ] Contract inventory covers Discord commands, permissions, AI state, voice/time statistics, media/backfill, Activity session/auth/graph, and SQLite path/transaction semantics. Existing Bun CI jobs are executed for the exact branch SHA.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** docs/plans/rust-backend-migration/contracts.md; existing test/** and src/** are read-only here

**Work:** Inventory slash/prefix commands and privilege gates; record Activity HTTP endpoints and JSON/HTTP semantics; inventory root/guild SQLite layout, migration side-effects, WAL, seed/media, environment settings; establish baseline job output, fixtures, failure cases and rollback references.

**Known risks, rollback:** Don't touch production DB, tokens or Discord APIs. Maintain baseline logs and no source changes.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase none, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: N/A: read-only behavior inventory. Pin actual baseline Bun CI and capture observed tests; don't claim a fabricated RED.
3. Implement smallest unit: Inventory slash/prefix commands and privilege gates; record Activity HTTP endpoints and JSON/HTTP semantics; inventory root/guild SQLite layout, migration side-effects, WAL, seed/media, environment settings; establish baseline job output, fixtures, failure cases and rollback references.
4. GREEN/test: bun run check; bun test (CI unit_tests runs each test file separately); bun run build:activity
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | not applicable; docs-only phase | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
