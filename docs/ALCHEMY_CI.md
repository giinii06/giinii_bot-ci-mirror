# Alchemy verification workflow

Pipeline is pinned to the current GitLab branch/SHA and runs on GitLab-hosted (or configured self-managed) runners. It is not an auto-fix engine by itself.

## Jobs

- `typecheck`: `bun run check`, which runs TS checks of the bot and Activity.
- `unit_tests`: `bun test`.
- `build_activity`: `bun run build:activity`; saves `activity/dist` as an artifact on success.
- `codegraph_analysis`: optional manual job running upstream `@colbymchenry/codegraph` on a GitLab Runner. It saves the source SHA, CodeGraph version, status, file inventory, and an `explore` report. It **does not run a persistent MCP server** and is not the ChatGPT Sites imitation project.

The CI jobs run in isolated containers; no local Mac or VPS required. The GitLab project still needs an enabled runner and available CI minutes.

## Alchemy code change loop

1. Read exact GitLab default-branch or MR HEAD SHA and relevant source.
2. Use pstack-style analysis skills and Context7 for external APIs. Optionally run original CodeGraph CI job for investigation and inspect its logs/artifacts.
3. Create a feature branch, write a minimal code change and tests, commit.
4. Wait/check matching SHA pipeline via GitLab connector. Check **each job status**.
5. On failure, read failed job logs. Classify failure (code/test, external dependency, runner/timeout). Patch only a root-cause code/test failure; create a new commit; verify new HEAD SHA. Repeat at most **3 fix attempts**. Never blindly rerun unchanged broken code.
6. If the runner or tool is unavailable, say CI was not executed and stop instead of claiming a green build.
7. On green pipeline, open or update a merge request. **Never auto-merge or deploy** unless explicitly requested.
8. Report exact commit SHA, pipeline URL, job results, number of attempts, and any unresolved failure.

## Notes

- GitLab CI `retry` in the YAML retries *infrastructure failures* once; the **Alchemy agent** owns the fix-and-retest workflow. A job passing with `allow_failure: true` does **not** mean an optional CodeGraph analysis succeeded.
- `DISCORD_TOKEN` in CI is a nonsecret dummy. Tests should use mocked Discord or AI APIs; jobs must not call production services.
- Avoid storing tokens, `.env`, user data, or private source dumps in public logs or artifacts.
