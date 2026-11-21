# Phase 04 — Voice, chat stats, graph and cards

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 03
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Preserve time-window counters, affinity and graph API data for existing Activity UI.

- [ ] Historical and newly generated fixture counters/graph JSON parity within explicitly documented numeric tolerances.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/stats/**; rust-backend/src/voice/**; rust-backend/tests/stats_parity.rs

**Work:** Port session settlement, overlap merging, ranking/ties, backfill-derived counters; snapshot schemas and validation; keep existing TypeScript Activity UI; compare Rust to fixed Bun fixture outputs, not necessarily legacy implementation internals.

**Known risks, rollback:** Do not import old napi-rs MR branch wholesale; reuse verified ideas only after main-based revalidation.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 03, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Negative fixtures for overlap/double-counting, voice leave/join, missing members, timestamp overflow and tie ordering.
3. Implement smallest unit: Port session settlement, overlap merging, ranking/ties, backfill-derived counters; snapshot schemas and validation; keep existing TypeScript Activity UI; compare Rust to fixed Bun fixture outputs, not necessarily legacy implementation internals.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test stats_parity; compare deterministic Bun fixture outputs
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test stats_parity` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
