# Phase 02 — SQLite compatibility & migrations

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 01
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Read/write existing guild databases without data loss or unintended schema change.

- [ ] Schema/data row counts and key values retain parity on fixtures; crash/restart and rollback pass; never open live production DB in CI.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/db/**; rust-backend/tests/sqlite_compat.rs; fixtures from copies of existing test DB; docs/plans/rust-backend-migration/contracts.md

**Work:** Implement root and data/guilds/<guild-id>.sqlite path rules, read/transaction access and migrations as needed, compare sqlite_master/schema and PRAGMA user_version; preserve TEXT snowflakes, epochs, WAL and rollback; test backups and writes on cloned data only.

**Known risks, rollback:** Before operational cutover back up bot.sqlite, every guild .sqlite plus -wal/-shm, seeds and media; no destructive migration.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 01, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Tests demonstrate wrong-id rejection, read compatibility, transaction rollback, WAL-safe read and no unexpected schema changes against immutable copies.
3. Implement smallest unit: Implement root and data/guilds/<guild-id>.sqlite path rules, read/transaction access and migrations as needed, compare sqlite_master/schema and PRAGMA user_version; preserve TEXT snowflakes, epochs, WAL and rollback; test backups and writes on cloned data only.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test sqlite_compat; existing Bun storage tests
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test sqlite_compat` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
