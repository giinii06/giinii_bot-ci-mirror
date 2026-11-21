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

## Phase 00 deeper source-derived invariants (read-only, not executed fixtures)

### Permissions / routing
- `src/commands.ts` builds global voice commands and dedicated-guild roulette + 3D Activity commands; `syncCommands` clears dedicated commands from other guilds.
- `src/prefix-commands.ts` uses `/^!([^\\s]+)(?:\\s+([\\s\\S]*))?$/`; `!help` is available regardless of dedicated guild, while other supported prefix commands require it. `mind`, `shared-memory`, `타겟`, `관리자_타겟` require administrator or owner. Existing replies disable unwanted mentions.
- `src/command-rules.ts`: a missing `guild_command_rules` row means **enabled**; explicit `enabled=0` disables. Dedicated guild is held in constant `ALLOWED_GUILD_ID`; avoid embedding this source constant into unrelated Rust config without documenting intentional change.

### Activity security fixtures to build
- `src/activity-auth.ts`: random 32-byte base64url bearer token; TTL 30 minutes; reverify member and command eligibility after 60s; bind session to guild/user/Activity instance.
- `src/activity-web-server.ts`: requires matching Bearer token AND `x-activity-instance` on protected routes; session activity exchange throttled, graph/avatar APIs separately throttled; insufficient permission/missing session yields 401/403/429 as appropriate. Mock tests must cover wrong instance, revoked user, expired session and denied command.

### Database invariants to test
- `src/storage.ts` maintains `PRAGMA journal_mode=WAL` on root and per-guild databases and `PRAGMA foreign_keys=ON` on guilds. Existing `settings` table has conditional column-add behavior and must not be destructively recreated.
- Source tables: `users`, `activity`, `chat_stats`, `chat_stats_state`, `user_profiles`, `enrichment_state`, `profile_sweep_state`, `message_details`, `media_files`, `settings`, `voice_sessions`, `voice_presence_sessions`, `admin_target_roles`, `admin_defense_roles`, `discord_messages`, `guild_command_rules`, `dunk_settings`, `dunk_ignored_channels`. The chat/mind modules may own more tables: source audit required before Phase 02 completion.
- This is a **source inspection**, not a verified SQLite migration, runtime API test, or completed phase.
