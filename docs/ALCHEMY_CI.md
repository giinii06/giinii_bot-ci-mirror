# giinii_bot CI — GitHub Actions is authoritative

**Owner decision (2026-11-22): GitLab's official hosted/shared CI Runner will NOT run project tests. GitHub Actions is the selected CI compute provider.** GitLab remains the private code repository, branch/MR store and CI bridge/status coordinator.

## Effective configuration (verified from GitLab)
- Project `blond11qq/giinii_bot` uses **`ci_config_path=.gitlab/ci-hub-request.yml@blond11qq/ci-hub-smoke`**. This is a remote CI configuration, not the checked-in `.gitlab-ci.yml`.
- The active remote YAML's `dispatch_github_actions` bridge triggers `blond11qq/ci-hub-smoke`. GitLab trigger success **does not prove a test ran**.
- The receiving source includes `.github/workflows/gitlab-request.yml` with `workflow_dispatch` inputs `pipeline`, `sha`, `stack` (`bun|go|rust|docs`), and `directory`.
- Existing `.gitlab-ci.yml` is a legacy example; it is **not the effective CI execution plan** while the project CI config path points elsewhere.

## Candidate SHA -> GitHub Actions verification
1. Commit phase candidate on the authorized GitLab branch; re-read exact SHA.
2. Invoke `GitLab.create_pipeline` for that branch and require returned SHA equality.
3. Query `list_commit_statuses` using that **SHA**, new pipeline ID and `name=github-actions/ci-hub-request`. Inspect other GitHub context statuses separately.
4. Follow the status target URL to the **actual GitHub Actions run**. Read job names, run inputs, checkout SHA, logs and conclusion. `workflow_dispatch` run's event SHA may be from the GitHub default branch, so `inputs.sha` and checkout commit identity are decisive.
5. Report `bun run check`, isolated Bun tests, `bun run build:activity`, Rust `cargo test`/clippy/fmt, and Linux ARM64 Docker tests **only when actually executed** in Actions. Never infer Rust success from Bun checks.
6. If a dispatched GitHub run fails, inspect its job logs (checkout/mirror availability, workflow input/permissions, reusable workflow, source assertions) before fixing any code. If GitHub access is not available, document `blocked/unverified` without asserting an invented cause.
7. Repeat per Phase with exact SHA evidence, review, checkpoint commit; Draft MR remains unmerged/un-deployed.

## Observed Rust migration bridge issue
Plan SHA `20031870cf236d25cec80911fb2f958f81dd8d87`: [GitLab pipeline 3098258203](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203) dispatched, but `github-actions/ci-hub-request=failed`; [GitHub run 44952152159](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952152159). Phase-00 checkpoint SHA `8bbe947c00826060b549247ec08a9bc8a3ad2450`: [pipeline 3098263558](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098263558), same `failed` external context; [GitHub run 44952420764](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952420764).

GitLab Runner unavailability is **not** the blocker. The problem is that actual GitHub Actions job evidence is unavailable and the external request context failed. Do not change GitLab Runner configuration, visibility or mirroring without separate explicit authorization. Do not merge or deploy.
