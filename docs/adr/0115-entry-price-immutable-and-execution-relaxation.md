# ADR-0115: entryPrice immutable + 실행 레이어 완화 정책

## 상태
승인 (2026-04-30)

## 배경

### 사용자 18단계 설계안 직접 반영

> **핵심 통찰**: "탐지 엔진 문제가 아니라 *실행 승인 엔진 과긴축*. 신호 생성은
> 되지만 실행 계층이 모두 차단되는 상태."

1차 로그 분석 후 사용자가 제시한 데이터 정합성 + 자동매수 정상화 18단계 설계안.
가장 critical 인 P0 + P1 우선 적용.

### 사용자 절대 원칙

> **"RAW PRICE 는 절대 수정 금지."**

ADR-0113 의 `applyEntryPriceDrift` 'CORPORATE_ACTION' 분기 + perSymbolEvaluation
의 `stock.entryPrice = currentPrice` 자동 재설정은 *RAW immutable 원칙 위반*.
1차 로그 098460 고영 +221% / 336260 두산테스나 +207% 사례를 막기 위해 도입했으나
사용자 새 설계안 §5 "entryPrice 자동 보정 제거 — 절대 금지" 와 직접 모순.

### 사용자 분석 §16 "가장 중요한 수정"

> "현재 시스템은 좋은 종목 탐지는 이미 상당 수준 도달했다. 문제는 *실행 레이어가
> 과도하게 보수적*이라는 점. 즉 탐지 엔진 문제보다 *실행 승인 엔진* 문제."

현재 perSymbolEvaluation 흐름:
- 스캔 → Gate1 → Gate2 → Gate3 → pre-breakout → 거래량 재검증 → drift sanity →
  KIS crosscheck → **failCount 증가 (모든 비치명 사유)** → reject

비치명 사유 (pre-breakout 미도달, 거래량 감소, drift WARN, Gate 재검증 미달) 도
`entryFailCount++` → 임계 도달 시 자동 제거 → 신규 매수 0 상태.

## 결정

### 1. entryPrice 자동 재설정 *완전 제거*

`server/trading/signalScanner/perSymbolEvaluation.ts` 의 'CORPORATE_ACTION' 분기:

**기존 (ADR-0113)**:
```typescript
if (driftAction === 'CORPORATE_ACTION') {
  stock.entryPrice = currentPrice;  // ⚠️ RAW 변형
  stock.corporateActionAdjusted = true;
  stock.corporateActionAdjustedAt = new Date().toISOString();
  // 텔레그램 + continue
}
```

**신규 (ADR-0115)**:
```typescript
if (driftAction === 'CORPORATE_ACTION') {
  // ADR-0115: RAW immutable — entryPrice 자동 재설정 *금지*.
  // 진단 텔레그램만 발송. universe 제외(REMOVE 와 동일 처리)로
  // 다음 영업일 운영자 검토 후 수동 entryPrice 갱신 또는 새 진입.
  // ENV ENTRY_PRICE_AUTO_CORRECT_DISABLED=false 설정 시에만 ADR-0113 동작 복원.
  if (isEntryPriceAutoCorrectDisabled()) {
    // 진단 텔레그램 발송 (24h dedupeKey)
    // universe 제거 (REMOVE 와 동일)
    // entryPrice 무수정
    stageLog.drift = 'CORPORATE_ACTION_REMOVE';
  } else {
    // 레거시 ADR-0113 동작 (ENV 명시 시에만)
    // ... 기존 자동 보정 코드 ...
    stageLog.drift = 'CORPORATE_ACTION';
  }
  pushTrace();
  continue;
}
```

기본값(ENV 미설정): `ENTRY_PRICE_AUTO_CORRECT_DISABLED=true` 동작 — 자동 보정 차단.

### 2. failureClassifier SSOT 신설

`server/trading/signalScanner/failureClassifier.ts` 신규.

```typescript
export type FailureSeverity = 'CRITICAL' | 'NON_CRITICAL';

/**
 * ADR-0115: failCount 증가 정책 — Critical Failure 만 카운트.
 *
 * CRITICAL (failCount++):
 *   - SPLIT_ANOMALY, KIS_MISMATCH, STALE_BASE, TRADING_HALT, CORPORATE_ACTION
 *
 * NON_CRITICAL (WAIT/skip, failCount 미증가):
 *   - PRE_BREAKOUT_MISS, VOLUME_DECREASE, GATE_REVALIDATION_FAIL, DRIFT_WARN,
 *     ENTRY_PRICE_DEVIATION (+10% drift)
 *
 * ENV PRE_BREAKOUT_FAILCOUNT_DISABLED=false → 레거시 동작 (모든 사유 카운트).
 */
export type FailureReason =
  | 'SPLIT_ANOMALY'
  | 'KIS_MISMATCH'
  | 'STALE_BASE'
  | 'TRADING_HALT'
  | 'CORPORATE_ACTION'
  | 'PRE_BREAKOUT_MISS'
  | 'VOLUME_DECREASE'
  | 'GATE_REVALIDATION_FAIL'
  | 'DRIFT_WARN'
  | 'ENTRY_PRICE_DEVIATION';

export function classifyFailureSeverity(reason: FailureReason): FailureSeverity;
export function shouldIncrementFailCount(reason: FailureReason): boolean;
export function isPreBreakoutFailCountDisabled(): boolean;
```

### 3. pre-breakout WAIT 분기

`perSymbolEvaluation.ts` 의 4 위치 (라인 677, 687, 812 등):

**기존**:
```typescript
stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
console.log(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — failCount=${stock.entryFailCount}`);
```

**신규**:
```typescript
// ADR-0115: pre-breakout 미도달은 NON_CRITICAL — failCount 미증가, WAIT 상태
if (shouldIncrementFailCount('PRE_BREAKOUT_MISS')) {
  stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
  console.log(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — failCount=${stock.entryFailCount}`);
} else {
  console.log(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — WAIT (failCount 미증가)`);
}
stageLog.preBreakout = shouldIncrementFailCount('PRE_BREAKOUT_MISS') ? 'FAIL' : 'WAIT';
```

ENV `PRE_BREAKOUT_FAILCOUNT_DISABLED=false` 명시 시 ADR-0113 동작 복원.

### 4. drift INVALID universe 격리 (이미 부분 구현)

`stockScreener.ts autoPopulateWatchlist` 가 이미 `dataQuality='STALE_BASE'` 시
universe 제외 처리. ADR-0115 는 이 동작을 **명문화**:

- `safePctChangeDetailed` tier='INVALID' 또는 'CORPORATE_ACTION' → caller 가
  universe 제외 의무
- yahooQuoteAdapter 의 `changePercent`/`return5d`/`return20d` INVALID 시
  `dataQuality='STALE_BASE'` 마커 부착 (현재 동작 유지)
- autoPopulateWatchlist 가 STALE_BASE 마커 + 다중 위반 / KIS 폴백 실패 시 → 제외
  (현재 동작 유지)

본 PR 추가 강화:
- ENV `DRIFT_INVALID_UNIVERSE_EXCLUDE=true` (default) — 정책 명시화

### 5. Gate3 ENV 완화 (default OFF — 운영자 명시 활성화)

`server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts` 또는
호출자 `perSymbolEvaluation` 에서:

```typescript
const minGate = getMinGateScore(regime); // 기존
const relaxedMinGate = isExecutionRelaxationEnabled()
  ? Math.max(minGate - 1, 5)  // Gate3 7→6 (최소 5 보장)
  : minGate;
```

ENV `EXECUTION_RELAXATION_ENABLED=true` 명시 시에만 작동. **default OFF** —
회귀 위험 격리.

### 6. ENV 롤백 4종

| ENV | Default | 효과 |
|-----|---------|------|
| `ENTRY_PRICE_AUTO_CORRECT_DISABLED` | **true** (정책 적용) | false 명시 시 ADR-0113 자동 보정 동작 복원 |
| `PRE_BREAKOUT_FAILCOUNT_DISABLED` | **true** (정책 적용) | false 명시 시 ADR-0113 failCount 증가 복원 |
| `DRIFT_INVALID_UNIVERSE_EXCLUDE` | true (현재 동작) | 정책 명문화 |
| `EXECUTION_RELAXATION_ENABLED` | **false** (기존 동작) | true 시 Gate3 7→6 완화 |

## 영향 범위

| 영역 | 변경 | 위험 |
|------|------|------|
| `failureClassifier.ts` 신규 SSOT | 신규 모듈 | 외부 의존 0 |
| `perSymbolEvaluation.ts` 4 분기 wiring | CORPORATE_ACTION → KEEP / pre-breakout → WAIT / failCount Critical-only | LIVE 매매에 *완화 효과* (의도된 변경) |
| `entryRevalidationStep.ts` Gate3 ENV 완화 | ENV default OFF — 명시 활성화 시에만 | 기존 동작 보존 |
| ENV 롤백 4종 | 즉시 복원 가능 | — |
| KIS/KRX quota | 0건 침범 | — |

## 1차 로그 시뮬

| 시나리오 | ADR-0113 후 | ADR-0115 후 |
|---------|-------------|-------------|
| 098460 고영 +221% drift | entryPrice 자동 재설정 (12,610 → 40,500) | **entryPrice 보존 (12,610) + universe 제외 + 진단 텔레그램** |
| 코스닥 종목 pre-breakout 미도달 | failCount++ → 임계 도달 시 자동 제거 | **WAIT (failCount 미증가) — 다음 사이클 재시도 가능** |
| Gate3 6.8/7 미달 | reject | (ENV 활성 시) Gate3 6 임계 통과 |

## 후속 PR (scope 외)

1. **RAW/ADJUSTED 분리** — `ServerShadowTrade.entryPriceRaw / entryPriceAdjusted`
   필드 분리. 이번 PR 의 RAW 보존 정책의 다음 단계.
2. **Corporate Action Ledger** — `server/data/corporateActions.ts` 신규.
   KRX/DART 출처 cumulative factor + `getAdjustmentFactor(code, date)`.
3. **상태머신 정식 도입** — TradeSignalStatus union 확장 (SCAN/WATCH/READY/EXECUTE/HOLD/INVALID).
4. **거래량 감소 reject 정합** — VCP 특성 분기 분리. 기존 분기 정합 검증 후 진행.

## 참조
- ADR-0113 §"watchlistManager entryPrice 자동 보정" — 본 ADR 에 의해 *deprecated*
- 사용자 18단계 설계안 §1 "RAW PRICE 절대 수정 금지", §5 "entryPrice 자동 보정 제거",
  §11 "failCount 구조 수정", §10 "Pre-breakout 조건 완화", §16 "가장 중요한 수정"
