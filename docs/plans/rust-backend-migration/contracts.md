# Existing compatibility inventory (baseline facts)

Source: `main` at `8f17c21059a807fcfe34e08040bab0a3272a95ed`. These contracts are NOT automatically tests; Phase 00 must turn them into fixtures and verify existing Bun jobs on the review branch.

## Discord
- Gateway: `src/index.ts`; message/guild/voice/interaction event flow; owner `ADMIN_USER_ID`; `src/commands.ts`, `src/prefix-commands.ts`, `src/admin-commands.ts`, `src/command-rules.ts` enforce scope and permissions.
- Slash: `/친밀도`, `/친밀도그래프`, `/통화량`, `/통계`, `/친밀도그래프3d`, `/관리자머리끄댕이` (verify actual runtime command registration before claiming contract complete).
- Prefix: `!help`, `!model`, `!reasoning`, `!memory`, `!mind`, `!shared-memory` and admin/roulette/voice options as documented in `README.md`.
- User-visible text may change (Q12); preserve permission denial, data privacy and core capability.

## SQLite
- `src/config.ts` default `DATABASE_PATH=./data/bot.sqlite`; `src/storage.ts` guild path is `data/guilds/<guildId>.sqlite` alongside root DB. Existing `storage.ts` includes multiple CREATE TABLE/INDEX and transactions. Inspect full schema in Phase 02, do not infer migrations only from this summary.
- Preserve `user_id` and `guild_id` as TEXT, persisted timestamps and voice interval semantics, private memory per-user visibility, existing guild tables and recovery files.
- Test with temporary cloned fixtures; do not use live DB/WAL/SHM in CI.

## Activity HTTP + UI
- `src/activity-web-server.ts` endpoints: `/api/activity/config`, `/api/session/activity`, `/api/session`, `/api/graph`, and `/api/graph/avatar/<id>`. Login/Activity uses bearer session and `x-activity-instance`, validates membership and command-enabled flag; verify exact status and JSON shapes in Phase 07.
- `activity/src/**` remains the TS/Three.js frontend and `bun run build:activity` builds it.

## Bun baseline checks from actual repository
- `typecheck`: `bun run check` = `tsc --noEmit && tsc -p activity/tsconfig.json`.
- `unit_tests`: `find test -type f (...) -print0 | xargs -0 -r -n1 bun test`, per-test Bun process isolation.
- `build_activity`: `bun run build:activity`.
- Optional `codegraph_analysis` manual, not evidence unless run.
- External `github-actions/ci-hub` status can fail while GitLab Bun jobs succeed; report separately. CI config path may be external. Inspect pipeline jobs and commit statuses for same SHA.

## Deployment boundaries
- `Dockerfile` / `docker-compose.yml` remain Bun production references while migration develops.
- Durable `./data:/app/data`, `SOUL.md`, `./audio`, `MEDIA_PATH`, seed/backup scripts and host loopback port `8787`.
- New Rust configuration will NOT accept old environment variables by default; provide exact conversion guidance in Phase 09.
