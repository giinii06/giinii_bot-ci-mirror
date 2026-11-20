# Giinii Bot — 개발 및 유지보수 가이드

> Discord 서버의 채팅·음성 이력을 수집하고, 통계·친밀도 시각화·이벤트·AI 대화와 기억 기능을 제공하는 **Bun + TypeScript** 봇입니다. 이 문서는 구현자/운영자용입니다. **실제 봇 사용법은 [README_USER.md](README_USER.md)** 에서 확인하세요.

**문서 기준:** 2026-11-21 · `main` 브랜치의 실제 구현을 기준으로 작성. 기능이 바뀌면 해당 소스와 테스트를 우선하고 이 문서도 함께 고칩니다.

## 목차

1. [무엇을 제공하나](#1-무엇을-제공하나)
2. [기술 스택과 코드 지도](#2-기술-스택과-코드-지도)
3. [아키텍처](#3-아키텍처)
4. [실행과 초기화 흐름](#4-실행과-초기화-흐름)
5. [개발 환경에서 시작하기](#5-개발-환경에서-시작하기)
6. [환경변수 레퍼런스](#6-환경변수-레퍼런스)
7. [Discord 명령 등록과 권한](#7-discord-명령-등록과-권한)
8. [데이터베이스와 기록 수집](#8-데이터베이스와-기록-수집)
9. [음성 집계와 시각화](#9-음성-집계와-시각화)
10. [대화·판단·기억](#10-대화판단기억)
11. [3D Discord Activity](#11-3d-discord-activity)
12. [Docker와 배포](#12-docker와-배포)
13. [백업·복원·데이터 이동](#13-백업복원데이터-이동)
14. [테스트와 변경 작업](#14-테스트와-변경-작업)
15. [운영·관측·장애 대응](#15-운영관측장애-대응)
16. [GitLab ↔ GitHub 동기화](#16-gitlab--github-동기화)
17. [보안·개인정보·제약](#17-보안개인정보제약)

## 1. 무엇을 제공하나

| 구성 | 현재 구현 | 주요 파일 |
| --- | --- | --- |
| 메시지 | 실시간 저장, 서버별 초기 백필, 첨부/반응/메시지 상세 수집 | `src/analysis.ts`, `src/history.ts`, `src/records.ts` |
| 미디어 | 별도 파일 저장, 스트리밍 해시, 크기 제한, 재시도 | `src/media.ts`, `src/media-seed.ts` |
| 음성 | 음성 체류 구간, KST 일·주·월·전체 집계, 겹친 시간 기반 친밀도 | `src/activity.ts`, `src/voice-affinity.ts` |
| 시각화 | PNG 랭킹 카드, 2D 관계 그래프, Discord 내 3D Activity | `src/voice-affinity-*.ts`, `src/voice-graph-*.ts`, `activity/` |
| 서버 이벤트 | 짧은 음성 입퇴장(들낙) 감지, 관리자 역할 룰렛 | `src/dunk-detection.ts`, `src/roulette.ts` |
| 대화 | 접두사·멘션·답장 트리거, OpenRouter 생성, 선택형 Exa 검색 | `src/chat/`, `SOUL.md` |
| Mind | 별도 Decision API 판단, 호출 한도/차단기, 개인·공용 기억, 관계 상태 | `src/mind/` |
| 배포 | Docker Compose, DB 시드 복원, 배포 스킬 | `Dockerfile`, `docker-compose.yml`, `.codebuddy/skills/deploy/SKILL.md` |
| 웹 실험 | `web/`의 React/Vite/Cloudflare Pages 시작 페이지 | `web/package.json` |

**구분:** `web/`은 현재 간단한 React 시작 화면입니다. 서버 데이터와 연동된 운영 대시보드나 GiniiWiki가 구현됐다고 간주하면 안 됩니다. 반면 `activity/`는 3D 그래프용 별도 정적 SPA로 봇 프로세스의 HTTP API와 연결됩니다.

## 2. 기술 스택과 코드 지도

- **런타임:** Bun 1.3 계열, ES module, TypeScript (기본 `strict`).
- **Discord:** `discord.js` 14, 음성은 `@discordjs/voice`.
- **저장:** 내장 `bun:sqlite`, 서버별 SQLite 파일, WAL.
- **이미지:** `@napi-rs/canvas` (카드/PNG), `three`와 `3d-force-graph` (클라이언트 3D).
- **웹:** Vite 8, Discord Embedded App SDK, 별도 `web/`에 React 19.
- **AI:** OpenRouter Chat Completions + 분리된 Decisions API, 선택형 Exa.
- **배포:** `oven/bun:1.3.14` 기반 다중 단계 Docker 빌드, Compose.

~~~text
giinii_bot/
├── src/
│   ├── index.ts                 # Gateway 이벤트 연결 및 부팅 조율
│   ├── config.ts                # Discord/저장/Activity 설정
│   ├── commands.ts              # SlashCommandBuilder, 등록 범위, 재동기화
│   ├── command-rules.ts         # 전용 서버 게이트 + 서버별 on/off
│   ├── analysis.ts              # 메시지 실시간 저장/백필
│   ├── history.ts, records.ts   # 메시지 정규화/부가정보/프로필 이력
│   ├── storage.ts               # SQLite 스키마, 서버별 DB 연결
│   ├── activity.ts              # 음성 구간·버킷·채팅 집계
│   ├── media.ts, media-seed.ts  # 미디어 다운로드·분할 관리
│   ├── voice-affinity*.ts       # 친밀도 카드와 2D 이미지
│   ├── voice-graph-*.ts         # 공통 그래프/기간/겹침 계산
│   ├── activity-*.ts            # 3D Activity API/인증/그래프
│   ├── dunk-detection.ts       # 들낙 감지
│   ├── roulette.ts              # 관리자 룰렛
│   ├── chat/                    # 대화 트리거/문맥/모델/검색
│   └── mind/                    # 판단, 기억, 관계, 스키마
├── activity/src/                # Discord Activity 프런트 (Three.js)
├── web/                         # 독립 React/Vite 시작 웹
├── scripts/                     # 백필/DB·미디어 시드/복구/검사
├── test/                        # Bun 단위/통합 회귀 테스트
├── audio/                       # 룰렛 OGG 음원
├── SOUL.md                      # 봇 성격·표현 지침
├── DESIGN.md                    # PNG 카드 디자인 결정
├── .env.example                 # 환경변수 예시
├── Dockerfile, docker-compose.yml
└── .github/workflows/sync-to-gitlab.yml
~~~

**탐색 순서:** 이벤트 흐름은 `src/index.ts` → 기능 핸들러 → `src/storage.ts`. AI 처리 흐름은 `src/chat/index.ts` → `src/mind/engine.ts` → `src/chat/router.ts`. 3D는 `src/activity-web-server.ts` ↔ `activity/src/api.ts`부터 보면 됩니다.

## 3. 아키텍처

~~~mermaid
flowchart TB
    D[Discord Gateway / Interactions] --> I[src/index.ts]
    I --> MSG[메시지 수집 및 백필]
    I --> VOICE[음성 트래커]
    I --> CMD[명령 라우팅]
    I --> CHAT[AI 대화]
    MSG --> DB[(길드별 SQLite)]
    MSG --> MEDIA[미디어 워커] --> DISK[(data/media)]
    VOICE --> DB
    CMD --> STATS[통계·PNG 카드] --> DB
    CMD --> ROULETTE[룰렛 / 들낙] --> DB
    CHAT --> MIND[Mind 판단·기억] --> DB
    MIND --> DEC[OpenRouter Decisions API]
    CHAT --> LLM[OpenRouter Chat API]
    CHAT -. 검색 필요 시 .-> EXA[Exa Search]
    DB --> API[Activity HTTP API]
    API --> SPA[Discord Activity SPA]
    SPA --> WEBGL[사용자 기기의 WebGL]
~~~

**운영 경계:** 봇 프로세스가 Discord 연결·SQLite·Activity HTTP를 공유합니다. PNG는 서버에서 렌더링하지만 3D 물리 계산 및 WebGL 렌더링은 사용자 클라이언트에서 수행됩니다. `web/`의 일반 프런트는 위 API에 연결된 완성형 제품이 아닙니다.

## 4. 실행과 초기화 흐름

`src/index.ts`에서 4개 Gateway Intent (`Guilds`, `GuildMessages`, `GuildVoiceStates`, `MessageContent`)와 채널/메시지 Partial을 선언합니다.

~~~mermaid
sequenceDiagram
    participant Discord
    participant Bot as src/index.ts
    participant DB as SQLite
    participant Jobs as Workers
    participant Chat as Chat / Mind
    Discord->>Bot: ClientReady
    Bot->>DB: initDatabase(guildIds)
    Bot->>Bot: Activity 서버 시작(활성 시)
    Bot-->>Discord: Slash 명령 동기화(비동기)
    Bot->>Chat: initChat()
    Bot->>DB: 진행 중 음성 세션 복원
    Bot->>Jobs: 60초 음성 정산 시작
    Bot->>Jobs: Media / Seed 워커 시작
    Bot->>DB: 프로필 이력 시드
    Bot-->>Discord: 채널 백필 / 프로필 sweep
    Discord->>Bot: MessageCreate / VoiceStateUpdate / InteractionCreate
~~~

- `ClientReady`: 데이터 초기화 → Activity → 명령 동기화 → 대화 초기화 → 음성/미디어/시드 작업 → 백필·프로필 스윕.
- `GuildCreate`: 새 서버용 DB를 준비하고 해당 서버 기록 수집과 명령 동기화를 별도로 시작합니다.
- `MessageCreate`: 관리·들낙 텍스트 명령 확인 → 길드 메시지 저장 → 대화 트리거 검사.
- `VoiceStateUpdate`: 음성 세션 갱신, 들낙 감지.
- `InteractionCreate`: 자동 완성, 명령 on/off 게이트, 통계/그래프/룰렛/Mind 분기, 카드 페이지 버튼.
- 명령 목록이 변경되지 않았다면 Discord 재등록을 건너뛰도록 최적화되어 있습니다. Activity의 전역 Entry Point 명령은 삭제하지 않고 보존합니다.

## 5. 개발 환경에서 시작하기

### 요구 사항

- Bun **1.3 이상** (이미지는 1.3.14 고정), Git.
- Discord 애플리케이션·봇 토큰과 초대된 서버.
- Discord Developer Portal에서 **Message Content Intent** 활성화.
- 필요한 봇 권한: 채널 보기, 과거 메시지 읽기, 메시지 보내기, 파일 첨부, 링크 임베드. 룰렛은 음성 연결/말하기, 멤버 연결 해제, 역할 관리와 적절한 역할 서열도 필요.
- 선택: OpenRouter API 키(대화), Exa 키(검색), 3D Activity용 Discord OAuth Client Secret 및 HTTPS 역방향 프록시.

~~~bash
git clone https://gitlab.com/blond11qq/giinii_bot.git
cd giinii_bot
cp .env.example .env
# .env에 DISCORD_TOKEN 입력: 파일과 토큰은 절대 Git에 커밋하지 말 것
bun install --frozen-lockfile
bun run check
bun test
bun run start
~~~

`bun run dev`는 `bun --watch src/index.ts`로 소스 변경 시 다시 시작합니다. **동일 토큰으로 개발 인스턴스와 운영 인스턴스를 동시에 실행하지 마세요.** 메시지 수집/집계와 응답이 중복될 수 있습니다. 가급적 별도 테스트 봇과 테스트 서버를 사용하세요.

### 스크립트

| 명령 | 목적 |
| --- | --- |
| `bun run start` | Discord 봇 실행 |
| `bun run dev` | 감시 모드로 실행 |
| `bun run check` | TypeScript + Activity TS 유형 검사 |
| `bun test` | `test/`의 Bun 테스트 실행 |
| `bun run build:activity` | Discord 3D SPA를 `activity/dist`에 빌드 |
| `bun run dev:activity` | Vite 개발 서버(기본 5173; `/api`는 8787로 프록시) |
| `bun run scripts/backfill-guild.ts <GUILD_ID>` | 특정 서버 기록 1회 재수집 |
| `bun run scripts/split-db.ts` | 서버별 DB의 시드 청크 생성 |
| `bun run scripts/restore-db.ts data/seed data/guilds` | DB 시드 복원 |
| `bun run scripts/restore-legacy-db.ts` | 구형 단일 DB 시드 임시 복원 |
| `bun run scripts/split-db-by-guild.ts` | 과거 단일 DB를 서버별 파일로 분리 |
| `bun run scripts/chunk-media.ts` | 큰 미디어의 청크 생성 |
| `bun run scripts/check-large-files.ts --tracked` | 추적 파일의 30 MiB 초과 점검 |
| `bun run scripts/hash-db.ts <FILE>` | 파일 크기·SHA-256 출력 |

`web/`은 독립 개발 환경입니다: `cd web && bun install --frozen-lockfile && bun run dev`. 빌드는 `bun run build`, Cloudflare Pages 업로드는 `bun run deploy`이며 계정 인증이 필요합니다. **이 웹 빌드는 봇 본체/Activity의 배포를 대신하지 않습니다.**

## 6. 환경변수 레퍼런스

기준은 [.env.example](.env.example), `src/config.ts`, `src/chat/config.ts`, `src/mind/config.ts`입니다. 아래 값은 **소스의 기본값**입니다. 실제 비밀값은 절대 문서·Issue·로그에 복사하지 마세요.

| 변수 | 필수 | 기본값/의미 |
| --- | --- | --- |
| `DISCORD_TOKEN` | 예 | Discord Bot Token |
| `DISCORD_BOT_TOKEN` | 대체 | 설정 시 `DISCORD_TOKEN`보다 우선 |
| `DATABASE_PATH` | 아니오 | `./data/bot.sqlite`; 이 파일의 **부모 폴더** 아래 `guilds/<ID>.sqlite`가 생성됨 |
| `MEDIA_PATH` | 아니오 | DB 경로 옆 `media` 폴더 |
| `MEDIA_MAX_BYTES` | 아니오 | 536870912 (512 MiB) |
| `MEDIA_CONCURRENCY` | 아니오 | 4 (범위 1~16) |
| `SKIP_BACKFILL` | 아니오 | `false`; 빈 길드 DB의 첫 백필은 이 설정과 관계없이 수행 |
| `SEED_CHUNK_BYTES` | 아니오 | 31457280 (30 MiB) |
| `SEED_GROWTH_BYTES` | 아니오 | 31457280 (30 MiB) |
| `VOICE_AUDIO_PATH` | 아니오 | `./audio/roulette.ogg`; 2·3번 OGG도 후보 |
| `CHAT_OPENROUTER_API_KEY` | 대화에 필요 | 우선 OpenRouter 키 |
| `OPENROUTER_API_KEY` | 대체 | 전용 Chat 키가 없을 때 사용 |
| `OPENROUTER_BASE_URL` | 아니오 | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | 아니오 | `deepseek/deepseek-v4.1-flash-1017` |
| `REASONING_EFFORT` | 아니오 | `low` |
| `EXA_API_KEY` | 선택 | Exa 검색 활성화 |
| `AGENTS_PATH` | 아니오 | `SOUL.md` |
| `MIND_ENABLED` | 아니오 | `true`; 실패/비활성 시 로컬 판단으로 폴백 |
| `MIND_DECISION_MODEL` | 아니오 | `perplexity/pplx-decider-v1.3:free` |
| `MIND_DECISION_FLASH_MODEL` | 아니오 | `perplexity/pplx-decider-flash-v1.3:free` 설정값 |
| `MIND_DECISION_API_URL` | 아니오 | `https://openrouter.ai/api/alpha/decisions` |
| `MIND_MAX_DECISIONS_PER_TRIGGER` | 아니오 | 2 (1차 + 조건부 정밀 판단) |
| `MIND_ADAPTIVE_REFINEMENT` | 아니오 | `true` |
| `MIND_DAILY_BUDGET` / `MIND_MINUTE_BUDGET` | 아니오 | 최근 24시간 900회 / 최근 1분 18회 자체 상한 |
| `MIND_DECISION_TIMEOUT_MS` / `MIND_REFINE_TIMEOUT_MS` | 아니오 | 3000 / 2500 ms |
| `MIND_REFINE_CONFIDENCE` / `MIND_REFINE_MARGIN` | 아니오 | 0.7 / 0.15 |
| `MIND_MEMORY_ENABLED` / `MIND_AUTO_MEMORY` | 아니오 | `true` / `true` |
| `MIND_MEMORY_CANDIDATES` / `MIND_MEMORY_SELECTED` | 아니오 | 12 / 5 |
| `MIND_MEMORY_TOKEN_BUDGET` | 아니오 | 코드에서는 400자 정도의 프롬프트 예산으로 사용 |
| `MIND_OTHER_USER_MEMORY_ENABLED` / `MIND_GUILD_MEMORY_ENABLED` | 아니오 | `true` / `true` |
| `MIND_RELATIONSHIP_ENABLED` / `MIND_FEEDBACK_ENABLED` | 아니오 | `true` / `true` |
| `MIND_RELATIONSHIP_UPDATE_LIMIT` / `MIND_PLAYFULNESS_FLOOR` | 아니오 | 0.03 / 0.2 |
| `MIND_SEARCH_ENABLED` / `MIND_SEARCH_TIMEOUT_MS` | 아니오 | `true` / 3000 ms |
| `MIND_TURN_MEMORY` / `MIND_DEBUG` | 아니오 | 500 / `false` |
| `ACTIVITY_ENABLED` | 아니오 | `false`; 3D API 서버 활성화 |
| `DISCORD_CLIENT_SECRET` | Activity 필수 | Discord OAuth2 Client Secret |
| `DISCORD_CLIENT_ID` | 선택 | 생략 시 토큰 첫 조각에서 App ID 추출을 시도 |
| `ACTIVITY_HTTP_HOST` / `ACTIVITY_HTTP_PORT` | 아니오 | `127.0.0.1` / `8787` |
| `ACTIVITY_DIST_PATH` | 아니오 | 저장소의 `activity/dist` |

`MIND_*`는 모든 키가 .env.example에 나열된 것은 아닙니다. 세부 기본값과 범위는 `src/mind/config.ts`를 확인하세요. `/model`과 `/reasoning`은 실행 중 메모리에 반영되며 영구 설정 파일을 수정하지 않습니다.

## 7. Discord 명령 등록과 권한

`src/commands.ts`가 **전역 4개**와 **전용 길드 9개**의 슬래시 명령을 나누어 등록합니다. `src/command-rules.ts`의 `ALLOWED_GUILD_ID`가 전용 기능의 최종 경계입니다. `guild_command_rules`는 **등록된 명령의 서버별 사용 허용 여부**만 관리하며 전용 서버 제한을 우회하지 못합니다.

| 등록 범위 | 명령어 |
| --- | --- |
| 전체 서버 | `/친밀도`, `/통화량`, `/통계`, `/친밀도그래프` |
| 전용 서버 | `/친밀도그래프3d` |
| 전용 서버·룰렛 | `/타겟`, `/관리자_타겟`, `/관리자머리끄댕이` |
| 전용 서버·대화 | `/model`, `/reasoning` |
| 전용 서버·Mind | `/mind`, `/memory`, `/shared-memory` |

관리자용 텍스트 명령은 `!sync`, `!서버목록`, `!서버별명령어`, `!도움`(코드의 단일 `ADMIN_USER_ID`)와 `!들낙감지설치`, `!들낙시간지정`, `!들낙무시`(전용 서버 관리자 또는 위 사용자)입니다. 상세 하위 명령·실행 예시는 [사용자 가이드](README_USER.md)를 참조하세요.

**새 명령 추가 절차:** (1) `SlashCommandBuilder` 작성 (2) `src/commands.ts` 적절한 스코프에 연결 (3) `src/index.ts` Interaction 라우터 추가 (4) 게이트/권한/옵션 검증 (5) `test/commands.test.js` 및 핸들러 테스트 보완 (6) `!sync` 또는 부팅 명령 동기화 검증.

## 8. 데이터베이스와 기록 수집

### 파일 배치와 핵심 테이블

~~~text
data/
├── guilds/
│   ├── <GUILD_ID>.sqlite          # 각 길드별 독립 DB
│   └── <GUILD_ID>.sqlite-wal      # 실행 중 존재할 수 있음
├── media/                         # 첨부/아바타 등 파일
├── seed/<GUILD_ID>/               # 백업 청크와 manifest(만든 경우)
└── media-seed/                    # 큰 미디어용 청크(만든 경우)
~~~

| 테이블 | 목적 |
| --- | --- |
| `discord_messages` / `message_details` | 정규화 메시지 본문·시각·채널, 부가 JSON/반응/멘션 |
| `users` / `activity` / `chat_stats` / `chat_stats_state` | 누적 및 KST 버킷 활동 통계 |
| `voice_sessions` / `voice_presence_sessions` | 현재 정산 상태 / 실제 체류 시작·종료 구간 |
| `user_profiles` / `profile_sweep_state` | 닉네임·아바타·배너 관측 이력과 sweep 위치 |
| `media_files` / `enrichment_state` | 미디어 처리 상태, 상세 재수집 완료 기록 |
| `settings` / `admin_target_roles` / `admin_defense_roles` | 룰렛·역할 설정 |
| `guild_command_rules` | 명령 on/off |
| `dunk_settings` / `dunk_ignored_channels` | 들낙 로그 채널·시간·제외 채널 |
| `mind_memories` / `mind_memory_subjects` / `mind_memory_audit` | 개인/공용 기억, 대상 색인, 변경 감사 |
| `mind_relationships` / `mind_events` / `mind_feedback` / `mind_meta` | 봇 관계 수치, 이벤트, 피드백, 메타 |
| 루트 DB의 `mind_decision_usage` | 전체 Decision 호출 예산 기록 |

`src/storage.ts`가 기본 스키마를 만들고 `src/mind/schema.ts`가 Mind 스키마를 이행합니다. **스키마 변경은 추가형 마이그레이션과 반복 실행 안전성**을 유지하세요.

### 메시지 적재 경로

~~~mermaid
flowchart LR
    LIVE[MessageCreate] --> CLEAN[정규화/상세/미디어 수집]
    BACK[초기·수동 Backfill] --> CLEAN
    CLEAN --> UPSERT[message_id 기반 중복 방지]
    UPSERT --> DM[(discord_messages)]
    UPSERT --> DETAIL[(message_details)]
    UPSERT --> PROFILE[(user_profiles)]
    UPSERT --> QUEUE[(media_files pending)]
    UPSERT --> COUNTS[(chat_stats)]
    QUEUE --> WORKER[미디어 워커] --> FILES[(data/media)]
~~~

- 초기 백필은 봇이 **접근할 수 있는** 메시지만 수집합니다. 다른 권한의 채널·삭제된 이력까지 읽어오는 것은 아닙니다.
- 채널별 기존 저장 범위를 사용해 반복 수집을 줄이고, `message_id` 중복으로 재전송/재실행을 흡수합니다.
- `SKIP_BACKFILL=true`여도 저장 메시지가 0개인 새 길드에는 1회 백필이 강제됩니다.
- 상세 메타데이터/프로필/미디어 보강(enrichment)은 별도 단계이며 완료 여부를 기억합니다.
- 미디어는 파일 전체를 메모리에 싣지 않고 스트리밍 저장하며 크기와 SHA-256을 관리합니다. 처리 상태(예: `pending`, `downloaded`, `too_large`, 실패)를 DB로 추적합니다.
- 소스 기록은 장기 보관될 수 있습니다. 개인 기억 삭제 명령이 `discord_messages`나 `data/media`를 지우지는 않습니다.

## 9. 음성 집계와 시각화

`VoiceStateUpdate`와 60초 정산 루프가 유저/채널 단위의 체류 시간을 누적합니다. 구간은 `voice_presence_sessions`에 남고, KST 일·ISO 주·월·전체 버킷은 `activity`에 반영됩니다. 재시작 시 현재 진행 중이던 세션을 정리하고 실제 접속 중인 멤버의 세션을 다시 엽니다.

친밀도는 **같은 채널에 동시에 있었던 구간의 교집합 시간**입니다. 실제 발화량, 감정 점수, 사적 친분의 증거가 아닙니다. `/친밀도`는 상위 21명, 카드 페이지는 7명 단위입니다. `/통화량`은 누적 상위 21명, `/통계`는 음성·채팅·종합 활동의 상위 7명 카드 3개입니다. 종합 활동 스코어는 코드에서 `chat_count + voice_seconds / 60`으로 계산합니다.

~~~mermaid
flowchart LR
    RAW[(voice_presence_sessions)] --> OVERLAP[동일 음성 채널의 시간 교집합]
    OVERLAP --> RANK[친밀도 순위]
    OVERLAP --> GRAPH[관계 그래프 링크]
    TOTAL[(users.voice_total)] --> CARD[통화량/통계 카드]
    RANK --> PNG[@napi-rs/canvas PNG]
    CARD --> PNG
    GRAPH --> TWO[2D FHD PNG]
    GRAPH --> THREE[3D Activity JSON]
~~~

2D 그래프는 전체 누적 상위 20명, 3D 그래프는 `7d`/`30d`/`all` 기간별 상위 20명을 대상으로 합니다. 7일과 30일은 **현재 시각으로부터의 이동 구간**이지 달력 주·월 경계가 아닙니다. 기본 관계선은 상위 관계 규칙에 따라 숨겨질 수 있으며, 실제 데이터는 선택/비교 시 더 노출됩니다.

## 10. 대화·판단·기억

대화는 **전용 서버**에서만 `기니봇아` 접두사, 봇 멘션, 봇 메시지 답장으로 호출합니다. `src/chat/config.ts` 기준 채널 최근 문맥은 10개, 응답 최대 800 토큰 요청, API 타임아웃 120초입니다. 지침은 `SOUL.md`에서 읽으며 파일을 못 읽으면 폴백 지침을 사용합니다.

~~~mermaid
sequenceDiagram
    actor U as Discord 사용자
    participant T as chat/triggers
    participant M as MindEngine
    participant DB as Mind SQLite
    participant D as Decisions API
    participant S as Exa
    participant L as Chat API
    U->>T: 기니봇아 / 멘션 / 답장
    T->>M: 채널 문맥 + 멘션 사용자
    M->>DB: 기억 후보·관계 상태 조회
    M->>D: 상황/행동 판단(가능한 경우)
    opt 기준 미달 / 정밀 판단 유용
      M->>D: 조건부 2차 판단
    end
    M->>DB: 검증된 기억 연산 기록
    opt 최신 정보 검색이 필요하다고 판단
      M->>S: Exa 검색(키가 있을 때)
    end
    M->>L: SOUL + 행동 프레임 + 문맥
    L-->>U: 한 번의 생성 답변
    M->>DB: 사후 관계·피드백 기록
~~~

- 판단 API는 생성 API와 **서로 다른 프로토콜**입니다(`/api/alpha/decisions` vs `/api/v1/chat/completions`). 생성 모델이 DB 수정 권한을 직접 갖지 않도록 TypeScript 코드가 결과를 검증합니다.
- 자체 예산(900/24h, 18/min 기본), 타임아웃 및 회로 차단기(연속 3회 실패 시 60초 차단)가 있습니다. 실패·제한 시 로컬 판단 폴백을 사용합니다.
- 조건부 정밀 판단을 제외하면 판단 1회, 응답 생성 1회가 기본 흐름입니다. Exa 키가 없을 때 검색이 필요한 질문은 검색 실패 정보를 반영할 수 있습니다.
- `MindMemoryStore`는 **개인 비공개 / 개인 공유 가능 / 서버 공용** 기억을 구분합니다. 타인 관련 사실의 범위 결정은 모델이 아닌 코드 정책이 재검증합니다.
- 별명은 공용 기억으로 관리하고, 길이 제한은 20자입니다. Markdown/멘션 문자열을 실제 Discord 전체 멘션으로 보내지 않도록 송신 계층의 `allowedMentions`를 제한합니다.
- `/memory clear confirm:true`는 본인 기억·관계 추정값을 지우지만 서버 원본 채팅과 공용 기억은 보존합니다.
- 새 기억 유형·권한을 추가하면 `src/mind/memory/operations.ts`, `policy.ts`, `store.ts`와 관련 권한 테스트를 함께 수정해야 합니다.

## 11. 3D Discord Activity

`/친밀도그래프3d`는 전용 서버에서 Discord **Activity 실행**으로 연결됩니다. 명령 호출은 Activity launch를 요청하고, 실제 UI는 Discord iframe의 `activity/dist` 정적 앱이 담당합니다.

~~~mermaid
sequenceDiagram
    participant C as Discord iframe
    participant API as Bun Activity HTTP
    participant O as Discord OAuth/API
    participant DB as 길드 SQLite
    C->>API: GET /api/activity/config
    C->>O: SDK authorize
    C->>API: POST /api/session/activity (code, instanceId)
    API->>O: OAuth code 교환 → userId
    API->>O: Activity instance 조회 → guildId, 참여자
    API-->>C: 인스턴스 결속 bearer session
    C->>API: GET /api/graph?period=7d|30d|all
    API->>DB: 음성 겹침·랭킹 집계
    API-->>C: GraphSnapshot
    C->>API: GET /api/graph/avatar/<userId>
    C->>C: Three.js WebGL 렌더링
~~~

**API 표면:** `GET /api/activity/config`, `POST /api/session/activity`, `GET /api/session`, `GET /api/graph`, `GET /api/graph/avatar/:userId` 및 정적 파일. 세션/그래프/아바타 요청은 인증과 레이트리밋을 확인합니다. 세션은 메모리에 30분 동안 보존되며 Activity 인스턴스에 묶입니다. 길드와 사용자 신원은 클라이언트에서 전달하는 ID가 아닌 Discord 조회 결과를 사용합니다. 주기적으로 멤버십·명령 활성 여부를 재검증합니다.

### 배포 조건

1. Discord Developer Portal에서 **Activities** 활성화.
2. Activity URL Mapping의 `/` 경로를 공개 HTTPS 오리진으로 연결.
3. OAuth2 Redirect 설정과 Developer Portal의 앱/URL 매핑을 실제 배포 오리진에 맞게 확인.
4. `ACTIVITY_ENABLED=true`, `DISCORD_CLIENT_SECRET` 설정. 앱 ID가 필요하면 `DISCORD_CLIENT_ID` 명시.
5. `bun run build:activity` 또는 Docker 이미지 빌드로 `activity/dist` 생성.
6. 역방향 프록시가 공용 HTTPS를 내부 `127.0.0.1:8787`(Compose 호스트 바인딩)로 연결하도록 설정.
7. Discord에서 명령 동기화 후 Activity를 실행해 7일/30일/전체 및 아바타를 확인.

서버에 GPU가 없어도 됩니다. WebGL을 못 쓰는 클라이언트는 표 형식의 폴백을 표시합니다. 운영 포트 `8787`을 무턱대고 공인망에 직접 노출하지 마세요.

## 12. Docker Compose로 호스팅하기 (Ubuntu 서버 / macOS)

이 저장소에는 **운영에 사용할 수 있는 `Dockerfile`과 `docker-compose.yml`이 이미 들어 있습니다.** Docker Compose 하나로 Bun 런타임·ffmpeg·3D Activity 정적 빌드를 묶어 실행할 수 있습니다. **24시간 운영은 절전 없이 계속 켜져 있는 Ubuntu/Linux 서버나 VPS**가 편리하며, macOS의 Docker Desktop도 개발 및 홈서버용으로 사용할 수 있습니다.

> 일반적인 Discord Gateway 봇은 외부에서 접속할 HTTP 포트가 필요하지 않습니다. **`8787` 포트는 3D Discord Activity API용**이며, 기본 Compose는 보안을 위해 **호스트의 `127.0.0.1`에만** 바인딩합니다. 봇이 대화·통계만 제공한다면 외부에 포트를 열지 마세요.

### 12.1 Docker 호스팅 구조

~~~mermaid
flowchart TB
    Discord[Discord Gateway / 명령] <-->|외부로 나가는 연결| Bot
    subgraph Host[Ubuntu VPS 또는 macOS 호스트]
      subgraph Docker[Docker Compose]
        Bot[bot 서비스 - Bun + ffmpeg]
        API[Activity HTTP :8787]
        Bot --- API
      end
      Data[(./data → /app/data)]
      Env[.env / SOUL.md]
      Proxy[선택: HTTPS reverse proxy]
    end
    Bot --> Data
    Env --> Bot
    Proxy -->|호스트 루프백 8787| API
    DiscordActivity[Discord Activity iframe] -->|HTTPS /api| Proxy
~~~

| 항목 | 실제 설정 | 의미 |
| --- | --- | --- |
| 서비스 이름 | `bot` | `docker compose logs bot`으로 조회 |
| 런타임 이미지 | `oven/bun:1.3.14` | 이미지 빌드 때 Bun/의존성 설치 |
| 음성 처리 | 컨테이너에 `ffmpeg` 설치 | 호스트에 ffmpeg 설치할 필요 없음 |
| Activity 빌드 | Dockerfile 첫 빌드 단계 | `activity/dist` 자동 생성 |
| 데이터 볼륨 | `./data:/app/data` | **컨테이너를 재생성해도 서버별 DB·미디어 보존** |
| 설정 | `env_file: .env`, `./.env:/app/.env` | 서버 비밀값을 Git에 올리지 않음 |
| 캐릭터 | `./SOUL.md:/app/SOUL.md:ro` | 읽기 전용 파일 마운트 |
| 포트 | `127.0.0.1:8787:8787` | Activity API는 호스트 로컬에서만 접근 |
| 재시작 | `restart: unless-stopped` | Docker 데몬이 재실행되면 컨테이너도 재시작(수동 중지 예외) |

이 프로젝트는 **Discord 봇·SQLite·Activity HTTP가 한 컨테이너**에서 실행됩니다. 별도의 PostgreSQL이나 Redis 컨테이너는 필요하지 않습니다. `web/`의 React/Cloudflare Pages 홈페이지는 이 Compose 서비스에서 배포하지 않습니다.

### 12.2 서버 준비: Docker 설치

**Ubuntu/Linux 서버:** [Docker 공식 Ubuntu 설치 안내](https://docs.docker.com/engine/install/ubuntu/)를 따라 Docker Engine, Buildx, Compose 플러그인을 설치하세요. 배포판별 패키지가 다를 수 있으므로 구형 `docker-compose` 명령 대신 **`docker compose`(띄어쓰기)**를 기준으로 합니다.

**macOS:** [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)을 설치하고 실행하세요. Mac이 잠자기 상태가 되면 Discord 연결이 끊길 수 있으므로 24시간 서비스에는 절전 정책을 검토하세요.

~~~bash
# Docker와 Compose가 설치됐는지 확인
docker --version
docker compose version
docker info
~~~

`docker info`에서 데몬 접근 거부가 나면 Docker Desktop 실행 여부 또는 Linux 사용자 권한을 확인하세요. Linux에서 `docker` 그룹에 사용자를 추가하면 사실상 높은 시스템 권한이 생기므로 신뢰할 수 있는 계정에만 허용하세요.

### 12.3 저장소 다운로드 및 비밀값 설정

GitLab 저장소는 **Private**입니다. 아래 예시는 **GitLab에 SSH 공개키를 등록한 운영 계정**을 전제로 합니다. HTTPS 클론도 가능하지만 비밀번호 대신 필요한 범위의 토큰 인증이 필요할 수 있습니다.

~~~bash
git clone git@gitlab.com:blond11qq/giinii_bot.git
cd giinii_bot

cp .env.example .env
chmod 600 .env
mkdir -p data

# .env 파일을 에디터로 열어 실제 값을 설정
micro .env
~~~

`micro`가 설치되지 않았다면 사용 가능한 다른 편집기를 쓰세요. **최소 필수 값은 `DISCORD_TOKEN`**입니다. `DISCORD_BOT_TOKEN`이 설정되면 이 값이 우선합니다. Discord Developer Portal에서 **Message Content Intent**를 켜고, 서버에 봇을 초대해 필요한 채널 읽기/메시지/음성 권한을 부여하세요.

~~~dotenv
# .env 핵심 예시 — 토큰을 실제 값으로 교체 (이 예시는 커밋 금지)
DISCORD_TOKEN=replace_with_discord_bot_token

# AI 대화를 쓸 때만: 전용 서버에서 동작
CHAT_OPENROUTER_API_KEY=

# 3D Discord Activity를 쓸 때만
# ACTIVITY_ENABLED=true
# DISCORD_CLIENT_SECRET=replace_with_client_secret
# DISCORD_CLIENT_ID=your_discord_application_id
~~~

선택 기능이 필요 없다면 OpenRouter/Activity 키를 비워 둬도 메시지 수집·음성 통계·룰렛 등 비-AI 기능은 동작합니다. `.env`에는 비밀키를 포함하므로 **Git에 추가하거나 스크린샷/로그에 공개하지 마세요.**

**경로 주의:** Compose는 `DATABASE_PATH=/app/data/bot.sqlite`를 컨테이너에 **강제 설정**합니다. 따라서 서버별 실제 DB는 `./data/guilds/<guildId>.sqlite`에 생성됩니다. 호스트 컴퓨터의 `./data`를 백업해야 하며, `/app/data`는 컨테이너 내부 경로입니다.

### 12.4 최초 빌드·기동·검증

~~~bash
# 저장소 루트(= docker-compose.yml이 있는 폴더)에서 실행
docker compose config --quiet
docker compose up -d --build

# 컨테이너 상태 및 시작 로그
docker compose ps
docker compose logs --tail=100 bot

# 실시간 로그: Ctrl+C는 로그 보기만 끝내며 컨테이너는 계속 실행
docker compose logs -f --tail=100 bot
~~~

정상 기동 시 `Logged in as ...`가 보이고, 최초에는 Discord 기록을 백필할 수 있습니다. 로그의 `Backfilling`/`Backfill ready`는 기록 수집 상태를 나타냅니다. 데이터가 많으면 처음 실행 시간이 길어질 수 있습니다. `docker compose ps`에서 `Up`만 보여도 Discord 로그인까지 성공했다고 단정하지 말고 **로그도 확인**하세요.

~~~mermaid
sequenceDiagram
    actor Admin as 운영자
    participant Compose as Docker Compose
    participant Bot as Bot Container
    participant Data as ./data/guilds
    participant Discord
    Admin->>Compose: docker compose up -d --build
    Compose->>Bot: 이미지 빌드 / 컨테이너 시작
    Bot->>Data: DB 시드 복원 시도(기존 파일은 건너뜀)
    Bot->>Discord: 토큰으로 로그인
    Discord-->>Bot: ClientReady
    Bot->>Data: 초기화·수집·음성 집계
    Bot-->>Admin: Logged in as / Backfill 로그
~~~

`Dockerfile`의 시작 명령은 `scripts/restore-db.ts /app/data/seed /app/data/guilds`를 실행한 뒤 봇을 시작합니다. **시드가 없으면 빈 DB로 시작**하고, **기존 DB가 있으면 기본적으로 덮어쓰지 않습니다**. 재배포 뒤 `skipping seed restore`는 정상적인 로그입니다.

### 12.5 자주 사용하는 운영 명령

| 작업 | 명령 |
| --- | --- |
| 현재 상태 | `docker compose ps` |
| 최근 로그 | `docker compose logs --tail=100 bot` |
| 실시간 로그 | `docker compose logs -f bot` |
| 컨테이너만 재시작 | `docker compose restart bot` |
| 봇 중지 | `docker compose stop bot` |
| 기존 컨테이너 다시 시작 | `docker compose start bot` |
| 설정/소스 변경 후 재빌드 | `docker compose up -d --build` |
| 컨테이너 종료·제거 | `docker compose down` (호스트 `./data`는 남음) |
| 디스크 용량 확인 | `du -sh data && df -h .` |

**구성/환경변수를 바꿨다면 `restart`만 쓰지 말고 `up -d --build`로 컨테이너를 다시 생성하세요.** `restart`는 Compose 설정이나 이미지를 갱신하지 않습니다.

### 12.6 GitLab 업데이트 → 컨테이너 새 버전 적용

~~~bash
cd giinii_bot
git status --short
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 bot
~~~

- `git status --short`에 예상하지 못한 수정이 있으면 덮어쓰지 말고 원인을 확인하세요.
- `--ff-only`는 로컬 브랜치가 갈라졌을 때 억지로 병합하지 않고 중단합니다.
- 이미지 재빌드/컨테이너 재생성은 `./data` 바인드 마운트를 유지합니다.
- **문서 커밋만 했어도 운영 서버가 자동 배포되지는 않습니다.** 새 커밋을 서버에서 Pull하거나 별도의 CD가 있어야 합니다.
- `git reset --hard`, 강제 Push, `rm -rf data` 같은 명령으로 운영 자료를 잃지 마세요.

프로젝트의 배포 자동화 지침은 `.codebuddy/skills/deploy/SKILL.md`에 있습니다. 이 스킬은 Pull, Compose 재빌드, 로그 검증을 수행하도록 정의돼 있지만 실제 배포가 수행되었다는 뜻은 아닙니다.

### 12.7 백업·복원 — 데이터 영속성 보호

가장 중요한 데이터는 **`./data/guilds/`의 SQLite, `./data/media/`의 수집 파일**, 그리고 서버별 설정입니다. Git 저장소/미러링은 이 데이터를 보관하지 않습니다. SQLite는 WAL을 쓰므로 **실행 중 단순한 DB 파일 복사보다는 서버 정지 후 백업**하거나 `snapshotDatabase` 등 SQLite 스냅샷 기능을 사용하세요.

~~~bash
# 저장소 루트에서 실행. 백업은 Git 저장소 밖에 보관
mkdir -p ../giinii_backups
chmod 700 ../giinii_backups

# 수집 중 쓰기를 멈추고 DB/WAL/미디어를 함께 압축
docker compose stop bot
tar -czf "../giinii_backups/giinii-data-$(date +%Y%m%d-%H%M%S).tar.gz" data
docker compose start bot
~~~

**경고:** 압축이 실패하면 봇이 중지된 채 남을 수 있으니 `docker compose ps`로 상태를 확인하세요. 백업 파일에는 채팅·음성 통계·미디어 등 민감한 정보가 있을 수 있으므로 **암호화하고 별도 안전 저장소로 복제**하세요. `.env`의 비밀값은 비밀번호 관리자 등 별도 안전 경로로 백업하고, 공개 저장소나 백업 공유 링크에 포함하지 마세요.

**복원 흐름(운영 중 실행 금지):** 봇 중지 → 현재 `data` 디렉터리를 별도 보관 → 검증된 백업 압축 파일을 저장소 루트에 풀어 `data/` 복구 → 권한 점검 → `docker compose up -d --build` → 로그인·통계 확인. 기존 자료에 `tar`를 무심코 덮어쓰지 마세요. `scripts/restore-db.ts`는 청크 시드 복원용이며 일반 tar 백업 복원과는 다릅니다. 상세는 [13장](#13-백업복원데이터-이동).

### 12.8 3D Discord Activity를 외부에서 열고 싶다면

Docker Compose의 기본 포트는 **`127.0.0.1:8787:8787`**로 설정되어 있어 외부 네트워크에서 직접 연결할 수 없습니다. Activity를 사용하려면 다음 추가 설정이 필요합니다.

1. `.env`에 `ACTIVITY_ENABLED=true`와 `DISCORD_CLIENT_SECRET`을 지정합니다.
2. Discord Developer Portal에서 Activities 및 URL Mapping을 설정합니다.
3. **호스트의 HTTPS 역방향 프록시**(예: Caddy/Nginx)가 공개 도메인의 요청을 호스트 루프백 `127.0.0.1:8787`로 전달하게 합니다.
4. `docker compose up -d --build`로 재생성하고 Discord 내에서 `/친밀도그래프3d`를 실행해 검증합니다.

**포트 8787을 `0.0.0.0:8787:8787`로 바꿔 직접 공개하지 마세요.** Discord iframe·OAuth·Activity 인스턴스 검증은 `src/activity-web-server.ts`에 있습니다. 상세 인증·URL 매핑 조건은 [11장](#11-3d-discord-activity)을 참고하세요.

### 12.9 장애가 나면 먼저 확인

| 증상 | 확인 | 대응 |
| --- | --- | --- |
| `docker compose`를 찾지 못함 | `docker compose version` | Compose 플러그인 설치 |
| 데몬 연결 실패 | `docker info` | Docker 서비스/Desktop 실행·권한 점검 |
| `no configuration file provided` | 현재 작업 디렉터리 | `docker-compose.yml`이 있는 저장소 루트에서 실행 |
| `env file .env not found` | `ls -la .env` | `cp .env.example .env` 후 실제 토큰 설정 |
| Discord 로그인이 실패함 | `docker compose logs bot` | 토큰·Gateway Intent·네트워크 점검 |
| 데이터가 비어 보임 | `docker compose config`, `ls data/guilds` | 호스트 볼륨 경로, 다른 작업 디렉터리 여부 확인 |
| `8787` 포트 충돌 | `docker compose ps`, 호스트 포트 점유 | 다른 서비스 정리 또는 **호스트 포트만** 변경 |
| 3D Activity가 흰 화면 | `ACTIVITY_ENABLED`, Secret, HTTPS URL Mapping | 11장 Activity 설정과 API 로그 점검 |
| 재시작 후 코드가 옛 버전 | `git rev-parse --short HEAD` | Pull 후 `up -d --build` 확인 |

**정리:** 평소 운영에는 `docker compose up -d --build`와 `docker compose logs -f bot`만 알면 시작할 수 있습니다. 그러나 **24시간 호스팅에는 지속 실행·백업·디스크 감시·토큰 보안까지 운영 책임이 포함**됩니다.

## 13. 백업·복원·데이터 이동

~~~mermaid
flowchart LR
    DB[(data/guilds/ID.sqlite)] --> SNAP[SQLite 스냅샷]
    SNAP --> CHUNKS[30 MiB 청크 + manifest]
    CHUNKS --> RESTORE[restore-db.ts]
    RESTORE --> VERIFY[크기 / SHA-256 검사]
    VERIFY --> TARGET[(복원된 길드 DB)]
~~~

- `scripts/split-db.ts`는 `produceChunkedSeed`를 호출해 길드별 manifest와 청크를 만듭니다.
- `scripts/restore-db.ts`는 manifest 크기·SHA-256을 검증하고 **기존 대상이 있으면 기본적으로 복원을 건너뜁니다.** `--force`는 대상 덮어쓰기이므로 운영 중에는 사용하지 마세요.
- 구형 단일 DB/시드는 `split-db-by-guild.ts`, `restore-legacy-db.ts`의 별도 이행 경로가 있습니다. 복구 전에 두 포맷을 혼동하지 마세요.
- `scripts/chunk-media.ts`는 이미 저장된 큰 파일을 별도 청크로 변환합니다. DB 시드와 미디어 시드는 **서로 다릅니다**.
- `data/`는 `.gitignore` 대상입니다. **Git 미러링은 DB 백업이 아닙니다.** 안전한 위치로 암호화/접근 제어한 백업을 별도로 보관하세요.
- WAL 사용 중인 SQLite 파일을 단순 복사하는 대신 앱 정지 후 복사하거나 SQLite backup API/스냅샷을 쓰세요(`src/storage.ts`의 `snapshotDatabase` 참고). 복원은 격리 환경에서 먼저 시험하세요.
- 파일 크기 가드는 기본 **30 MiB 초과**를 차단하도록 설계됐습니다. `.githooks/pre-commit` 훅을 사용하고 `scripts/check-large-files.ts`를 검증하세요.

## 14. 테스트와 변경 작업

~~~bash
bun install --frozen-lockfile
bun run check
bun test
bun run build:activity
bun run scripts/check-large-files.ts --tracked
~~~

`test/`는 저장·백필/다중 서버 분리, 음성 시간 교집합, 카드 레이아웃·그래프 커뮤니티, 들낙·룰렛, Activity OAuth·인스턴스 보안·레이트리밋·프런트 선택 상태, 대화 트리거·중복 처리, Mind 기억 접근권한·마이그레이션·Decision 예산·회로 차단 등을 검증합니다.

| 변경 영역 | 읽을 파일 | 우선 재검증할 테스트 |
| --- | --- | --- |
| Gateway/슬래시 | `index.ts`, `commands.ts`, `command-rules.ts` | `commands.test.js`, `admin-commands.test.js` |
| 저장/백필/집계 | `storage.ts`, `analysis.ts`, `activity.ts` | `storage.test.ts`, `voice-affinity.test.ts` |
| 음성/그래프 | `voice-graph-*.ts`, `activity/src/*` | `voice-graph-*.test.ts`, `activity-*.test.ts` |
| AI 대화 | `chat/*`, `SOUL.md` | `chat.test.ts` |
| Mind/기억 | `mind/*` | `mind.test.ts`, `mind-memory-*.test.ts` |
| 룰렛/들낙 | `roulette.ts`, `dunk-detection.ts` | `storage.test.ts`, `dunk-detection.test.ts` |
| 파일 안전 | `media-seed.ts`, `git-guard.ts` | `git-guard.test.ts`, `storage.test.ts` |

**원칙:** 새 기능마다 (1) 서버 범위/권한 (2) 저장·복구 영향 (3) 실패/재시작 (4) API 비용/타임아웃 (5) 테스트 (6) 이 두 README 갱신을 함께 검토합니다.

## 15. 운영·관측·장애 대응

| 증상 | 먼저 확인할 지점 | 대응 방향 |
| --- | --- | --- |
| 봇 접속 불가 | `DISCORD_TOKEN`, 네트워크, `docker compose logs bot` | 토큰·인텐트·부팅 스택 추적 |
| 슬래시 명령 안 보임 | 전역/전용 등록 범위, Discord 앱 설치, 로그 | 권한 있는 운영자가 `!sync`; 등록이 즉시 전파되지 않을 수 있음 |
| 대화만 동작 안 함 | `CHAT_OPENROUTER_API_KEY`, 전용 서버 게이트, `chat` 로그 | API 키/모델/한도/타임아웃 점검 |
| Mind 판단이 단순해짐 | `/mind status`, 차단기, quota | Decisions 실패 또는 로컬 폴백 확인 |
| 메시지 통계 누락 | 봇이 읽는 채널 권한, `SKIP_BACKFILL`, `chat_stats` | 권한 복원 후 수동 백필, 집계 상태 점검 |
| 음성 통계 어긋남 | `voice_presence_sessions` 구간, 60초 루프 | 재시작/채널 이동 및 오래 열린 세션 확인 |
| 미디어 다운로드 실패 | `media_files.status`, 파일 권한, 저장 공간 | worker 오류/크기 제한/만료된 URL 점검 |
| 3D Activity 실행 실패 | `ACTIVITY_ENABLED`, Client Secret, dist, HTTPS 매핑 | API/인증/프록시, Discord 내 iframe 테스트 |
| GitLab↔GitHub 불일치 | 미러 상태, GitHub Actions 로그 | 브랜치 분기/토큰 scope/권한 확인, force 금지 |
| 배포 후 DB가 비어 보임 | `./data` 마운트와 `DATABASE_PATH` | 볼륨/경로/시드 확인; 백업 없이는 삭제 금지 |

서버에서 시작할 때 `docker compose ps`와 `docker compose logs --tail=100 bot`가 기본입니다. SQLite는 **서버별**이므로 조사할 길드 ID를 먼저 확정하세요. 오류 로그에 토큰, 메시지 본문, 사용자 식별자, API 응답을 불필요하게 공개하지 마세요.

## 16. GitLab ↔ GitHub 동기화

현재 저장소의 동기화 구성은 다음과 같습니다.

~~~mermaid
flowchart LR
    GL[GitLab main / 원본] -- Push Mirror --> GH[GitHub main / 미러]
    GH -- push 이벤트 --> ACT[GitHub Actions]
    ACT -- fast-forward push, force 없음 --> GL
~~~

- GitLab → GitHub: GitLab Repository Push Mirroring.
- GitHub → GitLab: `.github/workflows/sync-to-gitlab.yml`의 `Sync GitHub to GitLab`, GitHub Repository Secret `GITLAB` 사용.
- 기존 미러 토큰과 GitHub Actions에서 사용하는 GitLab 토큰은 **서로 다른 인증 정보**입니다. 토큰을 README에 기록하지 마세요.
- **동시 수정/서로 다른 조상**이면 자동 병합이 아니라 Push 실패가 정상입니다. GitLab 미러의 `Keep divergent refs`를 활성화해 GitHub 커밋 강제 덮어쓰기를 피하세요.
- 한 방향의 성공만으로 양방향 정합성이 보장되지는 않습니다. 양쪽 최신 SHA를 비교하고 실패 로그를 살피세요.
- Git 미러는 **소스 코드·브랜치 커밋**을 다루며 Discord DB·미디어·GitLab 이슈/MR 등을 백업하거나 동기화하지 않습니다.

## 17. 보안·개인정보·제약

1. **저장 데이터는 민감할 수 있음:** 채팅 본문, 멘션, 프로필 이력, 파일, 음성 체류 기록, AI 기억은 서버 활동을 재구성할 수 있습니다. 실제 이용자에게 수집 항목과 운영 방침을 알리고 데이터 접근권한을 최소화하세요.
2. **분리된 삭제 범위:** `/memory delete`·`/memory clear`는 AI 개인 기억 관리 기능이지 모든 기록 삭제 요청 처리 시스템이 아닙니다. 채팅 원본·미디어·로그/백업의 삭제는 별도 운영 절차가 필요합니다.
3. **비밀값:** `.env`·GitHub/GitLab 토큰·Discord OAuth Secret은 저장소에 추가하지 마세요. `.env.example`은 비밀이 아닌 키 이름/예시만 담습니다.
4. **권한 경계:** 전용 길드/서버 관리자/개인 기억 소유권/Activity 인스턴스 신원 검증을 우회하지 마세요. 모델 출력만 믿고 DB나 역할을 수정하지 마세요.
5. **외부 서비스:** AI/검색은 OpenRouter·Exa로 입력 일부가 전송될 수 있습니다. 검색/생성 결과의 사실성은 보장되지 않습니다.
6. **놀이 기능:** 룰렛·친밀도·대화는 오락/활동 통계입니다. 심리 진단이나 사람 관계의 객관적 평가로 사용하지 마세요.
7. **현재 범위:** 서드파티 웹 공개 대시보드, 위키 자동 생성, 모든 관리 작업의 자체 웹 UI 등은 현재 이 저장소의 완성 기능이 아닙니다.
8. **문서와 코드:** 라이브 설정·권한은 환경에 따라 달라질 수 있습니다. 소스와 배포 설정을 검증한 뒤 운영하세요.

---

### 함께 읽기

- **[README_USER.md](README_USER.md):** 일반 사용자·서버 관리자를 위한 명령어·사용 예시·FAQ.
- [SOUL.md](SOUL.md): 챗봇 캐릭터 지침.
- [DESIGN.md](DESIGN.md): PNG 카드 레이아웃/디자인 원칙.
- [.env.example](.env.example): 설정 키 목록.
- [scripts/](scripts/), [test/](test/): 운영 작업과 회귀 검증.

> 유지보수 주의: README는 실행 로그의 복사본이 아니라 **구현의 지도**입니다. 명령어·스키마·외부 API·권한·운영 경로가 바뀌면 수정한 PR에서 같이 갱신해 주세요.
