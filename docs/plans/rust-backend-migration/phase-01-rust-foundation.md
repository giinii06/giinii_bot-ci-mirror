# Phase 01 — Rust workspace, configuration & diagnostics

**Status:** not_started
**Implemented:** no
**Tested:** no
**Committed:** no
**Waiver evidence:** none
**Depends on:** 00
**Source base SHA:** `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Implementation commit SHA:** pending
**Verified pipeline SHA / ID / URL:** pending
**Evidence/checkpoint SHA:** pending
**Repair rounds used:** 0 / 20 (global)

## Purpose and acceptance
Introduce a self-contained non-running Rust foundation without changing Bun runtime.

- [ ] Rust crate compiles and tests on available CI with documented native target, inputs parsed correctly without printing secrets, Bun jobs remain unchanged, no runtime switch.
- [ ] Preserve specified privacy and SQLite/Activity/Discord contracts; no live deployment.
- [ ] Requirements and quality/security review completed and recorded.
- [ ] Exact executed test commands and matching SHA pipeline evidence recorded before completed status.

## Scope and ownership
**Intended paths:** rust-backend/Cargo.toml; rust-backend/src/lib.rs; rust-backend/src/main.rs; rust-backend/src/config.rs; rust-backend/tests/config_contract.rs; rust-backend/config.example.toml; .gitlab-ci.yml (additive Rust test job only if authorized runner supports it)

**Work:** Pick documented Rust edition/toolchain; define config structure and nonsecret TOML defaults with secrets only from new GIINII_* env; validate missing/invalid critical fields; provide structured logs/exit errors; add Rust unit/integration test vectors; keep Rust gateway disabled until tested.

**Known risks, rollback:** New config is intentionally not backward compatible (Q11), but its migration map must be documented; no secret values in Git.

## RED → GREEN → REFACTOR implementation steps
1. Establish prerequisite from Phase 00, reread current branch SHA and user-approved [design](design.md).
2. RED/test-first: First add tests for missing token, blank token, port range, invalid config and expected defaults; prove real failing assert on test-only state if executor available.
3. Implement smallest unit: Pick documented Rust edition/toolchain; define config structure and nonsecret TOML defaults with secrets only from new GIINII_* env; validate missing/invalid critical fields; provide structured logs/exit errors; add Rust unit/integration test vectors; keep Rust gateway disabled until tested.
4. GREEN/test: cargo fmt --all -- --check; cargo test --manifest-path rust-backend/Cargo.toml --locked; cargo clippy --manifest-path rust-backend/Cargo.toml --all-targets -- -D warnings (once wired)
5. Review behavior contract and data/security blast radius; refactor only with maintained green checks.
6. Commit code candidate; verify actual GitLab Runner jobs or other provider statuses on that **exact SHA**. If CI inaccessible, mark blocked not completed.
7. Record implementation SHA, test job IDs and URLs, two-lens review findings and checkpoint commit; only then advance.

## Verification inventory
| Category | Real observed / intended command | Status at plan creation | Evidence |
| --- | --- | --- | --- |
| Existing TS typecheck | `bun run check`, GitLab job `typecheck` | not executed for this new branch | pending |
| Existing TS tests | per-file `bun test`, GitLab job `unit_tests` | not executed for this new branch | pending |
| Existing Activity build | `bun run build:activity`, GitLab job `build_activity` | not executed for this new branch | pending |
| Rust unit/integration | `cargo fmt --all -- --check` (planned until job exists) | not executed | pending |
| ARM64 binary and Docker | ARM64 builder/runner needed, expected in Phase 08 | not executed | pending |

## Results and gate status
- Observed RED test: pending / not applicable for Phase 00.
- Observed GREEN test: pending.
- Requirements compliance review (self vs independent): pending.
- Quality and security review (self vs independent): pending.
- Important findings and resolutions: pending.
- Final status: **not_started**. Nothing in this plan is evidence of test execution.
