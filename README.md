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

ocp 서버 배포는 프로젝트 스킬 `/deploy`가 맡습니다. 푸시, 서버 체크아웃 fast-forward, 이미지 재빌드, 기동 확인까지 순서대로 처리합니다.

## Discord 설정

`src/index.ts`가 선언하는 인텐트는 네 개입니다.

| Intent | 용도 |
| --- | --- |
| `Guilds` | 서버 목록, 음성 어댑터 생성 |
| `GuildMessages` | `MessageCreate` 수신 |
| `GuildVoiceStates` | 음성 세션 추적 |
| `MessageContent` | 메시지 내용 읽기. Developer Portal에서 반드시 켭니다. |

필요 권한은 채널 보기, 메시지 기록 읽기, 메시지 보내기, 파일 첨부, 임베드 링크, 음성 연결, 말하기, 멤버 이동, 역할 관리입니다.

슬래시 명령은 두 범위로 등록됩니다. 음성 명령 4개는 전역이고, 룰렛 3개·대화 명령 2개·기억 명령 3개·3D 그래프 1개는 전용 서버(`1489819911277641952`)에만 등록됩니다. 명령이 안 보이면 서버에서 관리자 권한으로 `!sync`를 보냅니다.

## 명령어

### 슬래시 명령

| 명령 | 범위 | 설명 |
| --- | --- | --- |
| `/친밀도` `유저` | 전역 | 대상 유저와 같은 음성 채널에 함께 있었던 시간 TOP 21 |
| `/통화량` | 전역 | 서버 전체 누적 통화량 TOP 21, 7명씩 페이지 |
| `/통계` | 전역 | 통화량·채팅량·종합 활동량 TOP 7 카드 3장 |
| `/친밀도그래프` | 전역 | 상위 20명의 관계를 FHD 그래프로 표시 |
| `/친밀도그래프3d` | 전용 서버 | 상위 20명의 관계를 디스코드 Activity로 브라우저 3D로 표시 |
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
| `!들낙감지설치` | 서버 관리자 | 지금 채널을 들낙 감지 로그 채널로 지정합니다. |
| `!들낙시간지정 [초]` | 서버 관리자 | 들낙으로 볼 기준 시간을 정합니다. 기본 60초, 1~86400초 |
| `!들낙무시 [음성채널 ID]` | 서버 관리자 | 그 음성 채널을 들낙 감지에서 뺍니다. 인자 없이 쓰면 목록, `해제 [ID]`로 제거합니다. |

`!sync`, `!서버목록`, `!서버별명령어`, `!도움` 은 코드에 지정된 단일 유저(`ADMIN_USER_ID`)만 실행할 수 있습니다. `!들낙감지설치`, `!들낙시간지정`, `!들낙무시` 는 `ADMIN_USER_ID` 와 해당 서버 관리자가 함께 쓸 수 있습니다.

## 음성 통계

`VoiceStateUpdate`와 60초 정산 루프로 음성 채널 체류 시간을 누적합니다. KST 자정을 넘으면 세션을 쪼개 기록하고, 채널을 옮기면 새 구간을 시작합니다. 재시작 시 진행 중이던 세션은 현재 시각으로 닫고, 실제로 접속 중인 사람만 새 세션으로 다시 엽니다.

친밀도는 같은 채널 구간의 교집합으로 계산합니다. 뮤트 상태와 무관한 전체 체류 시간이며, 실제 발화 시간은 아닙니다. 상위 21명까지 카드로 표시합니다.

## 들낙 감지

봇이 아닌 멤버가 음성 채널에 들어온 뒤 기준 시간 안에 나가면, 설치한 로그 채널에 임베드 한 장을 보냅니다. 임베드는 나간 사람, 그 방에 남아 있던 사람들, 방을 멘션합니다. 기준 시간의 기본값은 60초이고 1초부터 86400초까지 정할 수 있습니다.

`!들낙무시 [음성채널 ID]` 로 특정 음성 채널을 감지에서 뺍니다. 인자 없이 실행하면 무시 목록을 보여주고, `!들낙무시 해제 [음성채널 ID]` 로 목록에서 뺍니다. 음성 채널만 지정할 수 있습니다.

룰렛처럼 봇이 직접 연결을 끊은 경우는 감지에서 뺍니다. 봇은 끊기 직전에 대상을 표시해 두고 그 전환 하나만 건너뜁니다.

채널과 기준 시간은 서버별 SQLite의 `dunk_settings` 테이블에, 무시 채널은 `dunk_ignored_channels` 테이블에 저장되므로 다시 배포해도 그대로 남습니다. 세 명령은 전용 서버(`1489819911277641952`)에서만 동작하고, 서버 관리자나 `ADMIN_USER_ID` 만 실행할 수 있습니다.

입장 시각은 메모리에만 두므로, 입장한 뒤 기준 시간이 지나기 전에 봇이 재시작하면 그 한 건은 감지되지 않습니다.

## 3D 친밀도 그래프

`/친밀도그래프3d`는 전용 서버에서만 등록됩니다. 실행하면 `LAUNCH_ACTIVITY` 콜백이 나가고, 디스코드 클라이언트가 Activity iframe을 띄웁니다. 서버는 JSON과 아바타 이미지만 보내고, 물리 배치와 WebGL 렌더링은 전부 사용자 기기에서 일어납니다. 호스팅 서버에 GPU가 필요 없습니다.

### 준비

1. Developer Portal에서 해당 애플리케이션의 **Activities**를 켭니다. 꺼져 있으면 `LAUNCH_ACTIVITY`가 거절됩니다.
2. Activity의 **URL Mapping**에 접두사 `/`를 공개 오리진 호스트로 연결합니다. 스킴 없이 `140-245-73-42.sslip.io`처럼 호스트만 넣습니다. iframe은 `https://<app-id>.discordsays.com/`에서 열리고 그 경로가 이 호스트로 프록시됩니다. 상대 경로 `/api/...` 호출이 그대로 서버에 닿는 이유입니다.
3. OAuth2 **Redirect**에 `https://127.0.0.1`을 추가합니다. Activity의 `authorize()`가 코드를 돌려줄 때 쓰는 값입니다.
4. 호스트에서 Caddy가 80·443을 받아 `127.0.0.1:8787`(또는 `ACTIVITY_HTTP_PORT`)로 넘깁니다. Docker는 compose에서 `0.0.0.0:8787`로 열고 호스트 루프백에만 게시합니다. 인증서는 Let's Encrypt에서 자동으로 받고 갱신합니다. Tailscale Funnel은 쓰지 않습니다. 공용 Funnel 경로가 요청당 5~7초를 더했고, 공인 IP 직접 연결은 0.25~1.9초였습니다.
5. `.env`에 `ACTIVITY_ENABLED=true`와 `DISCORD_CLIENT_SECRET`(Developer Portal > OAuth2)을 넣습니다. `DISCORD_CLIENT_ID`는 비워 두면 봇 토큰 첫 조각에서 읽습니다.
6. 봇이 그 서버에 초대되어 있어야 합니다. Activity는 서버에 설치된 앱에서만 열립니다.
7. `bun run build:activity`로 SPA를 빌드합니다. Docker 이미지는 빌드 단계에서 자동으로 만듭니다.
8. 서버를 다시 시작하고 `!sync`로 전용 서버 명령을 등록합니다.

`ACTIVITY_ENABLED`가 꺼져 있거나 클라이언트 ID·시크릿이 비어 있으면 명령은 설정 안내만 돌려주고, 기존 PNG 명령은 그대로 동작합니다.

### 동작

- `7일`과 `30일`은 최근 168시간·720시간이고 자정 기준이 아닙니다. `전체`는 수집한 모든 기간입니다.
- 7일·30일은 그 기간 안 체류 시간으로 상위 20명을 다시 뽑습니다. `전체`는 기존 PNG와 같은 20명을 유지합니다.
- 두 사람 사이의 값은 같은 음성 채널에서 겹친 시간만 더합니다. 다른 채널에서 보낸 시간은 합산하지 않습니다.
- 노드를 누르면 그 사람과 연결된 모든 관계가 보입니다. 기본 화면에서 숨긴 관계도 드러납니다. 다른 노드를 한 번 더 누르면 두 사람을 비교합니다.
- 관계선은 서로의 상위 7명에 든 관계만 기본으로 그립니다. 비교에서 직접 겹침이 0이면 '함께한 통화 기록 없음'으로 표시하고 임의의 점수를 만들지 않습니다.

### 보안

- 길드 ID는 Activity 인스턴스 조회에서만 나옵니다. 서버가 봇 토큰으로 `GET /applications/{id}/activity-instances/{instance_id}`를 호출하고, 응답의 `location.guild_id`를 씁니다. 요청 본문이 다른 길드를 지정해도 무시됩니다. `location.kind`가 `gc`가 아니면(DM·그룹 DM) 거절합니다.
- 유저 ID는 서버가 OAuth 코드를 교환해서만 얻습니다. 클라이언트 시크릿은 서버에만 있습니다.
- 교환한 유저가 인스턴스의 참여자 목록에 없으면 거절합니다. 같은 인스턴스에 있는 다른 사람의 코드를 쓰는 경로를 막습니다.
- 세션은 32바이트 난수 베어러 토큰이고 메모리와 `sessionStorage`에만 둡니다. 쿠키를 쓰지 않으므로 브라우저가 다른 사이트로 자동 전송하지 않습니다. 세션은 30분이고, 1분이 지난 뒤 첫 요청에서 길드 멤버 여부와 명령 활성 상태를 다시 확인합니다.
- 세션은 발급한 Activity 인스턴스에 묶입니다. 다른 서버의 Activity에서 저장된 토큰을 재사용하면 401로 거절하고 새로 인증합니다.
- 아바타는 현재 그래프에 포함된 사용자만 같은 출처 경로로 받아갑니다. 임의 URL을 프록시하지 않습니다. 아바타 요청에도 같은 베어러 토큰이 필요하고, 브라우저는 받은 이미지를 object URL로 바꿔 그립니다.
- CSP의 `frame-ancestors`는 디스코드 클라이언트만 허용합니다. 다른 사이트는 이 iframe을 감쌀 수 없습니다.
- API JSON 응답은 `Cache-Control: private, no-store`입니다. 아바타는 `private, max-age=300`, 해시된 정적 자산은 `immutable`, HTML은 `no-cache`이고 검색 색인을 막습니다.

### 기기 요구 사항

브라우저가 WebGL을 지원해야 합니다. 지원하지 않거나 3D 장면 초기화에 실패하면 같은 데이터를 표로 보여주고 `/친밀도그래프`를 안내합니다. 서버는 대체 렌더링을 하지 않습니다.

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

1. 최근 대화·관계·기억 후보를 SQLite에서 읽습니다.
2. Decision 모델에 한 요청으로 판단을 묻습니다. 의도, 사회적 상황, 관계 신호, 행동, 검색 필요성, 기억 범위·대상·유형·공개 범위를 함께 묻습니다.
3. 첫 판단이 흔들리면 같은 모델에 한 번 더 집중 질문을 보냅니다. 트리거당 최대 2회입니다.
4. TypeScript가 관계·기억 권한을 확인하고 저장 범위를 확정합니다.
5. 기억은 승인 없이 저장 즉시 활성화됩니다.
6. 필요하면 Exa로 검색합니다.
7. 확정된 행동 지침으로 답변을 한 번 생성합니다.

- 관계는 사용자별 친숙도·라포·장난 선호·참여도·대화 스타일로 저장됩니다. 감정 상태나 기억을 막는 경계 목록은 두지 않습니다.
- 기억은 두 범위로 나뉩니다. 개인 기억(`scope=user`)은 말한 사람의 것이고 기본은 비공개입니다. 서버 공용 기억(`scope=guild`)은 서버가 함께 쓰는 정보입니다.
- 기억 내용에 다른 사용자가 조금이라도 관련되면 모델 판단과 관계없이 공용으로 저장합니다. "빅시는 미국에 살아", "나랑 빅시는 친구야", "빅시를 천재라고 불러"가 모두 여기에 해당합니다.
- 한 메시지에 개인 사실과 타인 사실이 섞여 있으면 문장 단위로 나눠 각각 저장합니다.
- 다른 사람의 개인 기억은 본인이 `/memory visibility`로 공유를 허용한 것만, 그것도 SQL 단계에서 걸러 검색됩니다. 비공개 기억은 Decision 모델로도 전달되지 않습니다.
- 기억에는 대상 사용자, 작성자, 공개 범위, 종류(사실·취향·호칭·서버 관습)가 따로 붙습니다. 누가 누구에 대해 말했는지와 누가 고칠 수 있는지는 서로 다른 축입니다.
- 서버 공용 기억은 `/shared-memory`로 관리합니다. 일반 사용자의 공용 기억과 호칭 변경도 관리자 승인 없이 바로 반영됩니다.
- 호칭은 검색이 아니라 대상 사용자 기준으로 붙습니다. 같은 대상의 새 호칭은 기존 행을 교체하므로 두 호칭이 동시에 유효하지 않습니다.
- 모델은 `<memory>` 태그를 만들지 않습니다. 저장·수정은 Decision의 의도와 TypeScript의 소유권·권한 검증을 함께 통과해야 반영됩니다.
- 기억 삭제는 자연어로 요청해도 실행되지 않습니다. 개인 기억은 `/memory delete`·`/memory clear`, 공용 기억은 `/shared-memory delete`로만 지웁니다.
- 대상이 애매한 수정은 실행하지 않고 되묻습니다.
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
| `MIND_MEMORY_CANDIDATES` | X | 후보 검색 상한. 기본 12 |
| `MIND_MEMORY_SELECTED` | X | 답변에 넣을 기억 상한. 기본 5 |
| `MIND_AUTO_MEMORY` | X | 명시 요청 없는 자동 저장. 기본 `true` |
| `MIND_OTHER_USER_MEMORY_ENABLED` | X | 다른 사람이 공유 허용한 개인 기억 검색. 기본 `true` |
| `MIND_GUILD_MEMORY_ENABLED` | X | 서버 공용 기억 검색·적용. 기본 `true` |
| `MIND_RELATIONSHIP_UPDATE_LIMIT` | X | 상호작용 1회당 관계 변화 상한. 기본 0.03 |
| `MIND_SEARCH_TIMEOUT_MS` | X | 답변 전 검색 제한. 기본 3000ms |
| `MIND_DEBUG` | X | 판단 실패 로그. 기본 `false` |
| `ACTIVITY_ENABLED` | 3D | `/친밀도그래프3d` 사용. 기본 `false` |
| `DISCORD_CLIENT_SECRET` | 3D | Developer Portal > OAuth2의 클라이언트 시크릿. 커밋하지 않는다 |
| `DISCORD_CLIENT_ID` | 3D | 비우면 봇 토큰 첫 조각에서 읽는다 |
| `ACTIVITY_HTTP_HOST` | X | 기본 `127.0.0.1`. Docker는 compose에서 `0.0.0.0` |
| `ACTIVITY_HTTP_PORT` | X | 기본 8787 |
| `ACTIVITY_DIST_PATH` | X | 빌드된 SPA 위치. 기본 `activity/dist` |

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
| `src/dunk-detection.ts` | 들낙 감지 추적, 로그 임베드, `!들낙` 명령 |
| `src/roulette.ts` | 관리자 러시안 룰렛 |
| `src/voice-affinity*.ts` | 친밀도 계산과 카드 렌더링 |
| `src/voice-graph-contract.ts` | 서버·브라우저가 공유하는 3D 그래프 계약 |
| `src/voice-graph-data.ts` | 기간별 음성 세션 클리핑·병합·페어 집계 |
| `src/voice-graph-domain.ts` | 커뮤니티와 관계 판정. 2D와 3D가 함께 쓴다 |
| `src/activity-*.ts` | 3D 그래프 HTTP, Activity 인증(인스턴스 조회·코드 교환), 아바타 프록시, 스냅샷 캐시 |
| `activity/` | Vite SPA. `three`와 WebGL은 이 폴더에서만 쓴다 |
| `src/chat/` | 기니봇아 대화, 문맥, 생성 호출, 검색 |
| `src/mind/` | Decision 판단, 관계, 기억, 행동 확정 |
| `src/text.ts` | 임베드 분할 |
| `src/embeds.ts` | 안내 임베드 |
| `src/git-guard.ts` | 30MB 커밋 상한 검사 |

## 개발

```sh
bun run check
bun test
bun run build:activity
```

테스트는 트리거 판별, 문맥 예산, Decision 응답 파싱, 호출 예산, 회로 차단, 기억 소유권·공유 범위·공용 기억·호칭·권한·스키마 마이그레이션, 관계 경계, 행동 중재, 생성 호출 1회 보장, 명령 등록, 저장소 동작을 검사합니다. 3D 그래프는 기간 집계·관계 판정·선택 상태·HTTP 인증·디스코드 응답 파싱을 따로 검사합니다. Activity 인증 테스트는 가짜 `discord` 의존성을 쓰고 실제 디스코드 API나 클라이언트 시크릿을 부르지 않습니다. 테스트 파일은 `src/config.ts`를 직접 불러오지 않습니다. 이 파일은 시작할 때 환경변수를 검사하고, 없으면 프로세스를 끝냅니다.

`bun run check`는 서버와 `activity/`를 각자의 tsconfig로 나눠 검사합니다. 서버 번들에 DOM 타입이나 3D 라이브러리가 섞이지 않게 하기 위해서입니다.

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
- 다른 사용자가 관련된 이야기는 요청하지 않아도 공용 기억으로 저장됩니다.
- `/memory list`로 실제 저장 여부를 확인합니다.
- 기억 삭제는 대화로 부탁해도 되지 않습니다. `/memory delete id`로 직접 지웁니다.
- 다른 사람에게 보여줄 기억은 `/memory visibility id visibility:공유 가능`으로 바꿔야 합니다.
- 서버 공용 기억은 `/shared-memory add`로 넣고 `/shared-memory list`로 확인합니다. 저장 즉시 반영되며 승인 절차는 없습니다.
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

**`/친밀도그래프3d`가 Activity를 열지 않습니다**

- `ACTIVITY_ENABLED=true`인지, `DISCORD_CLIENT_SECRET`이 비어 있지 않은지 확인합니다.
- Developer Portal에서 Activities가 켜져 있는지 확인합니다. 꺼져 있으면 `LAUNCH_ACTIVITY`가 거절됩니다.
- 앱이 아직 배포되지 않았다면 Activity는 소유자와 개발팀만 열 수 있습니다. 서버 멤버 전체가 쓰려면 앱 배포 상태를 확인합니다.
- 기동 로그에 `Activity web server listening on ...`이 있는지 봅니다. 포트가 이미 쓰이면 이 줄 대신 오류가 남습니다.
- 명령이 보이지 않으면 전용 서버에서 `!sync`를 실행합니다.

**Activity iframe이 '디스코드 안에서 /친밀도그래프3d로 열어 주세요'를 보여 줍니다**

- 주소를 브라우저에서 직접 열면 `frame_id`·`instance_id` 쿼리 파라미터가 없어 SDK가 뜨지 않습니다. 명령으로 엽니다.
- iframe은 뜨는데 이 문구가 보이면 SDK 핸드셰이크가 실패한 것입니다. URL 매핑의 접두사 `/`가 Funnel 호스트를 가리키는지 확인합니다.

**Activity iframe이 '세션이 만료됐어요'를 보여 줍니다**

- 세션은 30분입니다. 명령을 다시 실행합니다.
- 코드 교환이 401이면 `DISCORD_CLIENT_SECRET`이 틀렸거나 OAuth2 Redirect에 `https://127.0.0.1`이 없어 코드를 받지 못한 경우입니다.
- 403 `not_in_activity`는 인스턴스 참여자 목록에 그 유저가 없다는 뜻입니다. 403 `activity_instance_unavailable`은 봇이 그 인스턴스를 읽지 못한 경우이므로 앱이 서버에 설치됐는지 확인합니다.

**3D 화면이 목록으로만 보입니다**

- 브라우저 하드웨어 가속이 꺼져 있으면 WebGL을 만들 수 없습니다. 목록은 같은 데이터를 표로 보여줍니다.
- 서버는 3D 대체 렌더링을 하지 않습니다. 이미지는 `/친밀도그래프`를 씁니다.

Bidirectional sync test
