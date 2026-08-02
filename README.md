# Giinii Board Discord Bot

Bun과 TypeScript로 만든 Discord 봇입니다. 서버의 채팅·음성 활동을 SQLite에 저장하고, 최근 대화 기반 AI 분석과 관리자 러시안 룰렛을 제공합니다.

## 기능

- 채팅 수와 음성 체류 시간을 일·주·월·전체 단위로 저장
- Discord 메시지 백필 및 실시간 저장
- 최근 대화를 바탕으로 한 AI 분석
- 관리자 러시안 룰렛과 음성 재생
- 유저별 음성 채널 동시 접속 시간 기반 친밀도 카드
- 브라우저에서 AI provider, 모델, 프롬프트, 기록 범위를 바꾸는 설정 화면

분석 결과는 오락용입니다. MBTI, 싸이코 지수, 계급 등은 실제 진단이나 사실 판정이 아닙니다.

## 요구 사항

- Bun 1.3 이상
- Discord 애플리케이션과 봇 토큰
- AI 분석을 사용할 경우 지원 provider의 API key
- 음성 파일이 OGG/Opus가 아니라면 ffmpeg

Docker를 사용하면 Bun과 ffmpeg를 따로 설치하지 않아도 됩니다.

## 시작하기

```sh
cp .env.example .env
bun install
bun run check
bun test
bun run start
```

`.env`에 `DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN`을 입력합니다. 둘 다 있으면 `DISCORD_BOT_TOKEN`을 사용합니다.

설정 화면은 기본적으로 [http://localhost:3003](http://localhost:3003)에서 열립니다. 인증 기능이 없으므로 인터넷에 직접 노출하지 마세요.

개발 중에는 다음 명령으로 파일 변경 시 자동 재시작할 수 있습니다.

```sh
bun run dev
```

### Docker Compose

```sh
cp .env.example .env
# .env에 DISCORD_BOT_TOKEN과 사용할 AI API key 입력
docker compose up -d --build
docker compose logs -f bot
```

Compose는 `./data`를 `/app/data`에 연결하고, 설정 화면의 3003 포트를 공개합니다.

```sh
docker compose down
```

위 명령은 `data/`를 삭제하지 않습니다.

## Discord 설정

Developer Portal의 Bot 설정에서 다음 Privileged Gateway Intents를 켭니다.

- Server Members Intent가 필요한 기능을 사용하는 경우 해당 Intent
- Message Content Intent

봇 초대 시 최소한 다음 권한이 필요합니다.

- View Channels
- Send Messages
- Read Message History
- Attach Files
- Connect
- Speak
- Move Members
- Manage Roles

봇을 실행하면 현재 봇이 들어간 서버에 Slash Command를 등록합니다. `DISCORD_GUILD_ID`를 지정하면 해당 서버만 대상으로 합니다.

명령어가 보이지 않으면 관리자 권한으로 메시지 채널에 다음을 보냅니다.

```text
!sync
```

## Slash Command

### AI 분석

| 명령어 | 옵션 | 설명 |
| --- | --- | --- |
| `/question` | `question`, `limit`, `channels` | 최근 대화에 질문합니다. `limit` 최대값은 10,000입니다. |
| `/mbti` | `user` | 대화 패턴으로 MBTI를 오락용 추정합니다. |
| `/결투` | `user1`, `user2` | 두 유저의 말싸움/드립 배틀 승자를 예측합니다. |
| `/계급` | 없음 | 서버 대화 속 관계와 영향력을 오락용 계급도로 분석합니다. |
| `/싸이코지수` | `user` | 혼돈·예측불가 정도를 1~100점으로 표현합니다. |
| `/별명` | `user` | 대화 패턴 기반 별명을 제안합니다. |
| `/흑역사` | `user` | 가벼운 대화 패턴과 드립 실패를 찾아줍니다. |
| `/요약` | 없음 | 최근 서버 대화의 사건과 분위기를 요약합니다. |
| `/캐릭터` | `user` | 대화 패턴 기반 RPG 캐릭터 시트를 만듭니다. |

AI 명령은 서버별로 한 번에 하나만 실행되며, 사용자별 재사용 대기 시간은 `QUESTION_COOLDOWN_SECONDS`로 정합니다. 처음 실행할 때 최근 메시지를 SQLite에 백필하므로 완료 전에는 분석을 실행할 수 없습니다.

### 음성 친밀도

| 명령어 | 옵션 | 설명 |
| --- | --- | --- |
| `/친밀도` | `유저` | 같은 음성 채널에 함께 있었던 시간 기준 TOP 21을 PNG 카드로 확인합니다. 7명씩 이전/다음 페이지를 볼 수 있습니다. |

### 관리자 러시안 룰렛

| 명령어 | 권한 | 설명 |
| --- | --- | --- |
| `/타겟역할설정` | 관리자 | 실행자에게서 제거할 역할을 설정합니다. |
| `/관리자역할추가` | 관리자 | 룰렛 대상이 될 관리자 역할을 추가합니다. |
| `/관리자머리끄댕이` | 타겟 역할 보유자 | 음성 채널의 대상 중 한 명을 선택하고 음성으로 알립니다. |

룰렛을 사용하려면 음성 파일이 하나 이상 있어야 합니다. 봇의 최고 역할은 제거 대상 역할보다 높아야 하며, 관리되는 역할과 `@everyone`은 사용할 수 없습니다.

일반 메시지에서 사용할 수 있는 운영 명령은 다음과 같습니다.

```text
!sync       # Slash Command 다시 등록
!debug on   # 현재 서버에서 AI 호출 전 prompt 파일 첨부
!debug off  # 디버그 모드 해제
```

## 환경변수

`.env.example`에 실행에 필요한 기본 목록이 있습니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | 없음 | 봇 토큰. `DISCORD_TOKEN`도 지원하며 전자가 우선합니다. |
| `DISCORD_TOKEN` | 없음 | 기존 토큰 이름입니다. |
| `DISCORD_GUILD_ID` | 전체 서버 | 지정한 서버에만 명령어를 등록합니다. |
| `DATABASE_PATH` | `./data/bot.sqlite` | SQLite 파일 경로입니다. |
| `VOICE_AUDIO_PATH` | `./audio/roulette.ogg` | 룰렛 음성 후보의 첫 번째 파일입니다. |
| `AI_PROVIDER` | `gemini` | `gemini`, `opencode_zen`, `nvidia_nim`, `openrouter`, `bynara` 중 하나입니다. |
| `AI_MODEL` | provider별 기본 모델 | 사용할 모델 ID입니다. |
| `HISTORY_MESSAGE_LIMIT` | `10000` | AI 분석에 사용할 최근 메시지 수입니다. |
| `MAX_CONTEXT_CHARS` | `160000` | AI prompt에 넣을 최대 문자 수입니다. |
| `INCLUDE_BOT_MESSAGES` | `false` | AI 기록에 봇 메시지를 포함합니다. |
| `QUESTION_COOLDOWN_SECONDS` | `20` | 사용자별 AI 명령 대기 시간입니다. |
| `WEB_HOST` | `0.0.0.0` | 설정 화면 바인딩 주소입니다. |
| `WEB_PORT` | `3003` | 설정 화면 포트입니다. |

### AI API key와 endpoint

선택한 provider의 key만 필요합니다. OpenAI 호환 provider는 기본 endpoint를 사용하며, 필요하면 endpoint도 바꿀 수 있습니다.

| Provider | API key | Base URL 변수 |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | 없음 |
| OpenCode Zen | `OPENCODE_ZEN_API_KEY` | `OPENCODE_ZEN_BASE_URL` |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `NVIDIA_NIM_BASE_URL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` |
| Bynara | `BYNARA_API_KEY` | `BYNARA_BASE_URL` |

프롬프트는 `COMMON_PROMPT`, `QUESTION_PROMPT`, `MBTI_PROMPT`, `DUEL_PROMPT`, `RANK_PROMPT`, `PSYCHO_PROMPT`, `NICKNAME_PROMPT`, `THROWBACK_PROMPT`, `SUMMARY_PROMPT`, `CHARACTER_PROMPT`로 덮어쓸 수 있습니다. 설정 화면에서 저장한 값은 `.env`에 기록됩니다.

## 데이터

기본적으로 다음 파일이 생성됩니다.

```text
data/
├── bot.sqlite
├── bot.sqlite-shm
└── bot.sqlite-wal
```

주요 데이터는 다음과 같습니다.

- `users`, `activity`: 서버별 채팅·음성 누적 및 기간별 통계
- `voice_sessions`: 현재 음성 세션
- `voice_presence_sessions`: 음성 채널별 동시 접속 시간 이력
- `discord_messages`: AI 분석용 Discord 메시지
- `command_logs`: AI 명령 실행 결과
- `settings`, `admin_target_roles`: 룰렛 설정

SQLite는 WAL 모드로 동작합니다. 백업할 때는 봇을 먼저 중지하고 `data/` 전체를 복사합니다.

```sh
docker compose stop bot
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
```

실행 중인 SQLite 파일을 `.sqlite` 하나만 복사하면 WAL 데이터가 빠질 수 있습니다.

## 프로젝트 구조

```text
src/
├── index.ts          # Discord 로그인과 이벤트 연결
├── commands.ts       # Slash Command 정의와 동기화
├── analysis.ts       # AI 명령, 백필, prompt 처리
├── history.ts        # Discord 기록 수집
├── gemini.ts         # Gemini/OpenAI 호환 provider 호출
├── activity.ts       # 채팅·음성 활동 집계
├── voice-affinity.ts  # 음성 동시 접속 시간 계산
├── voice-affinity-command.ts # 친밀도 명령과 페이지 버튼
├── voice-affinity-card.ts # 친밀도 PNG 카드 렌더링
├── roulette.ts       # 관리자 러시안 룰렛
├── storage.ts        # SQLite 스키마와 쿼리
├── config.ts         # 환경변수와 런타임 설정
├── web.ts            # 설정 API
└── settings-page.ts  # 설정 화면
```

## 검증

```sh
bun run check
bun test
git diff --check
```

`bun test`는 AI 응답 분할과 PNG 카드 렌더링을 확인합니다.
