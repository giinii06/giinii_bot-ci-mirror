# Phase 00 — Baseline & compatibility contracts

**Status:** blocked
**Implemented:** yes (documentation and source contract inventory only)
**Tested:** blocked — exact-SHA Bun checks not executed; external bridge context failed
**Committed:** yes (initial plan/docs commit)
**Waiver evidence:** none
**Depends on:** none
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** `20031870cf236d25cec80911fb2f958f81dd8d87` (docs-only)
**Verified pipeline SHA / ID / URL:** `20031870cf236d25cec80911fb2f958f81dd8d87` / `3098258203` / https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203 — no executed Bun/Rust tests; bridge failed
**Evidence/checkpoint SHA:** plan commit 20031870; blocked-status docs checkpoint recorded in later commit history
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
6. Commit candidate; dispatch via GitLab's existing GitHub Actions bridge and verify actual **GitHub Actions** jobs, run inputs and checked-out **exact SHA**. A GitLab dispatch-only job is not a test. If GitHub run logs are inaccessible, mark blocked.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check` in GitHub Actions | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test` in GitHub Actions | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity` in GitHub Actions | not executed for this new branch | pending |
| Rust unit/integration | not applicable; docs-only phase | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **blocked**. No matching-SHA executed baseline test evidence. Do not advance to Phase 01.

## Observed result and two-lens self-review — 2026-11-22

**Source inventory completed:** reviewed `src/commands.ts`, `src/prefix-commands.ts`, `src/command-rules.ts`, `src/storage.ts`, `src/activity-auth.ts`, `src/activity-web-server.ts`, `src/config.ts` at base SHA; captured contracts.md and potential test fixtures. No runtime code changed.

**CI evidence:** [GitLab pipeline #3098258203](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203) at `20031870cf236d25cec80911fb2f958f81dd8d87` reported only `dispatch_github_actions=success`; `github-actions/ci-hub-request=failed` for the **same pipeline and SHA**; no test/build job logs. Failed request cannot be diagnosed as a Rust source defect, and a `success` dispatch cannot count as `bun test`. Base branch old Bun jobs passed on a different SHA; do not reuse as matching branch evidence.

**Requirements self-review:** contract inventory references the existing slash/prefix/permissions, SQLite and Activity routes, TypeScript UI unchanged, new Rust config and ARM64-first. Missing detailed fixture assertions will be implemented only after executable checks are available. **Quality/security self-review:** no tokens, production data, DB updates, branch overwrites or CI settings changed. Important operational risk: project CI currently only dispatches and lacks observed test execution. No independent review claimed.

**TDD:** Phase 00 is source/docs-only; no new production behavior so RED is N/A. Future Rust code phases require real RED/GREEN. `Tested=blocked` until actual matching-SHA baseline check execution. No waiver given.

## CI correction — GitHub Actions only

- User confirmation: **GitHub Actions is the only intended CI execution backend.** The active GitLab project CI dispatches requests, not runnable Bun/Rust jobs. Lack of GitLab shared runners is **not** the blocker.
- HEAD checkpoint SHA `8bbe947c00826060b549247ec08a9bc8a3ad2450`, [pipeline #3098263558](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098263558): `dispatch_github_actions=success`, same SHA+pipeline `github-actions/ci-hub-request=failed`; [linked GitHub run #44952420764](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952420764).
- Initial plan SHA `20031870cf236d25cec80911fb2f958f81dd8d87`, [pipeline #3098258203](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203): same result; [linked GitHub run #44952152159](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952152159).
- A failed GitHub Actions request proves neither passed tests nor a source defect. Access to actual GitHub jobs and checkout logs remains necessary; do not change runners. [Full diagnostic](ci-github-actions.md). Phase 00 remains `blocked`, no waiver.
