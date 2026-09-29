# Plan — 30MB 초과 파일은 항상 조각으로 나눈다

## 문제
`git push` 가 `remote: error: File data/bot.sqlite is 114.12 MB; this exceeds GitHub's file size limit of 100.00 MB` 로 거절된다.
사용자 요청: "30메가이상 되면 파일을 나누게 해줘".

## 근본 원인
1. `.gitignore` 에 `node_modules/` 만 있어 `git add .` 가 살아있는 DB/WAL/SHM 을 커밋했다.
2. 조각 인프라(`src/seed.ts` 30MiB, `src/media-seed.ts`)는 이미 있었지만 미디어 임계값이 99MB 라 30~99MB 가 그대로 커밋된다.
3. 규칙을 강제하는 지점이 없다.

## 설계
- **단일 규칙**: 커밋되는 파일은 30 MiB 이하. DB 는 `data/seed/` 조각, 미디어는 `data/media-seed/` 조각, 둘 다 manifest + sha256.
- **경계 강제**: `src/git-guard.ts` (의존성 0) + `scripts/check-large-files.ts` + `.githooks/pre-commit`.
  훅은 staged blob 을 검사해 30 MiB 초과를 명명하고 exit 1. 조각화는 하지 않는다(앱 컨텍스트가 필요하고 부작용이 크다) —
  대신 정확한 복구 명령을 출력한다.
- **config 비의존**: 훅은 `bun run scripts/check-large-files.ts` 로 실행되므로 `src/config.ts` 를 import 하면 안 된다
  (import 시점에 `required(DISCORD_BOT_TOKEN)` 로 죽는다). 상수를 `git-guard.ts` 가 자체 보유한다.

## 변경 파일
| 파일 | 변경 |
| --- | --- |
| `src/media-seed.ts` | `CHUNKABLE_ABOVE_BYTES` 99MB → 30MiB |
| `src/git-guard.ts` | 신규. 30MiB 상수 + staged/tracked 스캔 + 리포트 |
| `scripts/check-large-files.ts` | 신규 CLI. `staged`(기본)/`--tracked` |
| `.githooks/pre-commit` | 신규. staged 검사 |
| `.gitignore` | DB/WAL/SHM, `.DS_Store`, `.omo/` 추가 |
| `test/git-guard.test.ts` | 신규. 한계값 + 실제 git 스캔 |
| `README.md` | 30MB 규칙 / 훅 설치 / 복원 경로 |
| (삭제) `data/.gitignore-media-large` | `data/.gitignore` 와 중복이며 경로가 잘못되어 효과가 없는 파일 |

## 성공 기준
- SC1 커밋 트리의 최대 blob < 30 MiB, `data/bot.sqlite` 미추적.
- SC2 실제 `git commit` 이 40MB 를 거절하고 1MB 를 통과.
- SC3 실제 114MB DB → 30MiB 이하 조각 → 복원 sha256 일치 + integrity_check ok + `bun run check`/`bun test` green.
- SC4 기존 30MB 초과 미디어 4개 조각화 + 왕복 sha256 무손실.

## 검증 채널
git 표면(명령), 실제 훅(`git commit` in 임시 저장소), 실제 DB(`scripts/restore-db.ts` + sha256 + sqlite integrity_check).

## 완료 조건
SC1~SC4 PASS + cleanup 영수증 + notepad 현재 상태.
