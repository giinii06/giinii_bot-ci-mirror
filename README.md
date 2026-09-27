# Giinii Board Discord Bot

디스코드 서버의 **채팅과 음성 활동을 통째로 기록**하고, 그 기록을 근거로 **AI 분석·통계 카드·관리자 러시안 룰렛**을 제공하는 봇입니다.

Bun + TypeScript로만 작성했고, 외부 서버 없이 `bun:sqlite` 하나와 Discord Gateway, 선택형 LLM API만 사용합니다.

> **오락용 고지**
> `/mbti`, `/싸이코지수`, `/계급`, `/별명`, `/흑역사`, `/결투`, `/캐릭터`의 결과는 모두 **재미를 위한 생성물**입니다. 실제 정신질환·사이코패시 진단, 범죄 성향 판정, 사실 검증 결과가 아니며, 실제 망신이나 괴롭힘을 부추기는 용도로 설계되지 않았습니다. 모든 프롬프트는 서버 대화의 분위기와 밈만 근거로 삼으라고 지시합니다.

---

## 목차

1. [한눈에 보기](#한눈에-보기)
2. [요구 사항](#요구-사항)
3. [빠른 시작](#빠른-시작)
4. [아키텍처](#아키텍처)
5. [Discord 설정](#discord-설정)
6. [Slash Command](#slash-command)
7. [일반 메시지 명령](#일반-메시지-명령)
8. [AI 분석 파이프라인](#ai-분석-파이프라인)
9. [AI 프로바이더와 모델](#ai-프로바이더와-모델)
10. [음성 활동 통계](#음성-활동-통계)
11. [관리자 러시안 룰렛](#관리자-러시안-룰렛)
12. [웹 대시보드](#웹-대시보드)
13. [HTTP API 레퍼런스](#http-api-레퍼런스)
14. [데이터와 스키마](#데이터와-스키마)
15. [환경변수](#환경변수)
16. [프로젝트 구조](#프로젝트-구조)
17. [개발과 검증](#개발과-검증)
18. [백업과 복구](#백업과-복구)
19. [트러블슈팅](#트러블슈팅)

---

## 한눈에 보기

| 영역 | 내용 |
| --- | --- |
| **기록** | 디스코드 메시지를 실시간 저장 + 최초 기동 시 최근 10,000개 백필. SQLite `discord_messages` |
| **활동 집계** | 채팅 수·음성 체류 시간을 일/주/월/전체 버킷으로 누적. 기준시는 KST(UTC+9) |
| **AI 분석** | 9개 분석 명령어. 서버对话 기록을 컨텍스트로 LLM 호출. 실패 시 자동 폴백 |
| **통계 카드** | `/친밀도` `/통화량` `/통계` → 너비 2400 PNG 카드를 서버 내 렌더링 |
| **룰렛** | 관리자 대상 가위바위보. 방어권 역할, 65% 판정, 음성 재생 |
| **웹 UI** | 브라우저에서 provider·모델·프롬프트·기록 범위 변경. 두 모델 동시 비교 Playground |
| **데이터베이스** | `bun:sqlite` 단일 파일, WAL 모드. Docker 없이 로컬 실행 |

### 명령어 한눈에 보기

<details>
<summary>전체 16개 (클릭)</summary>

**AI 분석 (9개)**

`/question` `/mbti` `/결투` `/계급` `/싸이코지수` `/별명` `/흑역사` `/요약` `/캐릭터`

**음성·통계 (3개)**

`/친밀도` `/통화량` `/통계`

**관리자 룰렛 (4개)**

`/타겟` `/관리자_타겟` `/관리자머리끄댕이` `/관리자머리끄댕이방어권_역할`

**일반 메시지 명령 (3개)**

`!sync` `!debug on` `!debug off`

</details>

---

## 요구 사항

| 항목 | 버전 | 비고 |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.3 이상 | `bun:sqlite`, `Bun.serve`, 내장 테스트 러너를 모두 사용 |
| Discord 봇 토큰 | — | Developer Portal에서 생성 |
| LLM API key | 선택 | AI 분석을 쓸 때만 필요. [프로바이더 5종 중 1개](#ai-프로바이더와-모델) |
| ffmpeg | 선택 | 음성 파일이 OGG/Opus가 아닐 때 필요 |

**Node.js는 필요 없습니다.** 런타임·번들러·테스트 러너가 모두 Bun입니다.

### Discord 봇 만들기

1. [Developer Portal](https://discord.com/developers/applications)에서 Application 생성
2. **Bot** 탭에서 봇을 만들고 Token을 복사 (Bot → Reset Token)
3. **OAuth2 → URL Generator**에서 아래 권한을 선택해 초대 링크 생성
   - Scopes: `bot`, `applications.commands`
   - Permissions: [아래 최소 권한](#최소-권한) 참고

---

## 빠른 시작

### 로컬 실행

```sh
git clone git@github.com:blond11qq/giinii_bot.git
cd giinii_bot

cp .env.example .env
bun install

# .env에 DISCORD_TOKEN 입력
bun run check      # 타입 검사
bun test           # 테스트 12개
bun run start      # 봇 기동
```

기동 로그가 아래와 같이 나오면 정상입니다.

```text
Logged in as GiiniiBot#1234
Registered 16 slash commands in 서버이름
Settings UI listening on http://0.0.0.0:3003
Using gemini model: gemini-3.7-flash
Backfilling 서버이름 (서버ID) with 10000 messages in 100-message batches
Backfill ready for 서버이름: 10000 messages
```

> `Backfill ready`가 뜰 때까지 AI 분석 명령은 "아직 준비 중이에요"로 거절됩니다. 서버 규모에 따라 수 분 걸릴 수 있습니다.

**토큰 변수 이름**: `DISCORD_BOT_TOKEN`과 `DISCORD_TOKEN` 둘 다 지원하며, **둘 다 있으면 `DISCORD_BOT_TOKEN`을 우선**합니다. 토큰이 하나도 없으면 `config.ts`를 import하는 순간 프로세스가 죽습니다 — 설정 실수를 조용히 넘어가지 않기 위한 의도적 설계입니다.

### Docker Compose

```sh
cp .env.example .env
# .env에 DISCORD_TOKEN과 사용할 AI API key 입력

docker compose up -d --build
docker compose logs -f bot
```

이미지에 Bun 1.3.14와 ffmpeg가 모두 들어 있어 **별도 설치가 필요 없습니다.**

Compose 설정 요약:

| 항목 | 값 |
| --- | --- |
| 베이스 이미지 | `oven/bun:1.3.14` |
| 데이터 | `./data` → `/app/data` (볼륨) |
| 환경 변수 | `./.env` → `/app/.env` (볼륨) |
| `DATABASE_PATH` | `/app/data/bot.sqlite` 로 override |
| 포트 | `0.0.0.0:3003:3003` |
| 재시작 | `unless-stopped` |

```sh
docker compose down     # 중지 (data/ 삭제 안 함)
docker compose down -v  # 볼륨까지 삭제 (신중히)
```

> 이미지는 `src`와 `audio`만 복사합니다. `tsc`와 `bun test`는 이미지 안에서 동작하지 않습니다 — 검사는 호스트에서 하세요.

### 개발 모드

```sh
bun run dev
```

`bun --watch`로 파일 변경 시 자동 재시작합니다. **주의**: 재시작할 때마다 활성 음성 세션이 초기화되고 백필이 다시 시작되므로, 개발 중에는 `/통화량` 통계가 0에서 다시 쌓입니다.

---

## 아키텍처

### 한 요청의 전체 흐름

```text
Discord Gateway
     │
     ├─ MessageCreate ──▶ recordMessageActivity ──▶ activity / users 테이블
     │                  └▶ persistLiveMessage  ──▶ discord_messages 테이블
     │
     ├─ VoiceStateUpdate ─▶ handleVoiceStateUpdate ─▶ voice_sessions
     │                     (60초마다 startVoiceTracker가 시간 정산) ─▶ voice_presence_sessions
     │
     ├─ InteractionCreate(slash) ─▶ index.ts가 commandName으로 라우팅
     │        ├─ AI 분석 9종 ─▶ handleAnalysisCommand
     │        │       ├─ 백필 완료 게이트 확인
     │        │       ├─ 쿨다운 + 서버별 단일 실행 락
     │        │       ├─ collectHistory  (discord_messages → 프롬프트 텍스트)
     │        │       ├─ askGemini       (provider별 호출 → 실패 시 폴백)
     │        │       ├─ insertCommandLog (command_logs)
     │        │       └─ splitForEmbeds  → 결과 엠배드
     │        ├─ 친밀도/통화량/통계 ─▶ handleVoice*Command ─▶ renderVoiceAffinity (PNG)
     │        └─ 룰렛 4종 ─▶ handleRouletteCommand ─▶ @discordjs/voice
     │
     └─ InteractionCreate(button, voice-affinity:*) ─▶ 페이지 교체

Bun.serve (별도 스레드)
     ├─ /            설정 화면 HTML
     ├─ /playground  모델 비교 HTML
     └─ /api/*       설정 저장 · 서버 목록 · Playground 실행
```

### 모듈 의존성

```text
index.ts ──┬── config.ts ──── models.ts
           ├── commands.ts
           ├── storage.ts ─── history.ts (타입)
           ├── analysis.ts ──┬── config.ts
           │                 ├── embeds.ts
           │                 ├── gemini.ts ─── config.ts
           │                 ├── history.ts ── config.ts, storage.ts
           │                 ├── storage.ts
           │                 └── text.ts
           ├── activity.ts ──── storage.ts
           ├── roulette.ts ────┬── config.ts
           │                   └── storage.ts
           ├── voice-affinity-command.ts ─┬── activity.ts (bucketAt)
           │                               ├── storage.ts
           │                               ├── voice-affinity.ts (순수 계산)
           │                               └── voice-affinity-card.ts (@napi-rs/canvas)
           └── web.ts ────────┬── config.ts, analysis.ts, history.ts, gemini.ts
                               ├── models.ts, storage.ts
                               ├── settings-page.ts (HTML 문자열)
                               └── playground-page.ts (HTML 문자열)
```

의존성이 한 방향으로만 흐릅니다. 특히 `voice-affinity.ts`는 순수 함수라서 순서를 바꿔도 되는 단위 테스트가 가능하고, `web.ts`가 `index.ts`를 참조하지 않으므로 웹 서버를 Discord 로그인 없이 띄워 테스트할 수 있습니다.

### 설계 메모

- **단일 프로세스, 인메모리 상태.** 실행 중 분석 목록(`runningGuilds`), 쿨다운(`cooldowns`), 백필 상태(`backfillStatuses`), 룰렛 실행(`rouletteRuns`), PNG 페이지 캐시(`voiceAffinityPages`)는 전부 `Map`/`Set`입니다. 재시작하면 사라집니다. 영속화해야 하는 상태는 전부 SQLite에 있습니다.
- **쓰기 경로가 없다.** 설정 화면은 `POST /api/settings` → `updateRuntimeSettings()` → `.env` 파일 재작성입니다. 데이터베이스를 건드리지 않습니다.
- **SQLite를 싱글 스레드로 공유.** `bun:sqlite` `Database` 객체를 모듈 스코프에서 하나만 만들고 모든 쿼리가 그걸 씁니다.

---

## Discord 설정

### Gateway Intents

`src/index.ts`가 선언하는 Intent는 4개입니다.

| Intent | 용도 |
| --- | --- |
| `Guilds` | 서버 목록, 음성 어댑터 생성 |
| `GuildMessages` | `MessageCreate` 수신 |
| `GuildVoiceStates` | `VoiceStateUpdate` 수신 — 통화량 집계의 근간 |
| `MessageContent` | `Message Content` Privileged Intent. **반드시 켜야 합니다** |

Developer Portal → Bot → Privileged Gateway Intents 에서 **Message Content Intent** 를 켭니다.

Partial은 `Channel`, `Message` 두 개입니다.

> **Server Members Intent는 선언하지 않습니다.** 카드에 표시할 닉네임은 `guild.members.fetch()` REST 호출로 가져옵니다. 대신 해당 Guild Members 스코프 권한이 있어야 큰 서버에서도 정상 동작합니다.

### 최소 권한

봇 초대 시 필요한 권한입니다.

| 권한 | 필요 기능 |
| --- | --- |
| `View Channels` | 메시지 기록 백필, 분석 |
| `Read Message History` | 메시지 백필 |
| `Send Messages` | AI 결과, 룰렛 알림 |
| `Attach Files` | 디버그 프롬프트 첨부, 오류 임베드 |
| `Embed Links` | 결과 임베드 표시 |
| `Connect` | 룰렛 음성 재생 |
| `Speak` | 룰렛 음성 재생 |
| `Move Members` | 당첨자 음성 채널 이동 |
| `Manage Roles` | 타겟 역할 제거, 방어권 역할 소비 |
| `Administrator` | 일부 룰렛 **인자 명령**(아래 참고) |

> **권한 설명**: Slash Command 자체에 `Administrator` 기본 권한을 지정한 명령은 `/타겟`, `/관리자_타겟`, `/관리자머리끄댕이방어권_역할` 3개입니다. Discord가 실행자를 걸러 주지만, 코드侧에서도 `memberPermissions.has(Administrator)`로 한 번 더 검사합니다. `/관리자머리끄댕이` 자체에는 기본 권한 제한이 없고, **타겟 역할 보유자만** 실행할 수 있습니다(코드에서 확인).

### 명령어 등록 범위

```ts
// DISCORD_GUILD_ID가 있으면 해당 서버만, 없으면 봇이 들어간 모든 서버
```

`GuildCreate` 이벤트가 발생할 때마다 자동 재등록하므로, 서버에 나중에 초대해도 수동 작업이 필요 없습니다.

### 명령어가 보이지 않을 때

Discord는 슬래시 명령 변경 전파에 최대 1시간이 걸릴 수 있습니다. 강제로 재등록하려면 **관리자 권한으로 메시지 채널에** 다음을 보냅니다.

```text
!sync
```

응답으로 `16개 명령어를 서버에 등록했습니다.` 가 돌아오면 성공입니다.

---

## Slash Command

### AI 분석 (9개)

| 명령어 | 옵션 | 설명 | 출력 |
| --- | --- | --- | --- |
| `/question` | `question` (필수, 최대 1000자)<br>`limit` (선택, 1~10000)<br>`channels` (선택, 최대 500자) | 자유 질문. `channels`에 `#채널` 멘션이나 채널 ID를 넣으면 그 채널만 조회 | 임베드 |
| `/mbti` | `user` (필수) | 대화 패턴으로 MBTI 오락용 추정 | 임베드 |
| `/결투` | `user1`, `user2` (둘 다 필수) | 말싸움·드립 배틀 승리 확률 예측 (1~99%) | 임베드 |
| `/계급` | 없음 | 신·왕·귀족·하인·불가촉 천민 계급 | 임베드 |
| `/싸이코지수` | `user` (필수) | 혼돈·광기 지수 1~100점 | 임베드 |
| `/별명` | `user` (필수) | 서버 밈 별명 3~5개 | 임베드 |
| `/흑역사` | `user` (필수) | 말버릇·드립 실패·과몰입 | 임베드 |
| `/요약` | 없음 | 서버 사건·분위기 요약 | 임베드 |
| `/캐릭터` | `user` (필수) | RPG 캐릭터 시트 (직업·성향·궁극기·약점·장비) | 임베드 |

**공통 규칙**

- **서버 채널에서만** 실행됩니다. DM에서는 "서버에서만 사용할 수 있어요"로 거절합니다.
- **서버당 동시 실행 1개.** 실행 중이면 "이미 처리 중이에요"로 거절합니다.
- **사용자당 쿨다운** `QUESTION_COOLDOWN_SECONDS`(기본 20초). 거절 메시지에 남은 초가 표시됩니다.
- 결과가 1,800자를 넘으면 자동 분할되어 `(1/3)`, `(2/3)` … 형태로 연속 전송됩니다.

**백필 게이트**

첫 기동 시 최근 10,000개 메시지를 백필합니다(채널당 100개 단위 라운드로빈). 백필이 끝나기 전까지 모든 AI 명령은 "아직 준비 중이에요"로 거절됩니다.

| 상태 | 메시지 |
| --- | --- |
| 진행 중 | `초기 채팅 기록 10000개를 저장하는 중입니다. 백필이 끝난 뒤 다시 시도해 주세요.` |
| 실패 | `초기 채팅 기록 백필 중 오류가 났어요. 봇 로그를 확인해 주세요.` + 에러 메시지(최대 800자) |
| 성공 | 분석 허용 |

봇이 새로 초대된 서버는 `GuildCreate`에서 자동으로 백필이 시작됩니다.

### 음성 활동 통계 (3개)

| 명령어 | 옵션 | 설명 | 출력 |
| --- | --- | --- | --- |
| `/친밀도` | `유저` (필수) | 대상 유저와 **같은 음성 채널에 함께 있었던 시간** TOP 21 | PNG 카드, 7명/페이지 |
| `/통화량` | 없음 | 서버 **전체 누적 통화량** TOP 21 | PNG 카드, 7명/페이지 |
| `/통계` | `기간` (선택: 오늘 / 이번 주 / 이번 달 / 전체, 기본 전체) | 채팅량·통화량·종합 활동량 **각 TOP 7** | PNG 카드 3장 |

`/통계`의 종합 활동량 점수식은 `채팅 수 + 통화 분`입니다. 즉 **메시지 1개 = 1점, 통화 1분 = 1점**입니다.

`/친밀도`, `/통화량`의 페이지는 ◀ ▶ 버튼으로 넘깁니다. 렌더링한 PNG는 메모리에 캐시되며 **15분 후 만료**됩니다. 만료 후 버튼을 누르면 "결과가 만료되었습니다"로 안내하고 명령을 다시 쓰라고 합니다.

### 관리자 러시안 룰렛 (4개)

| 명령어 | 인자 / 옵션 | 설명 |
| --- | --- | --- |
| `/타겟` | `인자` = `지정` / `삭제` / `조회`<br>`역할` (`지정`에 필수) | 룰렛 실행 시 실행자에게서 **제거될 역할**을 지정 |
| `/관리자_타겟` | `인자` = `지정` / `삭제` / `조회`<br>`역할` (`지정`·`삭제`에 필수) | 룰렛 **대상-pool**에 추가할 관리자 역할. 여러 개 가능 |
| `/관리자머리끄댕이` | 없음 | 실제 룰렛 실행 |
| `/관리자머리끄댕이방어권_역할` | `인자` = `추가` / `조회` / `제거`<br>`역할` (`추가`·`제거`에 필수) | 방어권 역할. 여러 개 가능 |

**타겟 역할 조건**

- `@everyone`(`guild.id`)은 지정할 수 없습니다
- 관리되는 역할(`managed`)은 지정할 수 없습니다
- 봇의 최고 역할보다 **낮은** 역할이어야 합니다 (그래야 제거할 수 있음)

**전체 실행 흐름** — 자세한 건 [관리자 러시안 룰렛](#관리자-러시안-룰렛) 참고.

---

## 일반 메시지 명령

DM이 아니라 **서버 메시지 채널**에서 봇이 보이는 메시지를 보냅니다. 권한 검사 대상은 봇 계정이 아니라 **메시지를 보낸 사람**입니다.

| 명령 | 필요 권한 | 설명 |
| --- | --- | --- |
| `!sync` | `Administrator` | Slash Command를 현재 서버에 강제 재등록 |
| `!debug on` | 없음 | 이 서버에서 LLM 호출 직전 프롬프트를 `llm-prompt-debug.txt` 첨부로 전송 |
| `!debug off` | 없음 | 디버그 모드 해제 |

> 디버그 모드는 **서버 단위**입니다. 켠 사용자에게 LLM에 들어갈 전체 프롬프트(시스템 프롬프트 + 질문 + 최근 대화 기록)가 txt 파일로 전송됩니다. **민감한 대화 내용이 채널에 노출되므로**, 켜기 전 반드시 채널 권한을 확인하세요.
>
> Gemini를 쓰면 텍스트, OpenAI 호환 provider를 쓰면 `messages` 배열 JSON이 첨부됩니다.

---

## AI 분석 파이프라인

### 1단계 — 컨텍스트 수집

`collectHistory(guild, limit, channels)` 가 SQLite에서 직접 읽습니다. Discord API를 다시 부르지 않습니다.

**채널 선택 기준** — 다음을 모두 만족하는 채널만 대상입니다.

1. 텍스트 계열 채널 타입: `GuildText`, `GuildAnnouncement`, `PublicThread`, `PrivateThread`, `AnnouncementThread`
2. `messages` 접근이 가능한 채널
3. **`@everyone` 역할에 대해 `ViewChannel` 권한이 없는 채널은 제외** — 봇이 못 보는 채널의 대화는 AI에 노출되지 않습니다
4. `channels` 옵션으로 지정한 ID가 있으면 그 ID만

조회 결과는 `created_at DESC`로 뽑은 뒤 **시간순으로 되돌려서** 반환합니다.

**프롬프트 텍스트 조립** (`formatForPrompt`)

```text
[일반]

홍길동: 안녕하세요
감자: 반갑습니다

[게임방]

감자: ㅋㅋㅋ
```

- 메시지를 시간순 정렬 후 **채널별로 묶습니다**
- 채널 블록 사이에만 빈 줄을 넣습니다
- 총 길이가 `MAX_CONTEXT_CHARS`(기본 160,000자)를 넘으면 도달한 지점에서 잘리고, 남은 부분은 `[이후 기록은 컨텍스트 길이 제한으로 생략됨]` 으로 대체됩니다

**봇 메시지 포함 여부** — `INCLUDE_BOT_MESSAGES`가 참이어도 `collectHistory` 단계에서 필터링됩니다(기본 거짓).

### 2단계 — 프롬프트 조립

모든 AI 명령 프롬프트는 **공통 프롬프트 + 명령별 프롬프트** 순서로 붙습니다.

```text
[COMMON_PROMPT]

[COMMAND_PROMPT]

<질문자>
displayName: nickname
username: username
userId: 1234567890
</질문자>

<질문>
실제 질문
</질문>

<최근_디스코드_기록>
[채널명]

작성자: 내용
...
</최근_디스코드_기록>
```

> **주의 — provider별 컨텍스트 상이**
> Gemini 경로는 위 텍스트를 **단일 문자열**로 보냅니다. 반면 OpenAI 호환 경로는 `system` + `user` `messages` 배열로 나누고, **대화 기록을 12,000자로 잘라냅니다**(`OPENAI_COMPATIBLE_HISTORY_CHARS`). `MAX_CONTEXT_CHARS`를 160,000으로 올려도 OpenAI 호환 provider에 대해서는 12,000자에서 잘립니다. OpenAI 호환 경로의 컨텍스트를 늘리려면 `src/gemini.ts`의 상수를 수정해야 합니다.

### 3단계 — 모델 호출 및 폴백

```text
주 provider 호출
  ├─ 성공 → 반환
  ├─ 빈 응답 → 1회 재시도
  │            ├─ 성공 → 반환
  │            └─ 실패 → 폴백
  └─ 예외 → 폴백

폴백 (FALLBACK_AI_PROVIDER / FALLBACK_AI_MODEL)
  ├─ 성공 → 반환
  └─ 실패 → 사용자에게 provider/model과 함께 오류 임베드
```

폴백이 트리거되면 진행 임베드가 `다시 호출합니다!` 로 바뀝니다. 기본 폴백은 `opencode_zen / deepseek-v4-flash-free`입니다.

> **Playground는 폴백하지 않습니다.** 두 모델을 공정하게 비교해야 하므로 `allowFallback: false`로 호출합니다. 한쪽만 폴백되면 비교 결과가 왜곡되기 때문입니다.

### 4단계 — 결과 처리

- 1,800자를 넘으면 단어/줄바꿈 경계에서 분할 (`splitForEmbeds`)
- 각 페이지가 별도 임베드로 `followUp` 전송, 제목에 `(n/N)` 표시
- 전체 소요 시간, provider, model, 질문, 답변이 `command_logs`에 저장됩니다

> ⚠️ `command_logs`는 **Discord 채널에 출력된 AI 답변과 사용자의 질문을 평문으로 저장**합니다. 프롬프트가 담긴 대화 기록 자체는 저장하지 않지만, `/question`에 입력한 텍스트는 남습니다. 개인정보를 언급하지 않도록 프롬프트를 쓰는 것이 좋습니다.

---

## AI 프로바이더와 모델

### 지원 프로바이더

| Provider | 키 변수 | Base URL 변수 (기본값) | 비고 |
| --- | --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | — | `@google/genai` SDK, 단일 문자열 프롬프트 |
| `opencode_zen` | `OPENCODE_ZEN_API_KEY` | `OPENCODE_ZEN_BASE_URL`<br>`https://opencode.ai/zen/v1` | OpenAI 호환 |
| `nvidia_nim` | `NVIDIA_NIM_API_KEY` | `NVIDIA_NIM_BASE_URL`<br>`https://integrate.api.nvidia.com/v1` | OpenAI 호환 |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL`<br>`https://openrouter.ai/api/v1` | OpenAI 호환 |
| `bynara` | `BYNARA_API_KEY` | `BYNARA_BASE_URL`<br>`https://router.bynara.id/v1` | OpenAI 호환, Mistral 계열에 `reasoning_effort: high` |

선택한 provider의 키만 있으면 됩니다. 기본 endpoint가 없는 Gemini를 제외하면 base URL은 자유롭게 바꿀 수 있습니다.

### 호출 파라미터

| 항목 | Gemini | OpenAI 호환 |
| --- | --- | --- |
| 전송 형태 | 단일 `contents` 문자열 | `messages` 배열 (system + user) |
| 최대 출력 토큰 | `4,096` | `32,768` |
| temperature | SDK 기본 | `0.2` |
| reasoning | — | `include_reasoning: false`<br>(Bynara + `mistral-small-latest`/`mistral-medium-3-5`는 `reasoning_effort: high`) |
| 대화 기록 절단 | `MAX_CONTEXT_CHARS` | **12,000자 고정** |

응답에서 `thinking` 타입 청크는 걸러내고 텍스트만 합칩니다. `reasoning_content`는 로그에만 기록되고 사용자에게는 노출되지 않습니다.

### 무료 모델 카탈로그

`src/models.ts`에 하드코딩된 **무료 티어 모델 목록**입니다. 여기 없는 모델 ID는 설정해도 **조용히 해당 provider의 첫 번째 모델로 대체**됩니다. 유료 모델을 쓰려면 이 배열에 직접 추가해야 합니다.

<details>
<summary><code>gemini</code> — 12개</summary>

| ID | 이름 | 설명 |
| --- | --- | --- |
| `gemini-3.7-flash` | Gemini 3.7 Flash | AI Studio stable text model |
| `gemini-3.6-flash` | Gemini 3.6 Flash | Free tier text model |
| `gemini-3.5-flash` | Gemini 3.5 Flash | AI Studio stable text model |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | Free tier text model |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | Free tier text model |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | AI Studio free tier preview |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | AI Studio free tier preview |
| `gemini-2.5-pro` | Gemini 2.5 Pro | Free tier text model |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Free tier text model, 1M context |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite | Free tier text model |
| `gemma-4-31b-it` | Gemma 4 31B | Free tier open model |
| `gemma-4-26b-a4b-it` | Gemma 4 26B A4B | Free tier open model |

</details>

<details>
<summary><code>opencode_zen</code> — 7개 (기본 폴백 프로바이더)</summary>

| ID | 이름 |
| --- | --- |
| `big-pickle` | Big Pickle |
| `deepseek-v4-flash-free` | DeepSeek V4 Flash Free ← **기본 폴백 모델** |
| `mimo-v2.5-free` | MiMo V2.5 Free |
| `laguna-s-2.1-free` | Laguna S 2.1 Free |
| `ling-3.0-flash-free` | Ling-3.0 Flash Free |
| `north-mini-code-free` | North Mini Code Free |
| `nemotron-3-ultra-free` | Nemotron 3 Ultra Free |

</details>

<details>
<summary><code>nvidia_nim</code> — 5개</summary>

| ID | 이름 |
| --- | --- |
| `deepseek-ai/deepseek-v4-flash` | DeepSeek V4 Flash |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra 550B |
| `nvidia/nvidia-nemotron-nano-9b-v2` | Nemotron Nano 9B v2 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | Nemotron 3 Nano Omni Reasoning |
| `z-ai/glm-5.2` | GLM 5.2 |

</details>

<details>
<summary><code>openrouter</code> — 4개</summary>

| ID | 이름 |
| --- | --- |
| `poolside/laguna-xs-2.1:free` | Poolside Laguna XS 2.1 |
| `cohere/north-mini-code:free` | Cohere North Mini Code |
| `tencent/hy3:free` | Tencent Hunyuan 3 |
| `inclusionai/ling-3.0-flash:free` | Ling-3.0 Flash |

</details>

<details>
<summary><code>bynara</code> — 2개</summary>

| ID | 이름 |
| --- | --- |
| `mistral-large` | Mistral Large |
| `mistral-medium-3-5` | Mistral Medium 3.5 ← `reasoning_effort: high` 적용 |

</details>

### 프롬프트 커스터마이징

10개 프롬프트 전부 환경변수와 웹 설정 화면 양쪽에서 바꿀 수 있습니다. 값을 비우면 기본값으로 되돌아갑니다.

| 변수 | 대상 명령 | 기본 프롬프트 핵심 |
| --- | --- | --- |
| `COMMON_PROMPT` | **전체 공통** | 한국어 전용, 기록에 없는 사실 창작 금지, Discord Markdown(표 금지) |
| `QUESTION_PROMPT` | `/question` | 결론先行 + 근거 목록, 500~800자 |
| `MBTI_PROMPT` | `/mbti` | 말투·의사결정·감정표현만 근거, 500~800자 |
| `DUEL_PROMPT` | `/결투` | 욕설 부추김 금지, 오락용 분석, 1~99% 확률 |
| `RANK_PROMPT` | `/계급` | 5단계 계급 전부 사용, 근거 짧게, 700~1000자 |
| `PSYCHO_PROMPT` | `/싸이코지수` | 실제 진단 아님, 50점 근처 뭉개지 말 것, 500~800자 |
| `NICKNAME_PROMPT` | `/별명` | 별명 3~5개, 실명·외모·민감정보 금지 |
| `THROWBACK_PROMPT` | `/흑역사` | 망신주기 아님, 모욕·혐오·추측 금지 |
| `SUMMARY_PROMPT` | `/요약` | 사건·주제·분위기 + 한줄평 + MVP |
| `CHARACTER_PROMPT` | `/캐릭터` | 직업·성향·패시브·궁극기·약점·장비, 현실 신분 금지 |

> 설정 화면에서 저장하면 `.env` 파일이 **덮어쓰기**됩니다. 여러 줄짜리 프롬프트는 `JSON.stringify`로 이스케이프되어 한 줄로 저장되므로, `.env`를 직접 편집할 때는 한 줄로 써야 합니다.

---

## 음성 활동 통계

### 통화 시간 집계 방식

Discord에는 "누가 얼마나 말했는지"가 아니라 **"누가 언제 접속해 있었는지"** 만 있습니다. 이 봇은 후자를 초 단위로 누적합니다.

**추적 루프**

1. `VoiceStateUpdate`마다 이전 세션의 경과 시간을 정산(`settleSession`)
2. `startVoiceTracker`가 **60초마다** 전체 활성 세션을 정산
3. **KST 자정을 넘으면** 세션을 쪼개서 자정 이전/이후에 각각 기록 (`recordVoice`)
4. 통화 채널을 옮기면 기존 구간을 마치고 새 구간을 시작
5. 봇 재시작 시: 미종료 `voice_presence_sessions`를 현재 시각에 닫고, `voice_sessions`를 비운 뒤, **현재 실제로 음성 채널에 있는 사람들만** 새 세션으로 재시드

> **정확도 주의**: 60초 주기 정산이므로 프로세트가 죽으면 마지막 구간이 유실될 수 있습니다. 또한 이 방식은 **뮤트/비접속 포함 전체 체류 시간**입니다. 실제로 발화한 시간만 재려면 음성 패킷 수신 통계가 별도로 필요합니다.

**버킷 기준 (KST = UTC+9)**

| 버킷 | 키 형식 | 예시 |
| --- | --- | --- |
| `day` | `YYYY-MM-DD` | `2026-09-27` |
| `week` | ISO 8601 주 (`YYYY-Www`) | `2026-W40` |
| `month` | `YYYY-MM` | `2026-09` |
| `all` | `all` | `all` |

한 번 기록할 때 **네 버킷 전부에 동시에** 누적됩니다. `/통계`는 `all`일 때 `users` 테이블의 누적값을, 그 외에는 `activity` 테이블의 버킷 값을 읽습니다.

### 친밀도 계산

`voice_presence_sessions`의 구간을 **구간 교집합**으로 계산합니다.

```text
겹치는 시간 = max(두 started_at) → min(두 ended_at)
```

- 같은 `channel_id`인 구간만 비교합니다
- 자기 자신은 제외합니다
- 유저 ID는 `trim()` 정규화 후 합칩니다
- `ended_at`이 `null`(진행 중)이면 현재 시각으로 간주합니다
- 정렬: 함께 있던 시간 내림차순 → 마지막 함께한 시각 내림차순 → 유저 ID 오름차순
- 상위 **21명**만 카드로 표시, 7명씩 페이지

> 계산은 순수 함수 `buildVoiceAffinity(targetSessions, otherSessions, now)` 입니다. 대상 유저의 구간 × 전체 유저의 구간을 이중 반복하므로, 대상 유저의 통화 이력이 아주 길면 O(n×m) 시간이 걸립니다. 대부분은 수백~수천 건 규모라 문제가 없습니다.

### PNG 카드 렌더링

`@napi-rs/canvas`로 **너비 2400** PNG를 메모리에서 직접 그립니다. 외부 이미지 렌더링 API를 쓰지 않으므로 비공개 서버에서도 동작합니다.

**네 개 모드가 하나의 구조를 공유합니다.** `/통화량`·`/통계`·`/친밀도`가 그리는 카드는 헤더 그리드·요약 블록·열·행 구조가 완전히 동일하며, 모드에 따라 바뀌는 것은 **강조색 2색과 문자열, 값 포맷터**뿐입니다. `/통계`가 보내는 카드 3장은 그래서 하나의 표처럼 읽힙니다. 토큰과 근거는 [`DESIGN.md`](./DESIGN.md)에 있습니다.

- **높이는 내용에 따라 가변** — 7행 1372px, 1행 664px, 빈 상태 664px. 행 높이는 모든 경우에 118px로 고정이라 카드마다 리듬이 달라지지 않습니다
- 폰트: `src/assets/BMDoHyeon-Regular.ttf` (BM DoHyeon) — 실행 시 `GlobalFonts.register`로 등록
- **모드별 강조색** (민트 / 하늘 / 호박 / 라벤더). 강조색은 overline·1위 값·진행 바 **세 곳에만** 쓰입니다

| 모드 | 명령 | 강조색 | overline |
| --- | --- | --- | --- |
| 친밀도 | `/친밀도` | 민트 `#6FE3C8` | `VOICE AFFINITY` |
| 통화량 | `/통화량` | 하늘 `#7FC7F5` | `GIINII BOARD · VOICE` |
| 채팅량 | `/통계` | 호박 `#F2C86A` | `GIINII BOARD · CHAT` |
| 종합 활동량 | `/통계` | 라벤더 `#C3AEF7` | `GIINII BOARD · ACTIVITY` |

- 우측 상단 요약 블록은 **항상 2개** — 첫 번째는 전체 합계, 두 번째는 순위 인원 수. 모드가 달라도 개수와 위치가 같습니다
- 순위는 **색이 아니라 표면 밝기**로 구분합니다 (1위 `rowLead` / 짝수 `rowAlt` / 홀수 `row`). 순위 숫자가 병기되므로 색 테두리는 쓰지 않습니다
- 부제에 **조회 시각**을 `Asia/Seoul` 기준 `ko-KR` 포맷으로 표기
- 값 표기: 통화·친밀도는 `N시간 M분` / `M분` / `1분 미만`, 채팅은 `N개`, 활동은 `N점`
- **기록이 없으면 열 헤더를 그리지 않습니다.** 빈 표의 헤더는 정보가 아니라 소음이며, 총계는 `0`이 아니라 `—`로 표시해 "0"과 "없음"을 구분합니다

---

## 관리자 러시안 룰렛

통화방에 있는 관리자 중 한 명을 무작위로 뽑아 음성으로 지목하고, 채널에서 강제 퇴장시키는 장난 명령입니다.

### 사전 설정

```text
/타겟  인자:지정  역할:@게임참가자      ← 실행 시 이 역할이 실행자에게서 제거됨
/관리자_타겟 인자:지정  역할:@운영팀     ← 이 역할도 룰렛 대상에 포함 (선택, 여러 개 가능)
/관리자머리끄댕이방어권_역할 인자:추가 역할:@방어권
```

### 실행 순서

| # | 단계 | 실패 시 |
| --- | --- | --- |
| 1 | 동일 서버에서 이미 진행 중인지 확인 | "이미 진행 중인 관리자 러시안 룰렛이 있습니다" |
| 2 | 타겟 역할이 설정되었는지 확인 | "/타겟의 인자를 지정으로 선택해 타겟 역할을 설정하세요" |
| 3 | 음성 파일이 하나라도 존재하는지 확인 | "음성 파일이 설정되지 않았습니다" |
| 4 | **실행자가 타겟 역할을 가지고 있는지** 확인 | "ㅋ 역할도 없네 그지다" |
| 5 | 통화방에서 **관리자 후보** 수집<br>(Discord 관리자 권한 보유자 + `admin_target_roles` 역할 보유자) | "통화방에 관리자가 없습니다" |
| 6 | 통화방에서 **방어권 역할 보유자** 수집 | — |
| 7 | 타겟 역할이 관리되는 역할이거나 봇 최고 역할 이상인지 확인 | "타겟 역할이 봇 역할보다 높거나 관리되는 역할입니다" |
| 8 | 봇에 대상 채널의 `연결`+`말하기` 권한이 있는지 확인 | "봇에게 대상 음성 채널의 연결 및 말하기 권한이 필요합니다" |
| 9 | **실행자의 타겟 역할 제거** (사유: `관리자 러시안 룰렛 시작`) | "타겟 역할 제거에 실패했습니다" |
| 10 | 지연 응답( deuter ) 삭제 | — |
| 11 | 통화방 채널에 시작 알림 전송 | — |
| 12 | **방어권 판정** (아래 상세) | — |
| 13 | `3...` `2...` `1...` 카운트다운 (각 1초) | — |
| 14 | 당첨자 결정 (아래 상세) | — |
| 15 | 당첨자 통화방에서 무작위 음성 재생 | "음성 재생에 실패했지만 룰렛은 종료되었습니다" (조용히 종료) |
| 16 | 음성 연결 해제 + 당첨자 퇴장 (사유: `관리자 러시안 룰렛 종료`) | — |

**카운트다운 메시지**는 명령어가 실행된 채널과, 관리자·방어권 역할 보유자가 있는 **모든 음성 채널의 텍스트 채널**로 함께 발송됩니다.

### 확률

| 상황 | 확률 | 비고 |
| --- | --- | --- |
| 방어권 성공 | **65%** | `isDefenseSuccess(roll) = roll < 0.65`. 경계값 0.65는 실패 |
| 당첨자가 **실행자 본인** | **5%** | 실행자가 이미 방어권을 소모했다면 발동하지 않음 |
| 그 외 | 균등 무작위 | 남은 관리자 후보 중에서 |

### 방어권 규칙

- 판정 직전에 **방어권 역할을 실제로 제거**합니다 (사유: `관리자 러시안 룰렛 방어권 행사`). 한 번 쓸 수 있고 다시 쓰려면 명령으로 재추가해야 합니다.
- 역할 제거는 **한 번에 전부** 처리되며, 하나라도 실패하면 무시되고 계속 진행합니다.
- 성공: 해당 관리자들은 **당첨자 후보에서 제외**됩니다. 모든 관리자가 방어권에 성공하면 룰렛이 종료되고 "저런... 통방에 남은 관리자가 없군요 ㅠㅠ" 메시지가 나갑니다.
- 실패: 방어권 성공자들의 음성 채널에서 **강제 퇴장** (사유: `관리자 러시안 룰렛 방어권 실패`).

### 음성 재생

- `audio/`에 있는 후보 중 **존재하는 파일 중 무작위 1개** 선택
- 후보 목록: `VOICE_AUDIO_PATH`(기본 `./audio/roulette.ogg`), `./audio/roulette-2.ogg`, `./audio/roulette-3.ogg`
- `.ogg`로 끝나면 `StreamType.OggOpus`로 스트리밍, 아니면 경로 그대로 재생
- 구독자가 없어도 재생은 유지되지 않으므로 `NoSubscriberBehavior.Stop` 설정
- 음성 연결은 **최대 30초** 안에 `Ready`가 되어야 함. 실패하면 예외로 전환하고 `finally`에서 반드시 해제
- 재생이 끝나면(또는 실패하면) **반드시** 연결을 끊고 당첨자를 퇴장시킵니다

> **파일 추가**: `.ogg`(Opus) 형식이라면 ffmpeg 없이도 재생됩니다. 다른 형식은 컨테이너에 ffmpeg가 들어 있어 변환이 가능하지만, `audio/` 디렉터리에 넣어두면 런타임에 그대로 재생됩니다.

---

## 웹 대시보드

봇이 기동되면 `WEB_PORT`(기본 3003)에서 두 개의 페이지와 네 개의 API를 제공합니다.

> ### ⚠️ 인증이 없습니다
> **모든 엔드포인트에 인증·인가·CSRF 방어가 전혀 없습니다.** anyone이 접속하면
> - 봇 토큰은 아니지만 **AI API key를 포함한 전체 설정**을 읽고 쓸 수 있고 (키 값은 안 보내지만 덮어쓸 수 있음)
> - **서버 채팅 기록 전체를 LLM에 흘려보낼 수 있으며**
> - **LLM API를 무제한으로 호출**해 과금시킬 수 있습니다
>
> 반드시 `WEB_HOST=127.0.0.1`로 바인딩해 로컬에서만 쓰거나, 리버스 프록시 + 인증을 앞에 두세요. `docker-compose.yml`은 기본적으로 `0.0.0.0:3003`에 publishes 하므로 그대로 쓰면 **같은 네트워크의 모든 기기에 열립니다.**

### 설정 화면 — `/`

`GIINII BOARD · AI LAB` 브랜딩. 다크 모드 자동 대응, 720px 이하 반응형.

| 섹션 | 항목 |
| --- | --- |
| **Provider** | provider 드롭다운 5종 |
| **Model** | 현재 provider의 모델을 **카드 그리드**로 표시. 카드 클릭 시 선택. 모델명, ID, note/context 태그 표시 |
| **오류 재호출** | 폴백 provider + 폴백 모델. provider를 바꾸면 모델 드롭다운이 그 provider 목록으로 갱신되고, API key 유무를 안내 문구로 표시 |
| **기록 범위** | 공통 기준 메시지 수(1~10000), 최대 컨텍스트 문자 수(10000~1000000) |
| **프롬프트** | 공통 + 명령별 9종 텍스트에어리어 |
| **봇 메시지** | `INCLUDE_BOT_MESSAGES` 체크박스 |
| **인증 정보** | provider별 API key(마스크 처리) + OpenAI 호환 4종의 base URL |

API key 입력란은 **쓰기 전용**입니다. 로드 시 값을 비워 두고 "저장됨" / "비어 있음"만 표시하며, 빈 값으로 저장하면 기존 키를 **유지**합니다. `GET /api/settings` 응답에도 키 값이 아닌 `hasGeminiApiKey` 같은 불리언만 나갑니다.

### Playground — `/playground`

메인 설정은 건드리지 않고 **이번 실행에만 쓸 provider/모델 2개**를 골라 나란히 비교합니다.

1. **Discord 서버 선택** — 서버명 + 저장된 메시지 수 표시
2. **분석 명령어 선택** — 9종. 명령에 따라 필요한 입력 필드가 동적으로 바뀝니다
   - `question` → 질문 텍스트에어리어
   - `결투` → 유저 1, 유저 2
   - `mbti` `싸이코지수` `별명` `흑역사` `캐릭터` → 대상 유저
3. **기준 메시지 수** (1~10000), **채널 필터** (`#채널` 또는 채널 ID)
4. **RUN A / RUN B** 각각 provider + 모델 선택. 모델을 바꾸면 해당 provider의 API key 유무를 안내
5. **두 모델 동시에 실행** — 서버에서 `Promise.all`로 **병렬** 호출
6. 결과 카드 2장: 성공/실패, 소요 시간(ms), 응답 전문

> 기본값은 RUN A = 현재 provider/model, RUN B = 다른 provider(현재이 gemini면 opencode_zen, 아니면 gemini). Playground는 폴백하지 않으므로, 한쪽 provider에 API key가 없으면 그쪽만 실패로 표시됩니다.

---

## HTTP API 레퍼런스

응답 JSON은 모두 `Cache-Control: no-store` 헤더를 갖습니다.

| 메서드 | 경로 | 설명 | 성공 | 실패 |
| --- | --- | --- | --- | --- |
| `GET` | `/` | 설정 화면 HTML | `200 text/html` | — |
| `GET` | `/playground` | Playground HTML | `200 text/html` | — |
| `GET` | `/api/settings` | 현재 설정 조회 (키는 불리언으로만) | `200 JSON` | — |
| `POST` | `/api/settings` | 설정 저장 → `.env` 재작성 | `200 JSON` (저장 후 설정) | `500` |
| `GET` | `/api/playground/servers` | 봇이 있는 서버 목록 + 저장 메시지 수 | `200 JSON` | — |
| `POST` | `/api/playground/run` | 2개 모델 병렬 실행 | `200 JSON` | `400 {error}` |
| 그 외 | — | — | — | `404 Not found` |

**`GET /api/settings` 응답 예시** (발췌)

```json
{
  "aiProvider": "gemini",
  "aiModel": "gemini-3.7-flash",
  "fallbackProvider": "opencode_zen",
  "fallbackModel": "deepseek-v4-flash-free",
  "historyMessageLimit": 10000,
  "maxContextChars": 160000,
  "includeBotMessages": false,
  "freeModels": { "gemini": [ ... ], "opencode_zen": [ ... ] },
  "hasGeminiApiKey": true,
  "hasOpencodeZenApiKey": false,
  "hasNvidiaNimApiKey": false,
  "hasOpenrouterApiKey": false,
  "hasBynaraApiKey": false
}
```

**`POST /api/settings`** 는 화이트리스트 방식으로 필드를 골라 씁니다. 나열되지 않은 키는 무시됩니다. provider 값도 화이트리스트에 없으면 무시됩니다. 숫자 범위와 빈 문자열 처리(프롬프트는 빈 값이면 기본값 복원, API key는 빈 값이면 기존 값 유지)는 서버에서 강제됩니다.

**`POST /api/playground/run` 요청 본문**

```json
{
  "guildId": "1234567890",
  "command": "mbti",
  "targetUser": "nickname (@username)",
  "limit": 1000,
  "channels": "#채널명 123456789012345678",
  "tests": [
    { "provider": "gemini", "model": "gemini-3.7-flash" },
    { "provider": "opencode_zen", "model": "big-pickle" }
  ]
}
```

`tests`는 **정확히 2개**여야 하고, 각 모델은 `freeModelCatalog`에 실제로 존재해야 합니다. 검증 실패 시 `400`과 함께 한국어 오류 메시지를 반환합니다.

---

## 데이터와 스키마

### 파일 배치

```text
data/
├── bot.sqlite       # 메인 데이터베이스
├── bot.sqlite-shm   # WAL 공유 메모리
└── bot.sqlite-wal   # WAL 로그
```

기본 경로는 `./data/bot.sqlite`이며, `DATABASE_PATH`로 바꿀 수 있습니다. 디렉터리는 없으면 자동 생성합니다.

연결 시 `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`을 설정합니다.

### 테이블

<details>
<summary><code>users</code> — 서버별 유저 누적 (PRIMARY KEY: guild_id + user_id)</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `guild_id` | TEXT | Discord 서버 ID |
| `user_id` | TEXT | 유저 ID |
| `chat_total` | INTEGER | 누적 채팅 수 (봇 메시지 제외) |
| `voice_total` | REAL | 누적 통화량(초) |

`/통계`의 `기간: 전체`는 이 테이블을 읽고, `/통화량`도 이 테이블의 `voice_total`을 씁니다.

</details>

<details>
<summary><code>activity</code> — 기간별 버킷 (PRIMARY KEY: guild_id + user_id + bucket_type + bucket_key)</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `guild_id` | TEXT | 서버 ID |
| `user_id` | TEXT | 유저 ID |
| `bucket_type` | TEXT | `day` / `week` / `month` / `all` |
| `bucket_key` | TEXT | `2026-09-27` / `2026-W40` / `2026-09` / `all` (KST 기준) |
| `chat_count` | INTEGER | 해당 기간 채팅 수 |
| `voice_seconds` | REAL | 해당 기간 통화량(초) |

`/통계`의 오늘·이번 주·이번 달은 이 테이블을 읽습니다.

</details>

<details>
<summary><code>voice_sessions</code> — 현재 진행 중인 음성 세션 (PRIMARY KEY: guild_id + user_id)</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `guild_id` | TEXT | 서버 ID |
| `user_id` | TEXT | 유저 ID |
| `channel_id` | TEXT | 현재 음성 채널 |
| `last_tick` | INTEGER | 마지막 정산 시각(ms) |
| `limited` | INTEGER | 예약 필드 (항상 0, 현재 미사용) |

</details>

<details>
<summary><code>voice_presence_sessions</code> — 음성 구간 이력</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | INTEGER PK AUTOINCREMENT | |
| `guild_id` | TEXT | 서버 ID |
| `user_id` | TEXT | 유저 ID |
| `channel_id` | TEXT | 음성 채널 |
| `started_at` | INTEGER | 진입 시각(ms) |
| `ended_at` | INTEGER | 이탈 시각(ms). 진행 중이면 `NULL` |

인덱스 `voice_presence_lookup (guild_id, user_id, channel_id, started_at, ended_at)`.
**`/친밀도`의 유일한 데이터 소스**이며, 봇이 꺼져 있는 시간은 기록되지 않습니다.

</details>

<details>
<summary><code>discord_messages</code> — AI 분석용 메시지 (PRIMARY KEY: message_id)</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `message_id` | TEXT | Discord 메시지 ID |
| `guild_id` | TEXT | 서버 ID |
| `channel_id` | TEXT | 채널 ID |
| `channel_name` | TEXT | 채널명 (백필 이후 이름 변경은 반영 안 됨) |
| `author_id` | TEXT | 작성자 ID |
| `author_name` | TEXT | 작성자 표시명 (기록 시점 값) |
| `author_is_bot` | INTEGER | 봇 여부 (0/1) |
| `content` | TEXT | 정규화된 본문 |
| `created_at` | INTEGER | 발생 시각(ms) |
| `updated_at` | INTEGER | 마지막 upsert 시각(ms) |

인덱스: `discord_messages_guild_created_idx (guild_id, created_at DESC)`, `discord_messages_guild_channel_created_idx (guild_id, channel_id, created_at DESC)`.

`message_id`가 PRIMARY KEY이므로 같은 메시지는 항상 덮어쓰기(upsert)됩니다 — **메시지 수정/삭제 반영은 실시간 경로에서만** 이루어집니다.

</details>

<details>
<summary><code>command_logs</code> — AI 명령 실행 로그</summary>

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | INTEGER PK AUTOINCREMENT | |
| `guild_id` | TEXT | 서버 ID |
| `channel_id` | TEXT | 실행된 채널 |
| `user_id` | TEXT | 실행자 |
| `user_name` | TEXT | 실행자 표시명 |
| `command_name` | TEXT | 명령어 이름 |
| `question` | TEXT | LLM에 보낸 질문 텍스트 |
| `provider` | TEXT | 사용 provider |
| `model` | TEXT | 사용 모델 |
| `output` | TEXT | LLM 응답 전문 |
| `created_at` | INTEGER | 실행 시각(ms) |

인덱스: `command_logs_guild_created_idx (guild_id, created_at DESC)`.
**현재 읽는 코드가 없습니다** — 감사·비용 확인용으로 쌓입니다. 장기 운영 시 정리 policies를 정하세요.

</details>

<details>
<summary><code>settings</code>, <code>admin_target_roles</code>, <code>admin_defense_roles</code> — 룰렛 설정</summary>

| 테이블 | 스키마 | 용도 |
| --- | --- | --- |
| `settings` | `guild_id` PK, `target_role_id` | 서버별 타겟 역할 (최대 1개) |
| `admin_target_roles` | PK(guild_id, role_id) | 룰렛 대상에 포함할 관리자 역할 (복수) |
| `admin_defense_roles` | PK(guild_id, role_id) | 방어권 역할 (복수) |

</details>

### 메시지 정규화

`cleanMessage()`가 AI 컨텍스트용 텍스트를 만듭니다.

- 본문(`cleanContent`) + 첨부파일 요약 + 스티커 요약을 이어 붙입니다
  - 첨부: `[첨부:파일명]`
  - 스티커: `[스티커:스티커명]`
- 연속 공백/줄바꿈을 **단일 공백으로 축약**합니다
- 결과가 빈 문자열이면 **저장하지 않습니다** (순수 이미지, 스티커만인 메시지 등)

> 채널명/작성자명은 **저장 시점의 값**입니다. 나중에 이름을 바꿔도 historic 기록은 갱신되지 않습니다.

### 마이그레이션

`initDatabase()`는 멱등 실행되며, 기동 시마다 다음을 수행합니다.

1. `CREATE TABLE IF NOT EXISTS` + 인덱스 생성
2. `settings`에 `target_role_id` 컬럼이 없으면 `ALTER TABLE`로 추가
3. `command_logs`에 `question` 컬럼이 없으면 기본값 `''`로 추가
4. **구 레거시 테이블 `roulette_target_roles`가 있으면** 서버별로 `MIN(role_id)` 하나를 대표값으로 삼아 `settings.target_role_id`에 이관합니다. **이때 기존에 값이 있는 `settings` 행은 덮어쓰지 않습니다** (`WHERE settings.target_role_id IS NULL`)

> 이 이관 로직은 테스트로 고정되어 있습니다 (`test/storage.test.ts`의 "does not overwrite a configured target role during migration"). 레거시 테이블은 지우지 않고 남겨둡니다.

---

## 환경변수

Bun은 `.env`를 자동으로 로드합니다. `src/config.ts`가 **모듈 평가 시점에 한 번만** 읽고, 이후에는 웹 설정 화면에서 바꾸는 값이 메모리에 우선합니다.

### 필수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` / `DISCORD_TOKEN` | 없음 | 봇 토큰. 둘 다 있으면 `DISCORD_BOT_TOKEN` 우선. **둘 다 없으면 기동 실패** |

### Discord

| 변수 | 기본값 | 범위 | 설명 |
| --- | --- | --- | --- |
| `DISCORD_GUILD_ID` | 전체 서버 | — | 지정하면 이 서버에만 명령어 등록 + 백필. 백필에도 적용 |

### 데이터베이스

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/bot.sqlite` | SQLite 파일 경로. 상위 디렉터리 자동 생성 |

### AI

| 변수 | 기본값 | 범위 | 설명 |
| --- | --- | --- | --- |
| `AI_PROVIDER` | `gemini` | `gemini` / `opencode_zen` / `nvidia_nim` / `openrouter` / `bynara` | 알 수 없는 값이면 `gemini`로 |
| `AI_MODEL` | provider 첫 모델 | 카탈로그에 있는 ID | 카탈로그에 없으면 **조용히** provider 첫 모델로 대체 |
| `GEMINI_MODEL` | — | — | `AI_MODEL`이 없을 때만 사용 (구 호환) |
| `FALLBACK_AI_PROVIDER` | `opencode_zen` | 위와 동일 | 주 provider 실패 시 재호출 대상 |
| `FALLBACK_AI_MODEL` | `deepseek-v4-flash-free` | 카탈로그 ID | |

### AI 인증 및 엔드포인트

| 변수 | 기본값 |
| --- | --- |
| `GEMINI_API_KEY` | 없음 |
| `OPENCODE_ZEN_API_KEY` | 없음 |
| `OPENCODE_ZEN_BASE_URL` | `https://opencode.ai/zen/v1` |
| `NVIDIA_NIM_API_KEY` | 없음 |
| `NVIDIA_NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `OPENROUTER_API_KEY` | 없음 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `BYNARA_API_KEY` | 없음 |
| `BYNARA_BASE_URL` | `https://router.bynara.id/v1` |

### 프롬프트 (10개)

`COMMON_PROMPT`, `QUESTION_PROMPT`, `MBTI_PROMPT`, `DUEL_PROMPT`, `RANK_PROMPT`, `PSYCHO_PROMPT`, `NICKNAME_PROMPT`, `THROWBACK_PROMPT`, `SUMMARY_PROMPT`, `CHARACTER_PROMPT`

비우면 내장 기본 프롬프트가 사용됩니다. 자세한 역할은 [프롬프트 커스터마이징](#프롬프트-커스터마이징)을 보세요.

### 동작

| 변수 | 기본값 | 범위 | 설명 |
| --- | --- | --- | --- |
| `HISTORY_MESSAGE_LIMIT` | `10000` | 1 ~ 10000 | AI 분석의 기본 기준 메시지 수 |
| `MAX_CONTEXT_CHARS` | `160000` | 10000 ~ 1000000 | 프롬프트에 넣는 최대 문자 수. **OpenAI 호환 경로에는 적용되지 않음(12,000자 고정)** |
| `INCLUDE_BOT_MESSAGES` | `false` | 불리언 | AI 컨텍스트에 봇 메시지 포함 여부 |
| `QUESTION_COOLDOWN_SECONDS` | `20` | 0 ~ 3600 | 사용자별 AI 명령 대기 시간 |
| `VOICE_AUDIO_PATH` | `./audio/roulette.ogg` | — | 룰렛 음성 후보 1번. 2·3번(`roulette-2.ogg`, `roulette-3.ogg`)은 코드에 고정 |

**불리언 파싱**: `1`, `true`, `yes`, `y`, `on` (대소문자 무시) 중 하나면 참. 빈 문자열이면 기본값. 그 외엔 거짓.

### 웹 서버

| 변수 | 기본값 | 범위 | 설명 |
| --- | --- | --- | --- |
| `WEB_HOST` | `0.0.0.0` | — | 바인딩 주소. **`127.0.0.1`로 바꾸면 외부 접근 차단** |
| `WEB_PORT` | `3003` | 1 ~ 65535 | 포트 |

### `.env` 덮어쓰기 규칙

설정 화면에서 저장하면 `saveEnvSettings()`가 기존 `.env`를 **줄 단위로 재작성**합니다.

- `^[A-Z0-9_]+=` 패턴에 맞는 줄만 값이 교체되고, **주석·빈 줄·형식 밖의 줄은 그대로 보존**됩니다
- 관리 대상 키가 `.env`에 없으면 **맨 끝에 추가**됩니다 (`.env`가 없으면 새로 만듭니다)
- 값이 `[A-Za-z0-9_./:@-]`만으로 구성되면 그대로, 그렇지 않으면 `JSON.stringify`로 이스케이프해 한 줄로 저장합니다 (여러 줄 프롬프트 처리용)

> 설정 화면은 **커밋되지 않은 `.env`를 수정**합니다. `.env`를 버전 관리에 넣었다면 의도치 않은 변경이 생길 수 있습니다. `.gitignore`에 포함되어 있는지 확인하세요.

---

## 프로젝트 구조

```text
giinii_bot/
├── src/
│   ├── index.ts                    # Discord 로그인, 이벤트 배선, 명령어 라우팅
│   ├── commands.ts                 # Slash Command 정의 + guild별 등록
│   ├── config.ts                   # 환경변수 파싱, 런타임 설정, .env 쓰기
│   ├── models.ts                   # provider별 무료 모델 카탈로그
│   ├── storage.ts                  # SQLite 스키마, 마이그레이션, 쿼리 헬퍼
│   ├── history.ts                  # 채널 선택, 메시지 수집, 프롬프트 텍스트 조립
│   ├── analysis.ts                 # AI 명령 처리, 백필, 디버그 모드, command_logs
│   ├── gemini.ts                   # provider별 LLM 호출, 재시도, 폴백, 로그 마스킹
│   ├── embeds.ts                   # 진행/결과/안내 임베드 빌더
│   ├── text.ts                     # 긴 텍스트를 Discord 임베드 크기로 분할
│   ├── activity.ts                 # 채팅·음성 활동 집계, 버킷, 음성 트래커
│   ├── voice-affinity.ts           # 음성 구간 교집합 계산 (순수 함수)
│   ├── voice-affinity-command.ts   # /친밀도 /통화량 /통계 + 페이지 버튼
│   ├── voice-affinity-card.ts      # 통계 카드 PNG 렌더링 (토큰은 DESIGN.md)
│   ├── roulette.ts                 # 관리자 러시안 룰렛 + 음성 재생
│   ├── web.ts                      # Bun.serve 라우팅, 설정/Playground API
│   ├── settings-page.ts            # 설정 화면 HTML
│   ├── playground-page.ts          # Playground HTML
│   └── assets/
│       └── BMDoHyeon-Regular.ttf   # 카드 렌더링 폰트
├── DESIGN.md                       # 통계 카드 디자인 시스템 (토큰 · 구조)
├── test/
│   ├── storage.test.ts             # 마이그레이션, 영속성, 폴백, 동시 호출
│   ├── voice-affinity.test.ts      # 친밀도 계산 + PNG 렌더링
│   └── text.test.ts                # 임베드 분할
├── audio/
│   ├── roulette.ogg                # 룰렛 음성 1
│   ├── roulette-2.ogg              # 룰렛 음성 2
│   └── roulette-3.ogg              # 룰렛 음성 3
├── Dockerfile                      # oven/bun:1.3.14 + ffmpeg
├── docker-compose.yml              # 볼륨·포트·재시작 정책
├── package.json
├── tsconfig.json
├── .env.example                    # 모든 환경변수 예시
└── README.md
```

### 의존성

| 패키지 | 버전 | 용도 |
| --- | --- | --- |
| `discord.js` | `^14.25.1` | Gateway, Slash Command, 임베드, 음성 상태 |
| `@discordjs/voice` | `^0.19.2` | 음성 연결 및 OGG/Opus 재생 |
| `@google/genai` | `^1.27.0` | Gemini 호출 |
| `@napi-rs/canvas` | `^1.0.2` | 서버 내 PNG 렌더링 (네이티브) |

개발 의존성은 `typescript`와 `@types/bun` 두 개뿐입니다.

---

## 개발과 검증

```sh
bun install --frozen-lockfile
bun run check     # tsc --noEmit — src, test 포함
bun test          # bun:test 12개
bun run dev       # 파일 변경 시 자동 재시작
```

### `bun run check`가 보는 것

`tsconfig.json`은 `strict: true`, `target: ESNext`, `module/moduleResolution: Preserve/bundler`, `skipLibCheck: true`, `types: ["bun-types"]`이며 **`src`와 `test`를 모두 포함**합니다. 테스트 파일의 타입 오류도 걸립니다.

### 테스트 12개가 검증하는 것

| 파일 | 테스트 | 검증 대상 |
| --- | --- | --- |
| `text.test.ts` | 임베드 크기 제한 | 4,000자 초과 텍스트가 전부 1,800자 이하 페이지로 나뉨 |
| `storage.test.ts` | `migrates and stores AI questions` | 레거시 DB에 `question` 컬럼이 없어도 `ALTER TABLE`로 추가되고, 질문과 답변이 왕복 저장됨 |
| | `does not overwrite a configured target role` | 레거시 이관이 **이미 설정된 타겟 역할을 덮어쓰지 않음** |
| | `persists roulette role settings` | 룰렛 역할 3종이 SQLite에 저장되고 **별도 연결로도 읽힘** (실제 커밋 확인) |
| | `uses a 65 percent defense boundary` | 방어권 경계 — `0.64` 성공, `0.65` 실패 |
| | `falls back to the configured model after an AI request error` | 주 요청이 예외를 던지면 폴백 provider/model로 **정확히 2번째 요청**이 나가고, `onFallback` 콜백이 호출됨 |
| | `uses provider and model overrides for concurrent playground requests` | 병렬 Playground 2건이 **서로 다른 endpoint·모델로** 독립적으로 나감 |
| `voice-affinity.test.ts` | `voice affinity sums overlapping sessions` | 여러 구간의 **교집합 합산**과 순위 정렬, 다른 채널은 무시, 자기 자신 제외 |
| | `normalizes equivalent user IDs` | 공백이 다른 동일 ID가 하나의 유저로 합쳐짐 |
| | `renders a voice affinity PNG card` | 친밀도 모드 PNG 시그니처(`89504e47...`) 확인 |
| | `renders a voice volume PNG card` | 통화량 모드 렌더링 |
| | `renders chat and combined activity PNG cards` | 채팅량·종합 활동량 모드 렌더링 |
| | `keeps a fixed width and grows the card` | 카드 너비 2400 고정, 높이는 행 수에 비례. 빈 카드가 내용 카드보다 크지 않음 |
| | `gives every mode the same geometry` | 4개 모드가 같은 행 수에서 **높이가 완전히 동일** — 통일성 회귀 방지 |

> 테스트는 `mkdtempSync`로 임시 디렉터리를 만들고, **레거시 스키마를 직접 만든 뒤** 마이그레이션을 실행하고, 마지막에 디렉터리를 삭제합니다. 실제 `data/bot.sqlite`는 건드리지 않습니다. `globalThis.fetch`를 스텁으로 교체해 네트워크 호출을 가로챕니다.

### 코드 스타일

- 2칸 들여쓰기, 세미콜론, 큰따옴표, ESM(`type: module`, import 경로에 `.js` 확장자)
- `import type`을 값 import와 분리해 타입 의존성 명시
- 에러는 `console.error`/`console.warn`로만 처리 — 조용히 삼키지 않음
- 로그에 찍는 응답 본문은 `sk-`, `AIza`, `nvapi-`, JWT 패턴을 마스킹한 뒤 최대 1,200자로 자릅니다

---

## 백업과 복구

데이터베이스는 저장소에 **30MB 조각으로 나누어** `data/seed/`에 커밋합니다. `bot.sqlite`가 30MB를 넘으면 조각이 여러 개 생기고, `docker compose up`이 첫 기동 때 자동으로 이어붙여 `data/bot.sqlite`를 만듭니다.

```
data/
├── seed/                     # 커밋 대상
│   ├── manifest.json         # 조각 목록, 총 크기, sha256
│   ├── bot.sqlite.part-001   # 30MB
│   └── bot.sqlite.part-002   # 나머지
└── bot.sqlite                # 실행 중 DB (커밋 대상 아님, seed에서 자동 복원)
```

**조각 갱신**

```sh
docker compose down
# 실행 중인 DB를 정리한 뒤
bun run scripts/split-db.ts data/seed data/bot.sqlite
```

**수동 복원**

```sh
bun run scripts/restore-db.ts data/seed data/bot.sqlite          # 있으면 건너뜀
bun run scripts/restore-db.ts data/seed data/bot.sqlite --force  # 강제 재생성
```

복원 시 `manifest.json`의 총 크기와 sha256을 검증하므로 조각이 깨져 있으면 실패합니다.

**백업**

SQLite가 **WAL 모드**이므로 실행 중인 파일은 `bot.sqlite`만 복사하면 안 됩니다. 봇을 중지하고 `data/` 디렉터리 전체를 통째로 복사하세요.

```sh
docker compose stop bot
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose start bot
```

**복구**: 봇을 중지한 상태에서 `data/` 디렉터리 내용을 교체한 뒤 재기동합니다. 스키마는 자동 생성·자동 마이그레이션됩니다.

**무결성 확인**

```sh
bun -e 'const {Database}=require("bun:sqlite");const db=new Database("./data/bot.sqlite");console.log(db.query("PRAGMA integrity_check").get());console.log(db.query("SELECT COUNT(*) AS n FROM discord_messages").get())'
```

> **`discord_messages`가 비어 보일 수 있습니다.** 백필은 봇이 서버에 초대된 시점 이후의 채널 메시지만 가져오며, Discord API는 과거 메시지 접근을 제한합니다. 오래된 서버라면 백필 결과가 적을 수 있습니다.

---

## 트러블슈팅

### 봇이 기동되지 않고 멈춘다

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `Missing required env var: DISCORD_BOT_TOKEN` | 토큰 없음 | `.env`에 `DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN` 입력 |
| `tsc: command not found` | 의존성 미설치 | `bun install` |
| `EADDRINUSE` | 3003 포트 사용 중 | `WEB_PORT` 변경 또는 기존 프로세스 종료 |

### 명령어가 채널에 안 보인다

1. **Message Content Intent** 확인 (Developer Portal → Bot)
2. **Privileged Intent 재승인** 필요 — 봇 권한 변경 후 서버에서 다시 초대해야 적용됨
3. `!sync` 실행 (관리자 권한)
4. 전파 지연 최대 1시간 대기
5. `DISCORD_GUILD_ID`를 설정했다면, 봇이 **그 서버에 실제로 있는지** 확인

### "아직 준비 중이에요"가 계속 나온다

백필이 끝나지 않은 것입니다. 봇 로그에서 진행 상황을 봅니다.

```text
Backfilling 서버이름 (ID) with 10000 messages in 100-message batches
Backfill progress for 서버이름: 4200/10000
```

느린 사유: `permissionsFor`에서 `ViewChannel`이 없는 채널은 **건너뛰지만**, API 요청은 채널마다 100개씩 순차 발생합니다. 봇이 100개 이상 채널에 있으면 수십 분 걸릴 수 있습니다. 멈췄다면 `Backfill failed for ...` 로그의 원인을 확인하세요.

### "저장된 채팅 기록이 없어요"

- 백필 완료 전입니다
- 봇에 **Read Message History** 권한이 없거나, Private 채널 접근 권한이 없어 수집된 것이 0개일 수 있습니다
- `INCLUDE_BOT_MESSAGES=false`인 상태에서 대상이 봇 메시지뿐일 수 있습니다

### AI 분석이 실패한다

| 로그/메시지 | 해결 |
| --- | --- |
| `GEMINI_API_KEY가 비어 있습니다` | `.env` 또는 설정 화면에서 키 저장 |
| `XXX_API_KEY가 비어 있습니다` | 해당 provider 키 저장 |
| 폴백 후에도 실패 | 폴백 provider 키도 없는지 확인. 설정 화면의 Playground에서 키 유무를 미리 볼 수 있습니다 |
| 429 / rate limit | 무료 티어 한도. 다른 provider로 바꾸거나 `HISTORY_MESSAGE_LIMIT`을 줄여서 재시도 |
| 빈 응답 2회 | OpenAI 호환 경로가 빈 응답을 2번 시도한 뒤 빈 문구를 돌려줍니다. 해당 provider 로그의 `bodyPreview` 확인 |

> **API 키 오입력 방어**: `opencodeZenBaseUrl`만 비어 있으면 호출을 막고, 다른 base URL은 비어 있으면 SDK 기본값으로 떨어집니다.

### 통화량/친밀도가 이상하다

- **0으로 표시됨** → 봇을 재시작했거나, 그 시점 이후 데이터만 있습니다. 음성 추적은 봇 실행 중에만 동작합니다.
- **계속 0** → **Voice State Intent** 누락, 또는 유저가 Stage 채널(비음성)이나 임시 채널에 있었을 수 있습니다
- **한글이 깨져 표시됨** → 봇 역할이 해당 유저보다 낮아 닉네임을 못 읽거나, 서버가 봇 닉네임을 못 노출하는 경우입니다

### 룰렛이 동작하지 않는다

| 메시지 | 원인 |
| --- | --- |
| "먼저 `/타겟`의 인자를 `지정`으로…" | 타겟 역할 미설정 |
| "ㅋ 역할도 없네 그지다" | 실행자가 타겟 역할 미보유 |
| "음성 파일이 설정되지 않았습니다" | `audio/` 비어 있거나 경로 오류 |
| "타겟 역할이 봇 역할보다 높거나 관리되는 역할입니다" | 봇 최고 역할보다 높거나 통합 역할 |
| "봇에게 대상 음성 채널의 연결 및 말하기 권한이 필요합니다" | 음성 채널 권한 누락 |
| "통화방에 관리자가 없습니다" | 대상 풀에 해당하는 사람이 통화방에 없음 |

### 웹 화면이 열리지 않는다

- `Settings UI listening on ...` 로그가 없으면 기동 실패
- `WEB_HOST=0.0.0.0`은 모든 인터페이스에 바인딩하므로 방화벽이 막을 수 있습니다
- Docker에서 `ports`가 `0.0.0.0:3003:3003`이므로 호스트 방화벽 설정이 필요할 수 있습니다
- **`API key`가 "비어 있음"으로 표시되는데 실제론 설정한 경우** — 이 경우 반대입니다. `GET /api/settings`의 `has*ApiKey` 불리언만 확인하므로 값이 틀었다면 여기서 드러나지 않습니다.

### 디버그로 프롬프트를 보고 싶다

채널에 `!debug on`을 보냅니다(봇 계정이 아니라 **메시지를 보낸 사람** 기준). 다음 AI 명령부터 `llm-prompt-debug.txt` 첨부가 따라옵니다. 확인 후 반드시 `!debug off`.

---

## 라이선스 및 사용 범위

이 프로젝트는 **Discord 서버 내부에서 운영자 취향으로 구동하는 사내/커뮤니티용 봇**입니다.

- AI 분석 결과는 오락용이며 사실 검증이나 진단 결과가 아닙니다
- 룰렛은 말레이즈한 서버 내 질의입니다. 실제 징계·처벌 도구가 아닙니다
- 개인정보를 최소한으로 수집하도록 설계되어 있으나, `command_logs`에 질문·답변이, `discord_messages`에 대화 내용이 저장됩니다. 서버 참가자에게 수집 사실을 고지하세요
