# Giinii Board — Card Design System

`/친밀도` `/통화량` `/통계` 가 그리는 통계 카드(PNG)의 디자인 시스템.
모듈: `src/voice-affinity-card.ts`. 렌더러: `@napi-rs/canvas`. 캔버스 고정 2400×1350.

## 0. Research Log

- **Audit lane** — `renderVoiceAffinity`는 순수 함수라 Discord 없이 실제 PNG를 렌더해 4개 모드 × 8개 상태를 눈으로 확인했다. 결함은 관찰이 아니라 근거로 다룬다.
- **Layer A** — `redesign-skill.md`(기존 UI 개선, audit-first) + `minimalist-skill.md`("깔끔하게" 요청에 대응하는 취향: 극단적 타이포 대비, 색은 희소하게, 1px 경계, 산만한 반경 금지). Stacking rule 4에 따라 redesign이 taste를 주도하고 minimalist가 실행 자세를 준다.
- **Layer B 스킵** — 사용자가 브랜드를 지정하지 않았고, 산출물은 웹 랜딩이 아니라 **정적 데이터 이미지**다. Layer B 브랜드 토큰은 웹 surfaces(히어로·섹션·cta)에 묶여 있어 이 표면으로 이전할 근거가 없다. 대신 프로젝트 고유 토큰(BM DoHyeon, 2400×1350, 4개 모드)을 근거 삼는다.
- **Perfection / React / interaction 스킵** — 산출물은 정적 PNG다. DOM·번들·페이지 로드·포인터 상호작용이 없어 Lighthouse·react-scan·모션 토큰이 성립하지 않는다.
- **Primitive Showcase Gate** — 이 프로젝트의 primitive은 카드 하나다. 상태 매트릭스(4모드 × {7행, 3행, 0행})를 실제 렌더로 전부 확인하고 구현에 들어갔다.

## 1. Atmosphere & Identity

서버의 숫자를 **명부처럼** 보여주는 카드. 장식이 아니라 기록이다.
시그니처는 **하나의 강조색이 카드 전체를 관통하는 단일 축**이다. 네 개 모드가 각각 다른 색을 가지지만, 그 색이 적용되는 위치(overline · 값 · 막대)는 항상 같은 자리다. 그래서 `/통계`가 세 장을 나란히 붙여도 하나의 표처럼 읽힌다.

## 2. Color

다크 표면 고정. 라이트 모드는 없다 — 카드는 Discord 클라이언트의 어두운 채널에 붙는다.

### Palette

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface/canvas | `canvas` | `#0A0E17` | 카드 배경 최하단 |
| Surface/canvas-top | `canvasTop` | `#121A2B` | 배경 그라디언트 상단 |
| Surface/panel | `panel` | `#141C2E` | 헤더·랭킹 패널 |
| Surface/row | `row` | `#182338` | 기본 행 |
| Surface/row-hover | `rowAlt` | `#1D2A42` | 2·4·6행 교대 |
| Surface/row-lead | `rowLead` | `#233450` | 1위 행 (강조 워시) |
| Surface/inset | `inset` | `#0D1320` | 진행 바 트랙, 빈 상태 |
| Border/default | `border` | `#253148` | 패널 외곽 1px, 헤더 구분선 |
| Text/primary | `text` | `#F2F5FA` | 제목, 이름, 값 |
| Text/secondary | `muted` | `#94A3BC` | 부제, 단위 설명 |
| Text/tertiary | `subtle` | `#64748F` | overline, 열 헤더 |

### Accent — 모드당 1개, 카드 전체에서 2단계로만

각 모드는 `accent` / `accentSoft` **딱 두 값**만 가진다. 새 색을 추가하지 않는다.

| Mode | accent | accentSoft | 비고 |
|---|---|---|---|
| `affinity` | `#6FE3C8` | `#2E5F5A` | 민트 |
| `volume` | `#7FC7F5` | `#2C5470` | 하늘 |
| `chat` | `#F2C86A` | `#6B5426` | 호박 |
| `activity` | `#C3AEF7` | `#4E4380` | 라벤더 |

**Accent 규칙**
- accent는 **overline 텍스트, 1위 행의 값, 진행 바** 세 곳에만. 장식 줄·패널 테두리·배지·행 좌측 스트라이프에는 쓰지 않는다.
- `accentSoft`는 진행 바 그라디언트의 먼 쪽 스톱에만.
- 순위 표현은 색이 아니라 행 표면의 밝기(`row` → `rowAlt` → `rowLead`)로만 한다. 순위 숫자가 병기되므로 색은 필요하지 않다.
- 헤더 윗면에 accent 라인을 넣지 않는다. overline이 이미 색을 담당하며, 위 라인만 있으면 장식처럼 읽힌다.

### Ink-alpha wash — 순위 표현

행 강조는 색이 아니라 **밴드의 밝기**로만 한다.

| Rank | Surface | Rank numeral |
|---|---|---|
| 1 | `rowLead` | `text`, weight 최대 |
| 2 | `rowAlt` | `text` |
| 3 | `rowAlt` | `text` |
| 4+ | `row` / `rowAlt` 교대 | `subtle` |

## 3. Typography

폰트 1개: **BM DoHyeon** (`src/assets/BMDoHyeon-Regular.ttf`). 카드에 새 폰트를 추가하지 않는다.

| Level | Size | Tracking | Usage |
|---|---|---|---|
| Title | 92px | 0 | 카드 제목 (한 줄, 초과 시 축약) |
| Value/hero | 62px | 0 | 요약 값 (accent) |
| Value/row | 44px | 0 | 행 값 |
| Name | 46px | 0 | 멤버 표시명 |
| Subtitle | 34px | 0 | 부제 + 기준 시각 |
| Metric | 30px | 0.02em | overline (대문자) |
| Handle | 26px | 0 | `@username` |
| Column | 26px | 0.04em | 열 헤더 |
| Summary/label | 28px | 0 | 요약 라벨 |
| Empty | 44px | 0 | 빈 상태 본문 |

**규칙**
- 열 헤더와 overline만 대문자 + 양의 tracking. 본문은 절대 대문자화하지 않는다.
- 값은 모두 오른쪽 정렬해 자릿수를 맞춘다.
- 제목은 1줄로 강제하고 초과 시 축약 기호 `…`를 붙인다(잘림 근거는 `fitText`).

## 4. Spacing & Layout

기준 단위 **8px**. 모든 좌표는 이 배수에서 파생한다(단, 행 높이 계산 결과는 예외).

| Token | Value | Usage |
|---|---|---|
| `space-2` | 16 | 카드 외곽 여백 |
| `space-3` | 24 | 패널 안쪽 여백 |
| `space-4` | 32 | 헤더↔패널 간격, 행 이름↹핸들 |
| `space-5` | 40 | 요약 블록 여백 |
| `space-6` | 48 | 제목↔부제 |
| `space-8` | 64 | 헤더 안쪽 여백 |

### 그리드 (고정)

| 항목 | 값 |
|---|---|
| 카드 너비 | 2400 (고정) |
| 카드 높이 | **내용에 따라 가변** (7행 1372 / 1행 664 / 빈 상태 664) |
| 카드 외곽 여백 | 64 |
| 헤더 높이 | 248 (고정) |
| 헤더↔패널 간격 | 32 |
| 패널 시작 y | 344 (고정) |
| 패널 높이 | 열 헤더 블록(108) + 행 수 × 118 + 40 |
| 행 높이 | 118 (고정, 행 간격 10) |
| 좌우 열 | 순위 196 → 이름 236(폭 460) → 막대 760(폭 1080) → 값 2264 |

### 세로 배분 규칙 (핵심)

행 높이는 **고정 118px**이고, 카드 높이는 **행 수에 비례**한다.

```text
panelHeight = 108 + rowCount * 118 - 10 + 40
canvasHeight = 344 + panelHeight + 64
```

행 수를 나눠 가변으로 늘리지 않는다. 행 높이가 카드마다 달라지면 같은 표가 다른 높이로 보여 `/통계`의 카드 3장이 어긋나고, 페이지마다 리듬이 바뀐다. 고정 높이로 통일하고 **카드 전체가 짧아지는** 쪽을 택한다.

빈 상태의 패널 높이는 1행일 때와 같게 256으로 맞춘다. 빈 카드가 실제 내용보다 크면 안 된다.

## 5. Components

### RankingCard

- **Structure**: 배경 → 헤더 패널 → 랭킹 패널 → 행 N개
- **Variants**: `affinity` | `volume` | `chat` | `activity`
- **모드가 바꿀 수 있는 것**: accent 2색, overline 문자열, 제목 문자열, 단위 라벨, 값 포맷터, 부제 문자열, 요약 라벨 2개. **구조는 절대 바꾸지 않는다.**
- **Spacing**: 4절의 그리드
- **States**: `populated` (1~7행) / `empty` (0행)
- **접근성**: 텍스트 대비는 본문 4.5:1 이상을 목표로 `text`/`muted` 사용. 이미지라 스크린리더 대상은 아니지만 Discord 이미지 대체텍스트가 없으므로 **카드 안에 모든 정보가 자립**해야 한다(요약 블록이 총계를, 행이 값을, 부제가 기준 시각을)
- **Motion**: 없음. 정적 이미지
- **Layout**: 단일 열 스택

#### 헤더 (모든 모드 동일 구조)

```text
[overline]                      [요약 라벨 1]  [값 1]
[제목]                          [요약 라벨 2]  [값 2]
[부제 · 기준 시각]
```

요약 블록은 **항상 라벨 2행 + 값 2행**이다. 모드가 달라도 개수는 같다. affinity가 예전에 가졌던 별도 상자 2개(참여 인원/전체 시간) 구조는 폐기하고, 모든 모드가 같은 우측 정렬 스택을 쓴다.

#### 행 (모든 모드 동일 구조)

```text
[순위 숫자]  [표시명]  [@handel]   [──── 진행 바 ────]   [값]
```

- 순위 숫자: `01`~`07` 2자리 고정폭, 우측 정렬. 1위는 `text`, 나머지는 `subtle`
- 이름/핸들: 좌측 고정 폭, 초과 시 축약
- 진행 바: `inset` 트랙 + accent 그라디언트. 최대값 대비 비율
- 값: 우측 정렬. 단위는 라벨로만 표기하고 값에는 붙이지 않는다(`6시간 52분`이 아니라 `6:52:00` 형식 금지 — 사람이 읽는 단위를 유지)

#### 열 헤더

3개만 둔다: `순위` / `멤버` / 값 라벨. 막대 위에는 라벨을 두지 않는다 — 막대가 하는 일이 "상대 비교"이므로 라벨이 필요 없고, 열 라벨이 개수를 늘리면 시선이 분산된다.

**모드별 값 라벨**: affinity `함께 있던 시간` / volume `통화량` / chat `메시지 수` / activity `활동 점수`.
**모드별 overline**: affinity `VOICE AFFINITY` / volume `GIINII BOARD · VOICE` / chat `GIINII BOARD · CHAT` / activity `GIINII BOARD · ACTIVITY`.
affinity만 예외 접두사가 있던 것을 **전부 같은 접두사 형식**으로 통일한다.

#### empty 상태

- 열 헤더를 그리지 않는다. 빈 표에 대한 헤더는 정보가 아니라 소음이다
- `inset` 패널 안에 说明 문구 1행 + 서브 1행만
- 값 라벨은 `—` 로 표시해 "0"과 "없음"을 구분한다

## 6. Motion & Interaction

없음. 정적 PNG. 모션 토큰은 성립하지 않으며,引入하지 않는다.
상호작용은 Discord 쪽 버튼(◀ ▶)에만 있고 그건 이 모듈 밖이다.

## 7. Depth & Surface

**전략: tonal-shift + 1px border 혼합.** 그림자는 쓰지 않는다(정적 이미지에서 그림자는 계산을 낭비하고 병렬 행 위에서 계단식 가장자리를 만든다).

| Level | Value | Usage |
|---|---|---|
| Border | 1px `border` | 패널 외곽, 헤더 구분선 |
| Hairline | 1px `border` (30% 알파) | 열 헤더 아래 |
| Tonal step | `row` → `rowAlt` → `rowLead` | 행 간격, 1위 강조 |

### Radius

| Token | Value | Usage |
|---|---|---|
| `radius-card` | 20 | 카드 헤더·랭킹 패널 |
| `radius-row` | 12 | 행 |
| `radius-track` | 999 (capsule) | 진행 바 트랙·채움 |
| `radius-inset` | 16 | 요약 블록, 빈 상태 인셋 |

기존 카드의 36px 패널 / 24px 행 / 18px 배지처럼 제각각이던 반경을 4단계로 줄였다. 중첩 모서리는 동심이다(카드 20 − 안쪽 여백 24 → 인셋 16보다 크므로, 인셋은 16 유지).

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- 본문 텍스트 대비 4.5:1 이상 (`text` on `row` ≈ 12:1, `muted` on `row` ≈ 6.4:1)
- 색만으로 순위를 전달하지 않는다 — 순위 숫자가 병기된다
- 막대 색만으로 모드를 구분하지 않는다 — overline 텍스트가 병기된다
- 모든 수치는 카드 안에만 존재. Discord가 이미지를 축소 표시해도 총계·기준시각이 읽힌다

### Accepted Debt

| Item | Location | Why accepted | Exit |
|---|---|---|---|
| 값 숫자가 비례 숫자(BM DoHyeon 단일 폰트) | `voice-affinity-card.ts` 값 렌더 | 폰트 1개 제약. 우측 정렬로 자릿수만 정렬 | 모노 폰트(`*_Dot.otf`)를 `src/assets`에 추가하고 값에만 적용 |
| 이미지라 스크린리더 대체텍스트 없음 | Discord 메시지 | 봇이 생성하는 이미지라 구조적으로 회피 불가 | 카드 요약 블록을 이미지와 함께 텍스트로 출력 |
| 정적 이미지라 reduced-motion 경로 없음 | 전 모드 | 모션이 존재하지 않음 | 해당 없음 |
