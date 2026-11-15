# 기니봇

디스코드 서버의 채팅과 음성 활동을 기록하고, 그 기록으로 통계 카드와 관리자 러시안 룰렛을 제공하는 봇입니다. 여기에 `기니봇아`로 부르면 대답하는 대화 기능이 함께 들어 있습니다.

Bun + TypeScript로만 작성했고, 외부 서버 없이 `bun:sqlite` 하나와 Discord Gateway, 선택형 OpenRouter·Exa API만 사용합니다. 웹 대시보드는 없습니다. 모든 설정은 `.env`와 채팅 명령으로 끝납니다.

> **오락용 고지**
> 룰렛과 대화의 결과는 재미를 위한 생성물입니다. 실제 진단이나 사실 검증 결과가 아니며, 망신이나 괴롭힘을 부추기는 용도로 설계되지 않았습니다.

## 기능

| 영역 | 내용 |
| --- | --- |
| 기록 | 메시지를 실시간 저장하고, 기동할 때 읽을 수 있는 전체 기록을 백필합니다. 이미 저장된 구간은 건너뜁니다. |
| 부가 정보 | 리액션, 임베드, 답글, 스레드, 멘션과 원본 JSON을 함께 저장합니다. |
| 미디어 | 첨부 사진·영상·음성·스티커·아바타를 `data/media`에 내려받습니다. |
| 프로필 이력 | 닉네임·아바타·배너가 바뀔 때마다 한 줄씩 쌓습니다. |
| 활동 집계 | 메시지 수는 DB에서 미리 계산하고, 음성 체류 시간은 일·주·월·전체 버킷으로 누적합니다. 기준시는 KST입니다. |
| 음성 통계 | `/친밀도`, `/통화량`, `/통계`, `/친밀도그래프`가 너비 2400px PNG 카드를 만듭니다. |
| 룰렛 | 관리자 대상 가위바위보. 방어권 역할, 65% 판정, 음성 재생을 지원합니다. |
| 대화 | `기니봇아` 호출, 멘션, 봇 메시지 답장에 답합니다. 성격은 `SOUL.md`, 판단은 `src/mind/`, 기억은 서버 SQLite에 있습니다. |
| 데이터 | `bun:sqlite`, 서버마다 파일 하나(`data/guilds/<서버ID>.sqlite`), WAL 모드. |

## 요구 사항

| 항목 | 버전 | 비고 |
| --- | --- | --- |
| Bun | 1.3 이상 | `bun:sqlite`, 내장 테스트 러너를 사용합니다. |
| Discord 봇 토큰 | — | Developer Portal에서 발급합니다. |
| ffmpeg | 선택 | 룰렛 음성이나 OGG가 아닌 음성 파일을 다룰 때 필요합니다. |
| OpenRouter 키 | 대화에 필요 | 없으면 기록·통계·룰렛만 동작합니다. |
| Exa 키 | 선택 | 넣으면 대화에서 웹 검색을 씁니다. |

## 빠른 시작

```sh
cp .env.example .env
# .env에 DISCORD_TOKEN을 넣습니다.

bun install
bun run check
bun test
bun run start
```

기동 로그가 아래처럼 나오면 정상입니다.

```text
Logged in as GiiniiBot#1234
[chat] '기니봇아' 호출, 멘션, 답장에 답합니다 (전용 서버에서만)
[model] deepseek/deepseek-v4.1-flash-1017 (effort low)
[mind] 켜짐 · perplexity/pplx-decider-v1.3:free
[mind] 하루 900회 / 분당 18회 자체 상한
[search] Exa 켜짐
[soul] SOUL.md (파일)
Backfilling 서버이름 (서버ID): every readable message, 0 channel(s) already saved
Backfill ready for 서버이름: 128400 fetched, 128400 newly saved, 214 channel(s)
```

개발 중에는 `bun run dev`를 씁니다. `bun --watch`가 파일 변경 시 재시작하며, 이미 저장된 구간은 다시 받지 않습니다.

### Docker

```sh
docker compose up -d --build
docker compose logs -f bot
```

이미지에 Bun 1.3.14와 ffmpeg가 들어 있어 별도 설치가 필요 없습니다. `./data`가 `/app/data`에 마운트되고, `data/seed`가 있으면 기동 시 `scripts/restore-db.ts`가 청크를 복원한 뒤 봇을 시작합니다. `data/`는 저장소에 없으므로 새로 받은 저장소는 빈 DB로 시작하고 디스코드 기록을 다시 백필합니다.

## Discord 설정

`src/index.ts`가 선언하는 인텐트는 네 개입니다.

| Intent | 용도 |
| --- | --- |
| `Guilds` | 서버 목록, 음성 어댑터 생성 |
| `GuildMessages` | `MessageCreate` 수신 |
| `GuildVoiceStates` | 음성 세션 추적 |
| `MessageContent` | 메시지 내용 읽기. Developer Portal에서 반드시 켭니다. |

필요 권한은 채널 보기, 메시지 기록 읽기, 메시지 보내기, 파일 첨부, 임베드 링크, 음성 연결, 말하기, 멤버 이동, 역할 관리입니다.

슬래시 명령은 두 범위로 등록됩니다. 음성 명령 4개는 전역이고, 룰렛 4개와 대화 명령 2개는 전용 서버(`1489819911277641952`)에만 등록됩니다. 명령이 안 보이면 서버에서 관리자 권한으로 `!sync`를 보냅니다.

## 명령어

### 슬래시 명령

| 명령 | 범위 | 설명 |
| --- | --- | --- |
| `/친밀도` `유저` | 전역 | 대상 유저와 같은 음성 채널에 함께 있었던 시간 TOP 7 |
| `/통화량` | 전역 | 서버 전체 누적 통화량 TOP 21, 7명씩 페이지 |
| `/통계` | 전역 | 통화량·채팅량·종합 활동량 TOP 7 카드 3장 |
| `/친밀도그래프` | 전역 | 상위 20명의 관계를 FHD 그래프로 표시 |
| `/타겟` | 전용 서버 | 룰렛 실행 시 실행자에게서 제거할 역할 지정·삭제·조회 |
| `/관리자_타겟` | 전용 서버 | 룰렛 대상 pool에 추가할 관리자 역할 |
| `/관리자머리끄댕이` | 전용 서버 | 룰렛 실행 |
| `/model` | 전용 서버 | 대화에 쓸 OpenRouter 모델 변경. 비우면 현재 값 |
| `/reasoning` | 전용 서버 | 추론 정도 변경. `none`부터 `max`까지 |
| `/mind status` | 관리자 | Decision 호출량·회로 상태·실패율 |
| `/memory list` | 본인 | 내 기억 목록 |
| `/memory delete id` | 본인 | 내 기억 하나 삭제 |
| `/memory clear confirm` | 본인 | 내 기억과 관계 추정값 전체 삭제 |

룰렛과 대화 명령은 전용 서버에서만 실행됩니다. 서버별 on/off는 `!서버별명령어`로 관리하며, 꺼 둔 명령을 누르면 누른 본인에게만 안내가 뜹니다.

### 메시지 명령

| 명령 | 권한 | 설명 |
| --- | --- | --- |
| `!sync` | ADMIN_USER_ID | 전역·서버별 슬래시 명령 등록을 다시 맞춥니다. |
| `!서버목록` | ADMIN_USER_ID | 봇이 올라간 서버의 이름·ID·기록 수를 보여줍니다. |
| `!서버별명령어` | ADMIN_USER_ID | 서버별 슬래시 명령 허용 상태를 보여줍니다. |
| `!서버별명령어 [서버] enable\|disable [명령]` | ADMIN_USER_ID | 해당 서버에서 명령을 켜거나 끕니다. |
| `!도움` | ADMIN_USER_ID | 사용법을 보여줍니다. |

메시지 명령은 모두 코드에 지정된 단일 유저(`ADMIN_USER_ID`)만 실행할 수 있습니다.

## 음성 통계

`VoiceStateUpdate`와 60초 정산 루프로 음성 채널 체류 시간을 누적합니다. KST 자정을 넘으면 세션을 쪼개 기록하고, 채널을 옮기면 새 구간을 시작합니다. 재시작 시 진행 중이던 세션은 현재 시각으로 닫고, 실제로 접속 중인 사람만 새 세션으로 다시 엽니다.

친밀도는 같은 채널 구간의 교집합으로 계산합니다. 뮤트 상태와 무관한 전체 체류 시간이며, 실제 발화 시간은 아닙니다. 상위 21명까지 카드로 표시합니다.

## 관리자 러시안 룰렛

통화방에 있는 관리자 중 한 명을 무작위로 뽑아 음성으로 지목하고 채널에서 내보냅니다. 실행 전에 `/타겟`으로 대상 역할을 정해야 하며, 실행자의 그 역할은 룰렛 시작과 함께 제거됩니다. 방어권 역할 보유자는 65% 확률로 면제됩니다. 자세한 판정 순서는 `src/roulette.ts`에 있습니다.

## 기니봇아 대화

전용 서버에서만 동작합니다.

| 호출 | 예 | 처리 |
| --- | --- | --- |
| 접두사 | `기니봇아 오늘 뭐 먹지?` | 접두사 뒤 문장으로 답합니다. |
| 멘션 | `@기니봇 이거 봐줘` | 멘션을 지운 문장으로 답합니다. |
| 답장 | 봇 메시지에 답장 | 답장 내용으로 답합니다. |

- 접두사는 문장 맨 앞에 있어야 합니다. `기니봇아님`은 호출로 보지 않습니다.
- 호출만 하고 내용이 없으면 무엇을 할지 묻습니다.
- 채널마다 최근 메시지 10개를 메모리에 들고 문맥으로 씁니다. 재시작하면 비워집니다.
- 성격과 말투는 `SOUL.md`에서 읽습니다. 메시지마다 다시 읽으므로 저장하면 다음 답변부터 반영됩니다.
- 모델은 `/model`, 추론 정도는 `/reasoning`으로 바꿉니다. 바꾼 값은 프로세스가 살아있는 동안만 유지됩니다.
- `EXA_API_KEY`가 있으면 최신 정보가 필요하다고 판단될 때 답변 전에 한 번 검색합니다.

### 판단과 기억

한 번의 호출은 아래 순서로 처리됩니다. 생성형 LLM은 마지막에 한 번만 부릅니다.

1. 최근 대화·감정·관계·기억 후보를 SQLite에서 읽습니다.
2. Decision 모델에 한 요청으로 판단을 묻습니다. 의도, 사회적 상황, 감정 영향, 관계 신호, 행동, 검색 필요성, 기억 관련성을 함께 묻습니다.
3. 첫 판단이 흔들리면 같은 모델에 한 번 더 집중 질문을 보냅니다. 트리거당 최대 2회입니다.
4. TypeScript가 경계·감정·관계를 확인해 행동을 확정합니다.
5. 명시적인 기억 작업만 실제로 반영합니다.
6. 필요하면 Exa로 검색합니다.
7. 확정된 행동 지침으로 답변을 한 번 생성합니다.

- 감정은 네 값(긍정·활력·불쾌·호기심)으로 서버마다 저장되고, 반감기에 따라 평소 값으로 돌아갑니다.
- 관계는 사용자별 친숙도·신뢰·장난 선호·명시적 경계로 저장됩니다. "그런 농담 하지 마" 같은 말은 즉시 경계로 남습니다.
- 기억은 `mind_memories`에 사용자 단위로 저장됩니다. 다른 사람의 기억은 검색 단계에서 빠지고 모델에도 전달되지 않습니다.
- 모델은 `<memory>` 태그를 만들지 않습니다. 저장·수정은 Decision의 의도와 TypeScript의 소유권 검증을 함께 통과해야 반영됩니다.
- 기억 삭제는 자연어로 요청해도 실행되지 않습니다. `/memory delete` 또는 `/memory clear` 슬래시 명령으로만 지울 수 있습니다.
- 대상이 애매한 수정은 실행하지 않고 되묻습니다.
- 서버 공용 기억과 `memory.md` 자동 이전은 사용하지 않습니다. 기억은 소유자의 대화에서만 검색됩니다.
- Decision 호출은 하루 900회, 분당 18회로 스스로 제한합니다. 한도나 장애에 걸리면 규칙 기반 판단으로 답하고, 생성형 LLM은 그래도 한 번만 부릅니다.
- `perplexity/pplx-decider-v1.3:free`는 OpenRouter의 무료 Decision 모델입니다. 무료 기간이 끝나면 `MIND_DECISION_MODEL`을 유료 모델로 바꾸거나 자체 호스팅으로 옮겨야 합니다.

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DISCORD_TOKEN` | O | 봇 토큰 |
| `DISCORD_BOT_TOKEN` | X | 있으면 `DISCORD_TOKEN`보다 우선 |
| `DATABASE_PATH` | X | 기본 `./data/bot.sqlite` |
| `MEDIA_PATH` | X | 기본 `DATABASE_PATH` 옆 `media` |
| `MEDIA_MAX_BYTES` | X | 이 크기를 넘는 파일은 건너뜀. 기본 512MB |
| `MEDIA_CONCURRENCY` | X | 동시 다운로드 수. 기본 4 |
| `SKIP_BACKFILL` | X | 백필만 건너뜀. enrich는 계속 |
| `SEED_CHUNK_BYTES` | X | DB 시드 청크 크기. 기본 30MB |
| `SEED_GROWTH_BYTES` | X | 시드 재생성 임계값. 기본 30MB |
| `VOICE_AUDIO_PATH` | X | 룰렛 음성 파일. 기본 `./audio/roulette.ogg` |
| `CHAT_OPENROUTER_API_KEY` | 대화 | 대화용 OpenRouter 키 |
| `OPENROUTER_API_KEY` | X | 위 키가 비었을 때 쓰는 대체 키 |
| `OPENROUTER_BASE_URL` | X | 기본 `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | X | 기본 `deepseek/deepseek-v4.1-flash-1017` |
| `REASONING_EFFORT` | X | 기본 `low` |
| `EXA_API_KEY` | X | 넣으면 대화에서 웹 검색 |
| `AGENTS_PATH` | X | 성격 지침 파일. 기본 `SOUL.md` |
| `MIND_ENABLED` | X | 기본 `true`. `false`면 Decision 호출 없이 규칙 기반으로 판단 |
| `MIND_DECISION_MODEL` | X | 기본 `perplexity/pplx-decider-v1.3:free` |
| `MIND_DECISION_FLASH_MODEL` | X | 기본 `perplexity/pplx-decider-flash-v1.3:free` |
| `MIND_DECISION_API_URL` | X | 기본 `https://openrouter.ai/api/alpha/decisions` |
| `MIND_MAX_DECISIONS_PER_TRIGGER` | X | 1 또는 2. 기본 2 |
| `MIND_DAILY_BUDGET` | X | 하루 자체 상한. 기본 900 (계정 무료 한도 1000) |
| `MIND_MINUTE_BUDGET` | X | 분당 자체 상한. 기본 18 (계정 무료 한도 20) |
| `MIND_DECISION_TIMEOUT_MS` | X | 기본 3000ms. 실측 0.5~1.8초 |
| `MIND_MEMORY_CANDIDATES` | X | 후보 검색 상한. 기본 8 |
| `MIND_MEMORY_SELECTED` | X | 답변에 넣을 기억 상한. 기본 5 |
| `MIND_AUTO_MEMORY` | X | 명시 요청 없는 자동 저장. 기본 `true` |
| `MIND_EMOTION_DECAY_ENABLED` | X | 감정 감쇠. 기본 `true` |
| `MIND_RELATIONSHIP_UPDATE_LIMIT` | X | 상호작용 1회당 관계 변화 상한. 기본 0.03 |
| `MIND_SEARCH_TIMEOUT_MS` | X | 답변 전 검색 제한. 기본 3000ms |
| `MIND_DEBUG` | X | 판단 실패 로그. 기본 `false` |

`DISCORD_TOKEN`이 없으면 `config.ts`를 불러오는 순간 프로세스가 죽습니다. 설정 실수를 조용히 넘기지 않기 위한 의도입니다. `.env`는 Bun이 자동으로 읽습니다.

## 프로젝트 구조

| 파일 | 역할 |
| --- | --- |
| `src/index.ts` | 클라이언트, 이벤트 분기, 시작 |
| `src/config.ts` | 환경변수와 경로 |
| `src/storage.ts` | 서버별 SQLite, 스키마, 쿼리 |
| `src/activity.ts` | 채팅 수 집계, 음성 세션 추적 |
| `src/analysis.ts` | 실시간 저장, 백필, enrich |
| `src/history.ts` | Discord 기록 수집, 프로필·미디어 캡처 |
| `src/records.ts` | 메시지 부가 정보·미디어·프로필 저장 |
| `src/media.ts` | 미디어 다운로드 워커 |
| `src/media-seed.ts` | 미디어 청크 분할·복원 |
| `src/seed.ts` | DB 시드 워커 |
| `src/commands.ts` | 슬래시 명령 정의와 등록 |
| `src/command-rules.ts` | 전용 서버와 서버별 명령 on/off |
| `src/admin-commands.ts` | `!` 관리 명령 |
| `src/roulette.ts` | 관리자 러시안 룰렛 |
| `src/voice-affinity*.ts` | 친밀도 계산과 카드 렌더링 |
| `src/chat/` | 기니봇아 대화, 문맥, 생성 호출, 검색 |
| `src/mind/` | Decision 판단, 감정·관계 상태, 기억, 행동 확정 |
| `src/text.ts` | 임베드 분할 |
| `src/embeds.ts` | 안내 임베드 |
| `src/git-guard.ts` | 30MB 커밋 상한 검사 |

## 개발

```sh
bun run check
bun test
```

테스트는 트리거 판별, 문맥 예산, Decision 응답 파싱, 호출 예산, 회로 차단, 기억 소유권·검색, 감정 감쇠, 관계 경계, 행동 중재, 생성 호출 1회 보장, 명령 등록, 저장소 동작을 검사합니다. 테스트 파일은 `src/config.ts`를 직접 불러오지 않습니다. 이 파일은 시작할 때 환경변수를 검사하고, 없으면 프로세스를 끝냅니다.

## 백업과 복구

- 데이터베이스는 `data/guilds/<서버ID>.sqlite`에 있습니다. 서버별로 따로 백업합니다.
- `data/seed`에는 DB 청크와 manifest가 있습니다. Docker 기동 시 자동 복원됩니다.
- 미디어는 `data/media`에 있습니다. DB만 복구하면 미디어 경로는 남지만 파일은 없을 수 있습니다.
- `data/`는 `.gitignore`에 있어 저장소에 올라가지 않습니다. 백업은 git이 아니라 `data/` 디렉터리를 직접 복사해서 합니다.

## 문제 해결

**`Missing required env var: DISCORD_TOKEN`이 반복됩니다**

- `.env`에 토큰이 실제로 들어 있는지 확인합니다.
- 값을 넣은 뒤 Docker에서는 `docker compose up -d --build --force-recreate`로 다시 만듭니다.

**슬래시 명령이 안 보입니다**

- 관리자 권한으로 `!sync`를 보냅니다.
- 전역 등록은 최대 1시간 걸립니다. `!sync`로 다시 동기화할 수 있습니다.
- 룰렛과 대화 명령은 전용 서버에만 등록됩니다.

**기억이 저장되지 않습니다**

- "기억해줘"처럼 분명히 말해야 합니다. 자동 저장이 꺼져 있으면 명시 요청만 저장합니다.
- `/memory list`로 실제 저장 여부를 확인합니다.
- 기억 삭제는 대화로 부탁해도 되지 않습니다. `/memory delete id`로 직접 지웁니다.
- `/mind status`에서 Decision 호출이 한도에 걸리지 않았는지 봅니다. 한도를 넘으면 규칙 기반 판단으로 동작합니다.

**대화가 답하지 않습니다**

- 대화는 `1489819911277641952`에서만 동작합니다.
- `CHAT_OPENROUTER_API_KEY` 또는 `OPENROUTER_API_KEY`가 비어 있으면 기동 로그에 꺼졌다고 나옵니다.
- 기동 로그의 `[key]`, `[model]`, `[mind]`, `[soul]` 줄에서 실제 사용 값을 확인합니다.

**검색을 안 합니다**

- `EXA_API_KEY`가 있는지 확인합니다. 없으면 검색을 건너뛰고, 프롬프트에 검색 실패로 알립니다.
- 검색은 Decision이 최신 정보가 필요하다고 판단할 때만 실행됩니다.

**백필이 끝나지 않습니다**

- 채널당 100개 단위로 라운드로빈하며 상한이 없습니다. 큰 서버는 오래 걸립니다.
- `SKIP_BACKFILL=true`면 백필만 건너뜁니다. 저장된 기록이 0건인 서버는 한 번 강제로 백필합니다.
