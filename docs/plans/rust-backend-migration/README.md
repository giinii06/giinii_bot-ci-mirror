# giinii_bot — Rust backend migration (Alchemy v2 plan)

**Project:** [blond11qq/giinii_bot](https://gitlab.com/blond11qq/giinii_bot) (private)
**Source base:** `main` at `8f17c21059a807fcfe34e08040bab0a3272a95ed`
**Working branch:** `refactor/rust-backend-migration-20261122`
**Plan commit:** see GitLab commit history of this directory (intentionally not self-referential)
**Agreement:** [13 user decisions](decisions.md), [approved architecture](design.md)
**Progress:** 0 / 10 completed; Phase 00 **blocked** by unverified/failed external CI; 2026-11-22. No Phase 01 implementation started.
**Authorization:** create branch, plan, implement phase-by-phase, test, commit, Draft MR; **no merge, deploy, production DB operations, mirroring, visibility or runner changes**.

## Strict phase ledger

| Phase | Outcome | Status | Implemented | Tested | Committed | Dependency |
| --- | --- | --- | --- | --- | --- | --- |
| 00 | [Baseline & compatibility contracts](phase-00-baseline-contracts.md) | blocked | yes (docs) | blocked | yes (plan) | none |
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
- **Selected CI provider: GitHub Actions, NOT GitLab Runner (user clarified).** The repository's `.gitlab-ci.yml` documents historical Bun checks but is not the active project CI configuration. Existing checks to execute in Actions are `bun run check`, isolated `bun test` files and `bun run build:activity`.
- Rust checks are **planned, not yet configured or executed** in **GitHub Actions**: `cargo fmt`, `cargo test --manifest-path rust-backend/Cargo.toml --locked`, `cargo clippy`, ARM64 image smoke on an available GitHub Actions Linux ARM64 runner. x86-only workflows do not verify ARM64.
- GitLab project points its **effective CI config** to `.gitlab/ci-hub-request.yml@blond11qq/ci-hub-smoke`, which dispatches to GitHub Actions. The GitLab pipeline is a trigger/control plane only. Verify `github-actions/ci-hub-request` on the exact SHA+pipeline ID, then independently inspect linked GitHub run jobs, inputs, checkout SHA and logs. GitLab Runner availability is irrelevant. [Bridge diagnostic](ci-github-actions.md).
- Rust Test RED must be observed failing for expected assertion before related implementation, unless explicit user-authorized exception; preserve RED and GREEN SHA/job log evidence in phase doc.

## Phase ownership and risks
- Rust is a new modular monolith; TS UI stays, TS backend retained for rollback. Protect data, OAuth tokens and Discord permissions.
- Each phase records review as **self-review** unless actual independent review tools are used; test and code review are separate gates.
- Release/cutover requires later authorization, backup of SQLite/WAL/SHM, media and seed, brief downtime and verified Rust service. This task ends at Draft MR.

## Evidence record
Plan creation: not yet code execution. Phase results and exact candidate SHA/pipeline/log/commit evidence will be appended after each real action. No background work, no unverified successes.

## Actual Phase 00 checkpoint — 2026-11-22

- Base source: `main` `8f17c21059a807fcfe34e08040bab0a3272a95ed`; source branch contains only `docs/plans/rust-backend-migration/*` additions before this checkpoint.
- Plan/contract docs committed at [`20031870cf23`](https://gitlab.com/blond11qq/giinii_bot/-/commit/20031870cf236d25cec80911fb2f958f81dd8d87); this is **not** Rust source implementation.
- GitLab pipeline [#3098258203](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203) for plan SHA `20031870cf236d25cec80911fb2f958f81dd8d87`: pipeline reports `success` because `dispatch_github_actions` succeeded; **no Bun/Rust build/test/typecheck jobs** appear in that pipeline's job listing.
- Same SHA + pipeline ID external context `github-actions/ci-hub-request` later resolved `failed`; [linked external run](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952152159). No actual individual GitHub test logs/checks are available through current GitLab evidence.
- Existing base `main` pipeline [#3098171535](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098171535) has Bun `typecheck`, `unit_tests`, `build_activity` jobs marked success **for base SHA only**, alongside a failing unrelated `github-actions/ci-hub` status. They are baseline context, **not** a passing check on this branch SHA.
- Current CI project setting points to external `.gitlab/ci-hub-request.yml@blond11qq/ci-hub-smoke`. This is **GitHub Actions-first**; disabled GitLab shared runners do not block the chosen provider. No runner or mirror settings were changed. Adding Rust to an inactive local `.gitlab-ci.yml` would not verify Rust. See [bridge diagnostic](ci-github-actions.md).
- **Stop gate enforced:** Phase 00 `Tested: blocked` **because linked GitHub Actions requests failed and their job logs are inaccessible**, NOT because a GitLab Runner is missing. Resolve GitHub run/checkout/dispatch failures using the existing bridge and check actual Bun job evidence on the selected GitLab SHA. No Phase 01 code, migration or production writes.

## CI provider clarification — 2026-11-22

The user explicitly selected **GitHub Actions for all actual build/test work**, with GitLab serving only as repository, branch/MR, dispatch and status coordinator. No GitLab-hosted runners or runner changes are requested. GitHub Actions executes Bun tests, then Rust checks and ARM64 verification as phases become runnable. See [GitHub Actions bridge](ci-github-actions.md). This changes the *diagnosis*, not the unverified test result or the existing blocked phase gate.
