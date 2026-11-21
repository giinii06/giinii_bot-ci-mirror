# CI provider decision — GitHub Actions bridge

Owner selected **GitHub Actions for all actual build, test, typecheck, lint, Rust and ARM64 checks**. GitLab (and its trigger-only `ci-hub-smoke` pipeline) is the repository, commit/branch/MR, dispatch and commit-status orchestration layer only. Do NOT enable GitLab shared runners or require jobs in GitLab pipeline `list_pipeline_jobs`.

## Confirmed wiring
- `blond11qq/giinii_bot` project active `ci_config_path=.gitlab/ci-hub-request.yml@blond11qq/ci-hub-smoke`, which triggers the `ci-hub-smoke` downstream bridge.
- Github workflow `.github/workflows/gitlab-request.yml` supports `workflow_dispatch` with inputs `pipeline`, `sha`, `stack=bun|go|rust|docs`, `directory`, `hls`, and reusable `giinii06/ci-hub/.github/workflows/ci.yml@v1`.
- `.gitlab-ci.yml` in source is not the effective running config. It does not imply GitLab Runner must be set up.
- Verify commit is accessible in target GitHub mirror, correct workflow `stack` and `directory` are selected, and the checked-out SHA **equals the GitLab phase candidate SHA**. An input SHA alone isn't proof of checkout.

## Failing observed requests — GitHub logs required
| GitLab source SHA | Pipeline | GitLab dispatch | External request context | GitHub run |
| --- | --- | --- | --- | --- |
| `20031870cf236d25cec80911fb2f958f81dd8d87` | [3098258203](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098258203) | success | `github-actions/ci-hub-request=failed` | [44952152159](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952152159) |
| `8bbe947c00826060b549247ec08a9bc8a3ad2450` | [3098263558](https://gitlab.com/blond11qq/giinii_bot/-/pipelines/3098263558) | success | `github-actions/ci-hub-request=failed` | [44952420764](https://github.com/giinii06/giinii_bot-ci-mirror/actions/runs/44952420764) |

No per-job GitHub logs were accessible with the connected GitLab app. **Do not conclude that Rust source or GitLab Runner failed.** Possible mirror checkout/permissions/workflow-input/job issues must be determined from real Actions logs.

## Phase gate and resumption
Phase 00 is **blocked by GitHub Actions run/test evidence**, not GitLab infrastructure. No RED/GREEN proof for new code and no waiver. After GitHub run logs can be read, repair *the evidenced* bridge/workflow or tested code within the existing authorized project scope, re-run against exact SHA, and record real Bun baseline. Then proceed to Rust Phase 01 TDD and GitHub Actions Rust tests. Subsequent Phase statuses must stay unstarted until their predecessors pass. Existing `main` and production environment remain untouched.
