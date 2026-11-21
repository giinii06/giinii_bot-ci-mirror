# Phase 07 — Rust Activity HTTP/auth integration

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 06
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Keep the existing Vite/TypeScript Activity UI unchanged while replacing its backend API.

- [ ] Existing Activity UI loads from Rust HTTP server and mock contract requests match (or documented Q12 improvements).
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/http/**; rust-backend/tests/activity_contract.rs; existing activity/src/** only if contract tests demand a documented improvement

**Work:** Implement static dist serving and `/api/activity/config`, `/api/session/activity`, `/api/session`, `/api/graph`, avatar proxy; enforce bearer token, x-activity-instance, Discord membership and rate-limit logic; compare response codes and JSON schemas.

**Known risks, rollback:** Protect OAuth and session tokens, proxy URL validation and same-guild authorization.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 06, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Tests for expired/replayed token, mismatched activity-instance, denied membership, stale graph and invalid periods.
3. Implement smallest unit: Implement static dist serving and `/api/activity/config`, `/api/session/activity`, `/api/session`, `/api/graph`, avatar proxy; enforce bearer token, x-activity-instance, Discord membership and rate-limit logic; compare response codes and JSON schemas.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test activity_contract; bun run build:activity
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test activity_contract` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
