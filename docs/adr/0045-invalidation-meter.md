# ADR-0045 — Position Invalidation Meter

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z3 (Phase 1-3 of UI 재설계 Phase 1)
- **Related ADRs**: ADR-0043 (Context-Adaptive AutoTrade Layout), ADR-0044 (Account Survival Gauge)

## 1. 배경

페르소나 SYSTEMATIC ALPHA HUNTER 의 답변 규칙 명문화: "추천 시 반드시 진입 논리, 무효화 조건, 손절 조건, 목표 시나리오를 함께 제시한다." 추천 시점에는 4 카테고리가 텍스트로 제시되지만 — *보유 중* 에는 UI 어디에서도 그 무효화 조건을 추적하지 못한다. 이는 페르소나 철학 9 (보유 효과 + 후회 회피 경계) 를 직접 약화시킨다. "보유 중인 포지션이 이미 무효화 조건을 만족시켰는데" 사용자가 인지하지 못하면 정확히 그 행동 편향이 발동한다.

코드베이스에는 **매수 시점 무효화 조건의 영속 SSOT 가 부재**하다:
- `ServerShadowTrade.entryKellySnapshot` — Kelly/레짐 메타만 캡처, 무효화 조건 본체는 없음
- `gateAuditRepo` — Gate 조건 통과율 *집계* 통계 (개별 포지션 추적 아님)
- `PositionItem.breachedConditions` — 현재 손실률 기반 *런타임 휴리스틱* (매수 시점 정의 아님)
- `PositionItem.entryReason` — 자유 텍스트 (구조화된 조건 아님)

페르소나 원안 그대로의 "매수 시점에 N개 무효화 조건 영속 저장 → 보유 중 M개 충족 평가" 는 ServerShadowTrade 스키마 확장 + 매수 진입 경로(buyPipeline / orderDispatch) 변경 + 영속화 마이그레이션을 동반하는 큰 변경이다. 본 PR 은 **클라이언트 휴리스틱** 으로 시작 — `PositionItem` 의 *기존 필드* (stopLossPrice / pnlPct / stage / targetPrice1) 만 사용해 4 카테고리에 대응하는 평가를 수행. 영속 SSOT 도입은 후속 PR 로 분리.

## 2. 결정

`PositionLifecyclePanel` 의 각 보유 포지션 카드에 컴팩트 인라인 미터(`<InvalidationMeter />`) 추가. 페르소나 4 카테고리(논리/무효화/손절/목표) 와 자연 매핑되는 4 휴리스틱을 클라이언트 순수 함수로 평가.

### 2.1 4 휴리스틱 매핑

| Key | 페르소나 카테고리 | 평가식 (PositionItem 기존 필드) | NA 조건 |
|-----|-------------------|-------------------------------|---------|
| `STOP_LOSS_APPROACH` | 손절 조건 임박 | `currentPrice ≤ stopLossPrice × 1.05` | `stopLossPrice` 부재 |
| `LOSS_THRESHOLD` | 무효화 조건 (리스크) | `pnlPct ≤ -3` | 없음 (항상 평가) |
| `STAGE_ESCALATION` | 무효화 조건 (시스템 단계) | `stage in ['ALERT', 'EXIT_PREP', 'FULL_EXIT']` | `stage` 부재 |
| `TARGET_REACHED` | 목표 시나리오 (긍정 무효화) | `currentPrice ≥ targetPrice1` | `targetPrice1` 부재 |

`TARGET_REACHED` 는 *긍정* 무효화 — 진입 시나리오가 *완료* 되어 다음 행동(익절 검토)이 필요한 상태. `LOSS_THRESHOLD` (-3% 임계) 는 ADR-0044 의 dailyLoss WARN 임계와 동일하지만 *포지션 단위* 적용.

### 2.2 InvalidationCondition 타입 SSOT

```ts
type InvalidationKey = 'STOP_LOSS_APPROACH' | 'LOSS_THRESHOLD' | 'STAGE_ESCALATION' | 'TARGET_REACHED';
type InvalidationTier = 'OK' | 'WARN' | 'CRITICAL' | 'NA';

interface InvalidationCondition {
  key: InvalidationKey;
  label: string;        // 한국어 라벨 (예: "손절가 임박")
  met: boolean | null;  // null = 평가 불가 (NA)
  detail: string;       // tooltip — "현재가 9650 / 손절가 9500 / 1.6% 여유"
}

interface InvalidationMeterResult {
  conditions: InvalidationCondition[];   // 항상 4개 (순서 SSOT)
  metCount: number;                       // 충족 카운트 (null 제외)
  evaluableCount: number;                 // 평가 가능 (null 제외)
  tier: InvalidationTier;
}
```

### 2.3 Tier 합성 SSOT

| 조건 | tier |
|------|------|
| `evaluableCount === 0` (모두 NA) | NA |
| `metCount === 0` | OK |
| `metCount === 1` | WARN |
| `metCount ≥ 2` | CRITICAL |

`STOP_LOSS_APPROACH + LOSS_THRESHOLD` 동시 충족(매우 흔한 상관 패턴) 또는 `STAGE_ESCALATION + LOSS_THRESHOLD` 가 자주 발생할 것이라 임계 2 부터 CRITICAL 로 보수적 설정. 후속 oneDecisionResolver(아이디어 4) 가 CRITICAL 카드를 "오늘의 단 하나의 결정" 으로 자동 격상시킬 수 있도록 임계값 통일.

### 2.4 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `src/utils/invalidationConditions.ts` | ≤ 120 | `evaluateInvalidationConditions` + `composeInvalidationTier` 순수 함수 SSOT |
| `src/components/autoTrading/InvalidationMeter.tsx` | ≤ 130 | 4 dot 미터 + tier 라벨 + hover/click expand 4 조건 상세 |

수정: `src/components/autoTrading/PositionLifecyclePanel.tsx` (+ 1 import + 카드 내부 1줄 wrap).

### 2.5 데이터 흐름 (외부 호출 0건)

```
PositionItem (이미 useAutoTradingDashboard 가 KIS 잔고 → mapper 거쳐 채움)
  ↓
evaluateInvalidationConditions(position) — 순수 함수, 외부 호출 0건
  ↓
<InvalidationMeter conditions={...} tier={...} />
```

서버 무수정 (PositionItem 스키마 확장 0건). 매 분 `useAutoTradingDashboard` 가 polling 하는 데이터를 *재해석* 만 하므로 outbound 0건.

## 3. 검증

### 3.1 자동 검증 (≥ 15 케이스)

- `evaluateInvalidationConditions` (≥ 8): 각 4 휴리스틱별 met/unmet/NA + 통합 케이스 (모두 충족 / 모두 NA / 절반 NA + 1 충족 등)
- `composeInvalidationTier` (≥ 5): 0/1/2/3 충족 분기 + 모든 NA → NA + evaluableCount 0 → NA
- `<InvalidationMeter>` (≥ 5): tier 색상 분기 + dot 카운트 + NA placeholder + hover expand + label 텍스트

### 3.2 시각 검증 (DoD)

- 보유 포지션 카드 1개당 1개 미터 — LifecycleStageGauge 직후 위치
- 색상 분기: OK 녹색 / WARN 황색 / CRITICAL 적색 pulse / NA 회색
- 미터 클릭 시 4 조건 상세 expand (label / 충족 여부 / detail)
- stopLossPrice/targetPrice1 부재 시 dot 자리 stroke-only 표시

## 4. 영향

### 4.1 영향받는 파일

- 신규: `src/utils/invalidationConditions.ts` + `src/components/autoTrading/InvalidationMeter.tsx` + 두 테스트 파일
- 수정: `src/components/autoTrading/PositionLifecyclePanel.tsx` (+1 import +카드 1줄)
- 무수정: 서버 전체 / PositionItem 타입 / autoTradingMapper

### 4.2 외부 호출 예산

- 신규 외부 호출 0건. 매수/매도 quota 0 침범. `useAutoTradingDashboard` 의 기존 polling 재사용.

### 4.3 후속 PR

- 후속 (영속 SSOT): ServerShadowTrade.invalidationConditions[] 신설 → 매수 시점에 사용자 정의 무효화 조건 영속 → 보유 중 평가가 *진정한 매수 시점 정의* 기반으로 작동
- 후속 (oneDecisionResolver): CRITICAL 카드를 "오늘의 단 하나의 결정 카드" 로 자동 격상 (아이디어 4)
- 후속 (Volume Decay): 거래량 감소 휴리스틱 추가 — 5번째 무효화 조건. 종목별 OHLCV 인프라 의존.

## 5. 결정의 결과

- 보유 포지션 카드에서 페르소나 4 카테고리 중 몇 개가 무효화되었는지 즉시 인지
- "매수 근거가 사라졌는데도 보유 중" 상태의 즉시 시각화 → 보유 효과/후회 회피 편향 차단
- 클라이언트 휴리스틱이라 첫 출시는 *근사값* 이지만 즉시 가치 제공 + 후속 영속 SSOT PR 의 인프라 시드
- ADR-0044 (SurvivalSnapshot 계좌 단위) 위에 *포지션 단위* 미터 — 두 layer 결합 시 전체 시스템 위험 즉시 가시화
