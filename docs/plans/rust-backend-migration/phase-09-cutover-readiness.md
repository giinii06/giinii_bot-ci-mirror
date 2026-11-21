# Phase 09 — Cutover playbook, rollback and Draft MR

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 08
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Deliver reviewed nondeployed Rust backend with operational migration steps and complete evidence.

- [ ] Full branch verified; all phases evidence-backed; Draft MR targets main; no merge/deploy; TypeScript backend remains in repository for stabilization.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** docs/operations/rust-cutover.md; README.md / README_USER.md migration notes; docs/plans/rust-backend-migration/*

**Work:** Write new TOML/secret-env conversion table (Q11; no legacy aliases), backup/SHA checks, shutdown window, replay verification, rollback from preserved Bun source, CI artifact inventory and explicit untested Discord/production risks. Final two-lens review and Draft MR.

**Known risks, rollback:** Actual production cutover and data migration require separate explicit authorization.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 08, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: N/A for docs-only runbook; perform dry-run on fixtures and review every command before claiming runnable.
3. Implement smallest unit: Write new TOML/secret-env conversion table (Q11; no legacy aliases), backup/SHA checks, shutdown window, replay verification, rollback from preserved Bun source, CI artifact inventory and explicit untested Discord/production risks. Final two-lens review and Draft MR.
4. GREEN/test: all Rust/Bun configured checks on matching integration SHA, ARM64 Docker smoke only if actually executed, docs links/checks
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | `all Rust/Bun configured checks on matching integration SHA, ARM64 Docker smoke only if actually executed, docs links/checks` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
