# Giinii Board Discord Bot

Discord 서버별 활동 통계, 추억 카드, 관리자 러시안 룰렛, 대화 기반 AI 분석을 제공하는 Bun 기반 Discord 봇입니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 활동 통계 | 일반 채팅 수와 음성 채널 체류 시간을 일·주·월·전체 단위로 저장합니다. |
| 추억 만들기 | 이벤트를 열고 여러 사용자의 소감과 이미지를 모아 여러 장의 세로 카드로 저장합니다. |
| 관리자 러시안 룰렛 | 타겟 역할을 가진 실행자가 음성 채널의 관리자 중 한 명을 무작위로 지목합니다. |
| AI 대화 분석 | `/question`, `/mbti`, `/결투`, `/계급`, `/싸이코지수`, `/별명`, `/흑역사`, `/요약`, `/캐릭터`를 제공합니다. |
| 설정 웹 UI | `WEB_PORT`에서 provider, 모델, 프롬프트, 기록 범위와 API key를 런타임에 관리합니다. |

## 기술 스택

- [Bun](https://bun.sh/): 실행 환경, 패키지 관리, 테스트
- TypeScript: `strict` 모드
- `discord.js`: Discord Gateway와 Slash Command 처리
- `bun:sqlite`: 서버별 데이터 저장
- `@napi-rs/canvas`: 한글이 포함된 PNG 카드 렌더링
- `@discordjs/voice`: 음성 채널 연결과 룰렛 음성 재생
- `@google/genai`와 `fetch`: Gemini 및 OpenAI 호환 provider 호출
- `Bun.serve`: AI 설정 웹 UI
- `ffmpeg`: Docker 이미지에 포함된 음성 처리 도구

## 빠른 시작

### 사전 요구사항

- Bun 1.3 이상
- Discord 봇 애플리케이션과 봇 토큰
- 로컬에서 OGG 외의 음성 파일을 사용할 경우 `ffmpeg`

### 설치 및 실행

```sh
cp .env.example .env
bun install
bun run check
bun test
bun run start
```

`.env`의 `DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN`을 실제 봇 토큰으로 바꿔야 합니다. 두 값이 모두 있으면 `DISCORD_BOT_TOKEN`을 사용합니다. AI 명령을 사용하려면 선택한 provider의 API key도 넣으세요. 데이터베이스 부모 디렉터리는 실행 시 자동으로 생성됩니다.

실행 후 설정 화면은 [http://localhost:3003](http://localhost:3003)에서 열 수 있습니다.

개발 중에는 파일 변경 시 자동 재시작되는 명령을 사용할 수 있습니다.

```sh
bun run dev
```

### Docker Compose

`.env`에 토큰을 입력한 뒤 실행합니다.

```sh
docker compose up -d --build
docker compose logs -f bot
```

Compose는 호스트의 `./data`를 컨테이너의 `/app/data`에 연결하고, 컨테이너를 자동 재시작하도록 설정합니다.
설정 화면은 호스트의 3003번 포트로 노출됩니다.

```sh
docker compose down
docker compose up -d
```

`docker compose down`은 볼륨을 삭제하지 않으므로 `data/`의 SQLite 데이터는 남아 있습니다. 데이터까지 삭제하는 명령은 실행하지 마세요.

## Discord 설정

### Developer Portal Intents

Developer Portal의 Bot 설정에서 다음 Intent를 활성화해야 합니다.

| Intent | 용도 |
| --- | --- |
| `Guilds` | 서버와 Slash Command 처리 |
| `Guild Messages` | 채팅 활동 기록과 `!sync` 처리 |
| `Guild Voice States` | 음성 체류 시간과 룰렛 대상 확인 |
| `Message Content` | `!sync` 메시지 명령과 일반 메시지 내용 확인 |

### 봇 권한

초대 시 다음 권한을 부여하는 것을 권장합니다.

- View Channels
- Send Messages
- Attach Files
- Manage Roles
- Connect
- Speak
- Move Members

역할을 지급하거나 제거하려면 봇의 최고 역할이 대상 역할보다 높아야 합니다. `@everyone`, 관리되는 역할, 봇보다 높거나 같은 역할은 룰렛 타겟 역할로 사용할 수 없습니다.

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | 조건부 | 없음 | 기존 대상 봇 토큰입니다. `DISCORD_BOT_TOKEN`이 없을 때 사용합니다. |
| `DISCORD_BOT_TOKEN` | 조건부 | 없음 | 통합한 brand_new 봇 토큰입니다. 설정하면 우선 사용합니다. |
| `DISCORD_GUILD_ID` | 아니오 | 전체 서버 | 지정하면 해당 서버에만 명령어를 등록하고 백필합니다. |
| `DATABASE_PATH` | 아니오 | `./data/bot.sqlite` | SQLite 데이터베이스 파일 경로입니다. |
| `VOICE_AUDIO_PATH` | 아니오 | `./audio/roulette.ogg` | 룰렛 음성 후보 중 첫 번째 파일입니다. |
| `AI_PROVIDER` | 아니오 | `gemini` | `gemini`, `opencode_zen`, `nvidia_nim`, `openrouter`, `bynara` 중 하나입니다. |
| `AI_MODEL` | 아니오 | provider별 기본 모델 | 웹 UI에서 provider별 모델을 고를 수 있습니다. |
| `GEMINI_API_KEY` 등 | AI 사용 시 | 없음 | 선택한 provider의 API key입니다. 자세한 목록은 `.env.example`을 참고하세요. |
| `HISTORY_MESSAGE_LIMIT` | 아니오 | `10000` | 분석에 사용할 최근 메시지 수입니다. |
| `MAX_CONTEXT_CHARS` | 아니오 | `160000` | AI prompt에 넣을 최대 문자 수입니다. |
| `INCLUDE_BOT_MESSAGES` | 아니오 | `false` | AI 기록에 봇 메시지도 포함할지 정합니다. |
| `QUESTION_COOLDOWN_SECONDS` | 아니오 | `20` | 사용자별 AI 명령 재사용 대기 시간입니다. |
| `WEB_HOST`, `WEB_PORT` | 아니오 | `0.0.0.0`, `3003` | 설정 UI의 바인딩 주소와 포트입니다. |

룰렛은 `VOICE_AUDIO_PATH`에 지정한 파일과 다음 기본 후보 중 실제로 존재하는 파일을 무작위로 선택합니다.

```text
VOICE_AUDIO_PATH 또는 ./audio/roulette.ogg
./audio/roulette-2.ogg
./audio/roulette-3.ogg
```

Docker 안에서 다른 음성을 지정하려면 컨테이너 기준 경로를 사용해야 합니다. 예를 들어 이미지에 포함된 파일은 `/app/audio/custom.ogg`처럼 지정합니다.

## 명령어 등록

봇이 로그인하면 현재 봇이 들어가 있는 각 서버에 코드의 Slash Command 목록을 등록합니다. 명령어를 추가·수정한 뒤 반영되지 않으면 해당 서버에서 관리자 권한으로 다음 메시지를 한 번 보냅니다.

```text
!sync
```

`!sync`는 현재 캐시된 서버들에 Slash Command 목록을 다시 등록합니다. 메시지를 보낸 서버가 봇이 실제로 들어가 있는 서버인지, `Message Content` Intent가 켜져 있는지 확인하세요.

## 사용자 명령어

### 추억 카드

| 명령어 또는 버튼 | 옵션 | 동작 |
| --- | --- | --- |
| `/추억만들기시작` | `이벤트` 필수, 1~100자 | 서버에서 추억 만들기를 시작하고 `소감 쓰기` 버튼을 게시합니다. 서버당 한 개만 진행할 수 있습니다. |
| `소감 쓰기` | 소감 1~1,000자, 이미지 선택 1개 | 모달에서 소감과 선택 이미지를 제출합니다. 제출한 사람의 표시 이름과 아바타도 카드에 사용됩니다. |
| `/추억만들기종료` | 없음 | 진행 중인 추억을 종료하고 소감들을 세로 PNG 카드로 만들어 게시합니다. 긴 내용은 여러 페이지로 나뉩니다. |
| `/추억조회` | `번호` 선택 | 번호를 생략하면 가장 최근에 저장된 추억을 조회합니다. 번호를 지정하면 해당 추억을 다시 게시합니다. |

추억은 종료 시점의 이미지 경로를 데이터베이스에 기록합니다. 이전 버전에서 이미지가 아직 생성되지 않은 추억은 조회 시 다시 렌더링합니다.

## 관리자 명령어

| 명령어 | 옵션 | 동작 |
| --- | --- | --- |
| `/타겟역할설정` | `역할` 필수 | 룰렛 실행자에게서 제거할 역할을 지정합니다. |
| `/관리자역할추가` | `역할` 필수 | 해당 역할을 가진 멤버를 룰렛 대상 관리자 목록에 추가합니다. |
| `/관리자머리끄댕이` | 없음 | 룰렛을 실행합니다. 실행자에게 타겟 역할이 있어야 합니다. |

`/관리자머리끄댕이`의 동작 순서는 다음과 같습니다.

1. 실행자에게 타겟 역할이 있는지 확인합니다.
2. 타겟 역할을 실행자에게서 제거합니다.
3. 음성 채널에 있는 Discord 관리자 또는 관리자 타겟 역할 보유자 중 한 명을 고릅니다.
4. `3`, `2`, `1` 카운트다운과 당첨 메시지를 보냅니다.
5. 음성 후보 파일 중 하나를 재생하고 선택된 사용자를 음성 채널에서 내보냅니다.

실행자에게 약 5% 확률로 당첨되는 예외가 있으며, 이 경우 실행자가 음성 채널에 있어야 합니다. 음성 채널에 대상 관리자가 없거나 음성 파일이 하나도 없으면 룰렛을 시작하지 않습니다. 한 서버에서 동시에 두 번 실행할 수 없습니다.

## 데이터 저장과 백업

기본 데이터 위치는 다음과 같습니다.

```text
data/
├── bot.sqlite       # SQLite 본체
├── bot.sqlite-shm   # WAL 모드 보조 파일
├── bot.sqlite-wal   # WAL 모드 로그 파일
└── memories/        # 추억 원본 이미지와 생성된 카드
```

`DATABASE_PATH`를 지정하면 추억 파일은 데이터베이스 파일의 부모 디렉터리 아래 `memories/<추억번호>/`에 저장됩니다.

주요 테이블은 다음과 같습니다.

| 테이블 | 내용 |
| --- | --- |
| `users` | 서버별 사용자와 누적 채팅·음성 시간 |
| `activity` | 일·주·월·전체 단위의 채팅 수와 음성 시간 |
| `settings` | 룰렛 타겟 역할 |
| `voice_sessions` | 재시작 이후 현재 음성 세션과 마지막 정산 시각 |
| `admin_target_roles` | 룰렛 대상 관리자 역할 목록 |
| `memories` | 추억 이벤트와 생성된 카드 경로 |
| `memory_entries` | 추억별 소감과 첨부 이미지 경로 |
| `discord_messages` | AI 분석용 Discord 메시지 백필·실시간 기록 |
| `command_logs` | AI 명령, provider, 모델, 응답 기록 |

시작 시 필요한 테이블을 자동 생성하고 일부 이전 버전 컬럼을 보정합니다. 스키마가 변경된 뒤에는 기존 데이터와의 호환성을 확인한 후 배포하세요.

### 백업

봇을 중지한 뒤 SQLite 파일과 추억 이미지를 함께 복사합니다.

```sh
docker compose stop bot
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
```

로컬 실행 중이라면 `bun run start` 프로세스를 먼저 종료하세요. WAL 모드에서는 `.sqlite` 파일만 실행 중에 복사하지 말고 `-shm`, `-wal` 파일까지 함께 보관하거나 봇을 중지한 뒤 백업해야 합니다.

복구할 때는 봇을 중지하고 `data/` 전체를 백업본으로 교체한 뒤 다시 시작합니다. 데이터베이스와 `data/memories/`가 서로 다른 백업 시점이면 추억 이미지가 누락될 수 있습니다.

## 동작 원리

```text
Discord 메시지 ──> messageCreate ──> activity/discord_messages 기록
Discord 음성 변경 ─> voiceStateUpdate/60초 정산 ─> activity 테이블 기록
AI 명령 ──────────> history 조회 ──> provider 호출 ──> Embed 응답/command_logs 기록
기타 Slash Command ─> interactionCreate ─> SQLite 조회·변경 ─> PNG/음성/응답 전송
```

- 봇 메시지는 활동 통계에서 제외합니다.
- 일반 메시지는 한 건당 채팅 활동 1회로 기록합니다. `!sync` 메시지는 명령어 등록에 사용하고 활동으로 기록하지 않습니다.
- 음성 시간은 60초 간격과 음성 채널 이동·퇴장 시점에 정산합니다.
- 봇 재시작 중의 음성 시간은 기록하지 않습니다. 재시작 후 현재 음성 채널에 있는 사람부터 새 세션을 시작합니다.
- 날짜·주차·월 통계와 추억 표시 시간은 `Asia/Seoul` 기준입니다.
- SQLite는 WAL 모드로 동작합니다.

## 프로젝트 구조

```text
.
├── src/
│   ├── index.ts                         # 봇 시작과 이벤트 연결
│   ├── activity.ts                      # 채팅·음성 활동 집계
│   ├── memories.ts                      # 추억 카드 명령·버튼·모달
│   ├── roulette.ts                      # 관리자 러시안 룰렛
│   ├── analysis.ts                      # AI 명령·백필·provider 흐름
│   ├── history.ts                       # Discord 기록 수집·prompt 포맷
│   ├── storage.ts                       # SQLite 스키마와 공통 저장소
│   ├── config.ts, models.ts             # 환경변수·모델·프롬프트 설정
│   ├── web.ts, settings-page.ts         # 설정 API와 웹 화면
│   ├── leaderboard.ts                   # 추억 PNG 렌더러
│   └── assets/GowunDodum-Regular.ttf    # PNG 카드용 한글 폰트
├── audio/                               # 룰렛 음성 후보
├── test/                                # 렌더링 및 레벨 계산 테스트
├── data/                                # 실행 중 생성되는 DB와 추억 파일
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

기능을 추가할 때는 다음 위치를 먼저 확인하세요.

- Slash Command 추가: `src/commands.ts`와 해당 기능 모듈의 분기
- 버튼·모달 추가: `interactionCreate` 이벤트와 관련 핸들러
- 이미지 응답 추가: `src/leaderboard.ts`의 렌더러와 `test/leaderboard.test.ts`
- 데이터 변경: SQLite 초기화 SQL과 기존 DB 보정 로직

## 테스트와 유지보수

```sh
bun run check       # TypeScript 타입 검사
bun test            # PNG 렌더링·레벨 계산 테스트
git diff --check    # 공백 오류 확인
```

이미지 테스트는 반환된 버퍼가 PNG인지 확인하고, 추억 테스트는 긴 카드가 여러 페이지로 분할되는지 확인합니다.

새 기능을 수정한 뒤에는 최소한 `bun run check`, `bun test`, `git diff --check`를 순서대로 실행하세요. 토큰과 `.env`, 운영 데이터베이스는 커밋하지 않습니다.

## 문제 해결

### Slash Command가 보이지 않음

봇이 해당 서버에 있는지 확인한 뒤 관리자 권한으로 `!sync`를 실행합니다. 그래도 동작하지 않으면 `Guilds` Intent, `applications.commands` 초대 스코프, 콘솔의 로그인·동기화 오류를 확인합니다.

### 룰렛 역할 제거 실패

봇의 최고 역할을 대상 역할보다 위로 올리고 `Manage Roles` 권한을 확인합니다. 관리되는 역할과 `@everyone` 역할은 사용할 수 없습니다.

### 음성 룰렛이 실패함

음성 파일 경로가 실제로 존재하는지, `Connect`, `Speak`, `Move Members` 권한이 있는지 확인합니다. 대상 관리자가 음성 채널에 있어야 하며, 비-OGG 파일을 로컬에서 사용할 때는 `ffmpeg`도 설치해야 합니다.

### 봇이 시작되지 않음

`DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN`이 `.env`에 있고, `bun install`이 완료되었는지 확인합니다. AI 명령 오류는 선택 provider의 API key와 `AI_MODEL`을 확인하세요. `DATABASE_PATH`를 지정했다면 해당 경로의 부모 디렉터리에 쓰기 권한이 있어야 합니다.
