# ULW-Research Brief: giinii_bot 기능 추가 / 로직 최적화 탐색

## Core question
"이 봇에 뭐가 더 추가되면 좋고, 지금 로직에서 뭐가 최적화되면 좋나" — 근거 있는 제안 목록.

## Operating facts (measured this session, not assumed)
- src 5,359줄, 17파일. test 625줄 3파일.
- 실DB: discord_messages 166,722 / message_details 98,682 / media_files 3,389 / user_profiles 1,544 / chat_stats 12,423
- enrich 실측: 뭐해 길드 98,469건 재순회 17.8분 (≈92건/분 아님, 실제로는 더 느림 — 아래 실측 로그)
- 백필 이상징후: 46분간 262,600건 조회 / 신규 100건 / 미종료. 저장 구간 점프가 生产에서 작동 안 함(원인 미확정)
- .env에 DISCORD_GUILD_ID=1489819911277641952 설정 → 4개 길드 중 1개만 백필/enrich 대상, 나머지 3개는 60,694건 방치
- docker compose up -d 는 이미지가 있으면 재빌드 안 함 (--build 필요)
- docker compose logs 는 재생성된 이전 컨테이너 로그까지 섞음
- media 디렉토리는 data/ 아래 → 컨테이너/호스트 공유 볼륨

## Axes (one owner each)
1. ingest-pipeline — 백필/enrich/media 워커. 미종료 백필의 원인, enrich 비용, 레이트리밋, 재개 시맨틱
2. storage-schema — 스키마/인덱스/성장/보관/WAL/vacuum, 166k→수백만 행 궤도
3. ai-analysis — 프롬프트 조립, 컨텍스트 절단(OpenAI 12,000자 하드코딩), 모델 카탈로그, 비용/캐시
4. commands-ux — 슬래시 명령 16종, 누락 기능(검색/내보내기/타임라인), 카드 렌더링, Discord 상호작용 제약
5. web-dashboard — 설정/Playground 화면, 0.0.0.0 무인증 노출(알려진 critical), 데이터 조회 API 부재
6. voice-activity — 음성 추적/presence 세션, 캡처되는 것과 빠지는 것
7. roulette-game — 유일한 비-분석 기능, 정확성/경계값
8. skeptic — 위 전 축의 주장을 공격 (mandatory attack lane)

## Deliverable
- lane: no-format (채팅 답변) — "알려줘"에 대한 직접 답변이 목적지
- state: n/a (신규 문서 아님)
- formats: chat-synthesis
- destination: chat
- audience: 프로젝트 소유자(한국어)
- template: 없음
- format description: 한국어, 축별 우선순위 + 근거(파일:라인) + 예상 영향 + 구현 난이도
- answered_by: request

## Expected truths (intent-diff seeds)
- E1: 데이터 규모가 늘어날 때 현재 설계가 버틴다 → 관측: 166k행에서 enrich 17.8분, 백필 미종료
- E2: 운영자가 "저장 다 했다"를 확인할 수 있다 → 관측: 진행률 로그가 enrich에만 있고 백필 종료 판정 불가
- E3: Discord API 한도를 존중한다 → 관측: 429 백오프 코드 없음(코드 리뷰 필요)
- E4: 웹 대시보드가 외부에 안전하게 노출된다 → 관측: 0.0.0.0 + 무인증 (README에 이미 경고)
- E5: 저장 데이터가 grow하면서도 조회가 빠르다 → 관측: 인덱스 목록 조회 실패(재확인 필요)

## Routing
requested tier: none stated → mix by axis cost. deep-low×3, unspecified-high×1, unspecified-low×1, quick×2, ultrabrain×1(skeptic)
EOF
echo "brief written"; wc -l "$SESSION_DIR/brief.md"
