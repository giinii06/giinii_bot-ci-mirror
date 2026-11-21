# Phase 05 — OpenRouter chat, Mind and memory

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 04
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Recreate AI request policies and user memory access without leaking private data.

- [ ] No cross-guild or private-memory exposure, deterministic policy decisions, no live keys/API calls in CI.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/src/ai/**; rust-backend/src/mind/**; rust-backend/tests/ai_policy.rs

**Work:** Port reasoning model choices, per-user settings, timeouts, quotas, circuit breaking, message context, memory visibility, consent and relationship policy. Mock external OpenRouter/Exa responses; preserve SOUL.md input only as approved.

**Known risks, rollback:** Never record prompts/private memories or API keys in test logs; user-visible changes documented (Q12).

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 04, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: Tests for forbidden shared-memory access, owner check, budget exhaustion, retries, upstream errors, missing keys and model fallback.
3. Implement smallest unit: Port reasoning model choices, per-user settings, timeouts, quotas, circuit breaking, message context, memory visibility, consent and relationship policy. Mock external OpenRouter/Exa responses; preserve SOUL.md input only as approved.
4. GREEN/test: cargo test --manifest-path rust-backend/Cargo.toml --locked --test ai_policy; Bun chat/mind regression comparison
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; trigger existing GitLab→GitHub Actions bridge, verify SHA and pipeline ID then inspect actual GitHub Actions jobs/checkout SHA and relevant tests. Do not require GitLab Runner or mistake dispatch for passed tests. If GitHub logs inaccessible, mark blocked.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check` in GitHub Actions | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test` in GitHub Actions | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity` in GitHub Actions | not executed for this new branch | pending |
| Rust unit/integration | `cargo test --manifest-path rust-backend/Cargo.toml --locked --test ai_policy` (planned until job exists) | not executed | pending |
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
