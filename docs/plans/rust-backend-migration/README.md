# giinii_bot — Rust backend migration (Alchemy v2 plan)

**Project:** [blond11qq/giinii_bot](https://gitlab.com/blond11qq/giinii_bot) (private)
**Source base:** `main` at `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Working branch:** `refactor/rust-backend-migration-20261122`
**Plan commit:** see GitLab commit history of this directory (intentionally not self-referential)
**Agreement:** [13 user decisions](decisions.md), [approved architecture](design.md)
**Progress:** 0 / 10 completed; first phase 00 not_started; status initial snapshot 2026-11-22.
**Authorization:** create branch, plan, implement phase-by-phase, test, commit, Draft MR; **no merge, deploy, production DB operations, mirroring, visibility or runner changes**.

## Strict phase ledger

| Phase | Outcome | Status | Implemented | Tested | Committed | Dependency |
| --- | --- | --- | --- | --- | --- | --- |
| 00 | [Baseline & compatibility contracts](phase-00-baseline-contracts.md) | not_started | no | no | no | none |
| 01 | [Rust workspace, configuration & diagnostics](phase-01-rust-foundation.md) | not_started | no | no | no | 00 |
| 02 | [SQLite compatibility & migrations](phase-02-sqlite-compatibility.md) | not_started | no | no | no | 01 |
| 03 | [Discord Gateway, permissions and commands](phase-03-discord-gateway.md) | not_started | no | no | no | 02 |
| 04 | [Voice, chat stats, graph and cards](phase-04-voice-statistics.md) | not_started | no | no | no | 03 |
| 05 | [OpenRouter chat, Mind and memory](phase-05-ai-chat-mind.md) | not_started | no | no | no | 04 |
| 06 | [Media, backfill, recovery and scheduled work](phase-06-background-workers.md) | not_started | no | no | no | 05 |
| 07 | [Rust Activity HTTP/auth integration](phase-07-activity-api.md) | not_started | no | no | no | 06 |
| 08 | [Linux ARM64 Docker and system integration](phase-08-arm64-integration.md) | not_started | no | no | no | 07 |
| 09 | [Cutover playbook, rollback and Draft MR](phase-09-cutover-readiness.md) | not_started | no | no | no | 08 |

**Gate:** First commit this initial plan, then implement only Phase 00. Never advance until each previous phase has evidence for `implemented=yes`, `tested=yes`, `committed=yes` and `status=completed`, or an explicit scoped user-approved waiver. A planned CI job or bridge acknowledgment never counts as passed test. Status docs commits can have a different SHA from tested code; both must be recorded.

## Existing CI and verification sources
- Original Bun CI: `typecheck` → `bun run check`; `unit_tests` → isolated per-file `bun test`; `build_activity` → `bun run build:activity`; actual `.gitlab-ci.yml` file on `main`.
- Rust checks are **planned, not yet configured or executed**: `cargo fmt`, `cargo test --manifest-path rust-backend/Cargo.toml --locked`, `cargo clippy`, ARM64 image smoke when real ARM64 runner available.
- GitLab project currently points CI config path to an external CI hub. Verify resulting pipeline actual jobs and `github-actions/ci-hub` external status separately, for matching SHA/pipeline. User has not authorized runner or mirror configuration changes.
- Rust Test RED must be observed failing for expected assertion before related implementation, unless explicit user-authorized exception; preserve RED and GREEN SHA/job log evidence in phase doc.

## Phase ownership and risks
- Rust is a new modular monolith; TS UI stays, TS backend retained for rollback. Protect data, OAuth tokens and Discord permissions.
- Each phase records review as **self-review** unless actual independent review tools are used; test and code review are separate gates.
- Release/cutover requires later authorization, backup of SQLite/WAL/SHM, media and seed, brief downtime and verified Rust service. This task ends at Draft MR.

## Evidence record
Plan creation: not yet code execution. Phase results and exact candidate SHA/pipeline/log/commit evidence will be appended after each real action. No background work, no unverified successes.
