# ADR-0055 — Gate Mini Indicator (AI 추천 카드 우상단)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z7 (Phase 3-3 of UI 재설계)
- **Related ADRs**: ADR-0028 (UI Redesign P0 — GateStatusCard), ADR-0050~0048 (Phase 1+2+3-1+3-2 cards)

## 1. 배경

DiscoverWatchlistPage 의 AI 추천 카드(`WatchlistCard`)는 PR-A 의 `GateStatusCard` (expand 가능 풀 카드)를 카드 *내부* 에 임베드. 하지만 사용자가 카드 리스트(grid 1~3 열)를 **훑어볼 때** 4-Gate 통과 여부를 *즉시* 인지할 컴팩트 인디케이터가 카드 헤더에 부재. GateStatusCard 는 카드 본문 안에 위치하여 시각 우선순위가 낮다.

페르소나 철학 1 ("필터링") 의 카드 단위 노출 — 추천 N개 카드를 동시 보여줄 때 "어떤 카드가 4-Gate 모두 통과했나?" 라는 질문에 1초 이내 답해야 한다.

## 2. 사용자 원안 vs 본 PR 의 현실 적응

사용자 원안 (10 아이디어 #8): "AI 추천 시점에 동기적으로 4-Gate 평가하면 응답 지연 발생 → 백그라운드 평가 + 캐시 패턴. SQLite TTL 30분, circuit breaker 동시 평가 종목 수 상한 10개."

**현실 평가**:
- 현재 코드: AI 추천 응답 시 `stock.checklist` 필드가 *이미 채워짐* (Gemini 정성 + DART/Naver 정량 enrichment 통해). 별도 4-Gate 평가 호출 0건이라도 미니 인디케이터 평가 가능.
- 사용자 원안의 *지연 차단 동기* 가 실제로는 발생하지 않음 — 이미 stock 객체에 모든 데이터 존재.
- 서버 SQLite 캐시 + circuit breaker 인프라는 **stock.checklist 가 부재한 케이스 발생 시 후속 PR 로 분리**.

**본 PR 의 최소 가치 구현**:
- 클라이언트 미니 인디케이터만. 서버 0줄 수정. 외부 호출 0건.
- PR-A 의 `buildGateCardSummary` 와 동일 SSOT (GATE1/2/3_IDS + CONDITION_PASS_THRESHOLD) 재활용.
- 후속 PR (캐시 인프라) 는 ADR 에 명문화하여 시드 마련.

## 3. 결정

### 3.1 4-Gate 평가 SSOT (PR-A 재활용)

| Gate | ID 출처 | 통과 조건 |
|------|---------|----------|
| 0 | (1차 스크리너) | `gate1Passed` alias 또는 `isPassed` (gateEvaluation 유무) |
| 1 | `GATE1_IDS = [1, 3, 5, 7, 9]` (5개) | 점수 ≥ 5 인 조건 카운트 / 5 |
| 2 | `GATE2_IDS = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24]` (12개) | 점수 ≥ 5 인 조건 카운트 / 12 |
| 3 | `GATE3_IDS = [2, 17, 18, 19, 20, 22, 23, 25, 26, 27]` (10개) | 점수 ≥ 5 인 조건 카운트 / 10 |

`CONDITION_PASS_THRESHOLD = 5` (PR-A SSOT). `CONDITION_ID_TO_CHECKLIST_KEY` 매핑 사용.

### 3.2 GateDotState 분류 (4분기)

| State | 조건 | 색상 |
|-------|------|------|
| `PASS` | passedRatio ≥ 0.5 | 녹색 |
| `PARTIAL` | 0.3 ≤ passedRatio < 0.5 | 황색 |
| `FAIL` | 0 < passedRatio < 0.3 또는 totalCount > 0 + passedCount = 0 | 적색 |
| `NA` | totalCount = 0 또는 NaN/Infinity 입력 | 회색 (stroke-only) |

**경계값 정책**: `passedRatio === 0.5` → PASS (≥). `passedRatio === 0.3` → PARTIAL (≥). 분모 0 → NA.

**Gate 0 특수 처리**: `gate1Passed` / `isPassed` 둘 다 boolean → totalCount=1 + passedCount={true→1, false→0}. 둘 다 undefined → NA.

### 3.3 GateMiniSummary 타입 SSOT

```ts
type GateDotState = 'PASS' | 'PARTIAL' | 'FAIL' | 'NA';

interface GateLineSummary {
  id: 0 | 1 | 2 | 3;
  label: string;          // "Gate 0" / "Gate 1" / "Gate 2" / "Gate 3"
  state: GateDotState;
  passedCount: number;
  totalCount: number;
}

interface GateMiniSummary {
  gates: GateLineSummary[];   // 정확히 4개 (id 0/1/2/3 순서)
  passCount: number;          // PASS 인 gate 수 (0~4)
}
```

### 3.4 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `src/utils/gateMiniIndicator.ts` | ≤ 120 | `evaluateGateMini` + `classifyGateState` 순수 함수 SSOT |
| `src/components/watchlist/GateMiniIndicator.tsx` | ≤ 100 | 4 dot horizontal + tooltip + 색상 분기 |

수정: `src/components/watchlist/WatchlistCard.tsx` (+1 import + 1줄 wrap, 본체 무수정).

### 3.5 PR-A GateStatusCard 와의 책임 분리

| 컴포넌트 | 위치 | 책임 |
|----------|------|------|
| `GateStatusCard` (PR-A) | WatchlistCard 본문 내부 grid | expand 가능 풀 카드 — 상세 검토용. 4 Gate 통과/실패 + verdict + 클릭 시 모달 |
| `GateMiniIndicator` (본 PR) | WatchlistCard 헤더 우측 | 4 dot 컴팩트 인디케이터 — *즉시 인지* 용. 호버 tooltip 만 |

**중복 제거**: 두 컴포넌트가 같은 SSOT(`GATE1/2/3_IDS` + `CONDITION_PASS_THRESHOLD`) 사용. 임계값 변경 시 양쪽 자동 동기화 (gateConfig.ts 단일 SSOT).

### 3.6 후속 PR (별도)

ADR 본 §2 의 "사용자 원안 vs 현실" 후속 작업:
- **stock.checklist 부재 케이스 모니터링** — 본 PR 의 `evaluateGateMini` 가 NA tier 반환하는 빈도가 사용자 추천 카드 ≥ 10% 가 되면 인프라 도입 트리거
- **서버 SQLite 캐시 + circuit breaker** — `server/services/aiCandidateGateEvaluator.ts` 신설. KIS/Yahoo 호출이 필요할 때만 캐시 hit miss 패턴 + TTL 30분 + 동시 호출 10개 상한
- **미니 인디케이터에 캐시 hit/miss 표시** — NA dot 아래 작은 sync 아이콘 (캐시 갱신 중)

## 4. 검증

### 4.1 자동 검증 (≥ 12 케이스)

- `evaluateGateMini` (≥ 6): Gate 0 분기(gate1Passed 있음/없음/false) + Gate 1/2/3 분기 + checklist 빈 객체 → 모두 NA + 부분 통과 + 만점
- `classifyGateState` (≥ 4): PASS/PARTIAL/FAIL/NA 분기 + 경계값 (0.5/0.3) + NaN/분모0
- `GateMiniIndicator` (≥ 3): 4 dot 렌더 + 색상 분기 + NA stroke-only + data-gate-state 속성

### 4.2 시각 검증 (DoD)

- DiscoverWatchlistPage 진입 시 각 추천 카드 헤더 우상단에 4 dot 노출
- 호버 시 "Gate 1: 4/5 통과" tooltip
- PR-A GateStatusCard 와 함께 표시 (중복 아님 — 책임 분리)

## 5. 영향

### 5.1 영향받는 파일

- 신규: `src/utils/gateMiniIndicator.ts` + `src/components/watchlist/GateMiniIndicator.tsx` + 두 테스트 파일 + ADR
- 수정: `src/components/watchlist/WatchlistCard.tsx` (+1 import + 1줄)
- 무수정: 서버 전체 / `gateConfig.ts` / `GateStatusCard.tsx` / `WatchlistCard` 본체

### 5.2 외부 호출 예산

- 신규 outbound 0건. 클라이언트 stock.checklist 만 read.
- KIS/KRX/Yahoo/Gemini 자동매매 quota 0 침범.

## 6. 결정의 결과

- 사용자가 N개 추천 카드를 동시에 볼 때 4-Gate 통과 여부를 1초 이내 인지
- PR-A GateStatusCard 와 책임 분리 — 미니=즉시 인지, 풀카드=상세 검토
- 서버 인프라 0 도입으로 회귀 위험 격리 + 즉시 가치 제공
- 후속 PR (캐시 인프라) 의 시드 — stock.checklist 부재 케이스 발생 시 본 PR 의 NA tier 가 자동 트리거
