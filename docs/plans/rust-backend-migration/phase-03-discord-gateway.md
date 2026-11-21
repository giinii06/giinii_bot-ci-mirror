# Phase 03 — Discord Gateway, permissions and commands

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 02
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Port event dispatch and slash/prefix command control with existing permission semantics.

- [ ] Existing slash/prefix contracts and admin denials covered by deterministic fake Discord interfaces.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/discord/**; rust-backend/src/commands/**; rust-backend/tests/discord_contract.rs

**Work:** Use a maintained Rust Discord SDK with async runtime; model message, voice and interaction event contracts; preserve per-guild filtering, owner/admin permissions, command registration, deferral and idempotency. No production bot login while in development.

**Known risks, rollback:** Actual Discord round-trip smoke out of scope of required CI (Q10); clearly flag untested live behavior.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 02, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Fixtures reject unauthorized owners and disabled guild commands, test slash/prefix routes and interaction timeout/defer behavior.
3. Implement smallest unit: Use a maintained Rust Discord SDK with async runtime; model message, voice and interaction event contracts; preserve per-guild filtering, owner/admin permissions, command registration, deferral and idempotency. No production bot login while in development.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test discord_contract; static command inventory parity
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; trigger existing GitLab→GitHub Actions bridge, verify SHA and pipeline ID then inspect actual GitHub Actions jobs/checkout SHA and relevant tests. Do not require GitLab Runner or mistake dispatch for passed tests. If GitHub logs inaccessible, mark blocked.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check` in GitHub Actions | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test` in GitHub Actions | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity` in GitHub Actions | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test discord_contract` (planned until job exists) | not executed | pending |
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
