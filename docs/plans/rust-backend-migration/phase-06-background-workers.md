# Phase 06 — Media, backfill, recovery and scheduled work

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 05
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Port resilient media/history ingestion and backup while retaining idempotent persistence.

- [ ] No duplicate rows or truncated files after injected failures; restart resumes recorded progress.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/workers/**; rust-backend/tests/recovery.rs; restore/rollback runbook

**Work:** Bound concurrency, channel paging, media retries and checksums, periodic voice tick, seed archives, backup and restart resume. Validate crash-injection on temp directory only.

**Known risks, rollback:** Keep old Bun recovery and backups available; no production backfill triggered by CI.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 05, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Tests for duplicate events, interrupted file writes, partial batch resume, timeouts, growing media and out-of-order events.
3. Implement smallest unit: Bound concurrency, channel paging, media retries and checksums, periodic voice tick, seed archives, backup and restart resume. Validate crash-injection on temp directory only.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test recovery; deterministic existing Bun fixture parity
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; trigger existing GitLab→GitHub Actions bridge, verify SHA and pipeline ID then inspect actual GitHub Actions jobs/checkout SHA and relevant tests. Do not require GitLab Runner or mistake dispatch for passed tests. If GitHub logs inaccessible, mark blocked.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check` in GitHub Actions | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test` in GitHub Actions | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity` in GitHub Actions | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test recovery` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | GitHub Actions ARM64 runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.

### Selected CI provider (2026-11-22 clarification)

This phase must run its applicable Bun/Rust/ARM64 checks in **GitHub Actions**; GitLab provides repository and trigger/status plumbing only. Match exact GitLab SHA and GitHub checked-out commit, preserve GitHub run job/log evidence, and never count a dispatch-only GitLab job as a test. See [bridge notes](ci-github-actions.md). No GitLab Runner setup is required.
