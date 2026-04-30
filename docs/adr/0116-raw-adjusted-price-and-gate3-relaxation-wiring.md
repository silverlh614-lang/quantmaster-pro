# ADR-0116: entryPrice RAW/ADJUSTED 분리 인프라 + Gate3 ENV 완화 wiring

## 상태
승인 (2026-04-30)

## 배경

ADR-0115 가 *RAW immutable 원칙* 을 명문화 (entryPrice 자동 재설정 정책 폐기)
했지만, 정작 RAW vs ADJUSTED 의 *분리된 영속 필드* 는 도입 안 됨. 사용자 18단계
설계안 §1 의 핵심 원칙:

> ```
> entryPriceRaw          // 불변 원장
> entryPriceAdjusted     // 파생 계산값
> ```
>
> Adjusted 는 언제든 재계산 가능하지만 Raw 는 절대 수정 금지.

본 ADR 은 이 분리 구조의 **인프라 시드** 를 도입. Corporate Action Ledger
(P3 후속 PR) 가 cumulativeAdjustmentFactor 를 채우기 전까지는 factor=1.0 default
→ adjusted == raw identity. 따라서 본 PR 만으로는 *기능 변경 0* — 후방 호환
완전 보존.

또한 ADR-0115 가 정의한 `EXECUTION_RELAXATION_ENABLED` ENV 헬퍼는 *정의만* 했고
wiring 미수행. 본 ADR 이 entryRevalidationStep 의 minGate 비교에 wiring 추가
(default OFF — 운영자 명시 활성화 시에만 효과).

## 결정

### 1. ServerShadowTrade schema 옵셔널 필드 2종

`server/persistence/shadowTradeRepo.ts` `ServerShadowTrade` 에 옵셔널 추가:

```typescript
/**
 * ADR-0116: 진입 시점 RAW 가격 (불변 원장).
 * 분할/병합 후에도 *절대* 수정 금지. shadowEntryPrice / signalPrice 와 별도
 * 보강 layer — 기존 필드는 후방호환 보존.
 */
entryPriceRaw?: number;

/**
 * ADR-0116: cumulativeAdjustmentFactor (분할/병합 누적 보정 계수, 1.0 default).
 * adjusted = entryPriceRaw / factor. Corporate Action Ledger (P3 후속 PR) 에서
 * 진입 시점 + 현재 시점 factor 비교로 갱신.
 */
cumulativeAdjustmentFactor?: number;
```

### 2. WatchlistEntry schema 동일 필드

`server/persistence/watchlistRepo.ts` `WatchlistEntry` 에 동일.

### 3. priceAdjustment SSOT 헬퍼 모듈

`server/data/priceAdjustment.ts` 신규 (≤120 LoC, @responsibility SRP):

```typescript
export function getAdjustedPrice(rawPrice: number, factor?: number): number;
export function getEntryPriceAdjusted(trade: { entryPriceRaw?, signalPrice?, shadowEntryPrice?, cumulativeAdjustmentFactor? }): number;
export function getEntryPriceRawForRecord(trade: ...): number;
export function getEntryPriceForDisplay(trade: ...): number;
```

**우선순위 SSOT**:
- `getEntryPriceAdjusted`: rawPrice / factor (factor 부재 또는 ≤0 시 1.0 fallback)
- `getEntryPriceRawForRecord`: entryPriceRaw → shadowEntryPrice → signalPrice → 0
- `getEntryPriceForDisplay`: getEntryPriceAdjusted (UI/리포트는 분할 보정 후 가격)
- 모든 NaN/Infinity 안전 fallback

본 PR 은 헬퍼 + 테스트만 도입. 호출자 wiring 은 후속 PR 점진 적용.

### 4. buildBuyTrade — entryPriceRaw 자동 영속

`server/trading/buyPipeline.ts` `buildBuyTrade` 가 ServerShadowTrade 생성 시:

```typescript
return {
  // ... 기존 필드 ...
  entryPriceRaw: p.shadowEntryPrice,  // ADR-0116: RAW 불변 원장
  cumulativeAdjustmentFactor: 1.0,    // ADR-0116: factor=1 default (CA Ledger 후속)
  // ...
};
```

기존 4 호출자(perSymbolEvaluation 라인 396/531/941/1173 + shadowRouter) 무수정.

### 5. Gate3 ENV 완화 wiring

`server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts`:

```typescript
const minGateBase = getMinGateScore(input.regime);
const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
const minGate = Math.max(minGateBase - relaxedDelta, 5);  // 최소 5 보장
const revalidation = evaluateEntryRevalidation({
  // ...
  minGateScore: minGate,
  // ...
});
```

ENV `EXECUTION_RELAXATION_ENABLED=true` 명시 시에만 작동. default OFF —
회귀 위험 격리. 사용자 18단계 §12 "Gate3 7→6 임시 완화".

## 영향 범위

| 영역 | 변경 | 위험 |
|------|------|------|
| `priceAdjustment.ts` 신규 SSOT | 신규 모듈 | 외부 의존 0 |
| `ServerShadowTrade` / `WatchlistEntry` schema | 옵셔널 필드 2종 추가 | 후방호환 100% |
| `buildBuyTrade` | entryPriceRaw + cumulativeAdjustmentFactor=1 자동 영속 | factor=1 identity → 기존 호출자 무영향 |
| `entryRevalidationStep` Gate3 ENV wiring | ENV default OFF | 활성화 시 매수 빈도 ↑ (의도된 효과) |
| KIS/KRX quota | 0건 침범 | — |
| LIVE 매매 본체 | factor=1 identity 라 동작 변경 0 | — |

## 후속 PR (scope 외)

1. **P3 Corporate Action Ledger** — `server/data/corporateActions.ts` 신규.
   KRX/DART 출처 cumulativeFactor + `getAdjustmentFactor(code, date)`. 본 PR
   의 priceAdjustment SSOT 가 factor 입력으로 활용.
2. **호출자 wiring** — exitEngine / qualityScorecard / 텔레그램 리포트가
   `getEntryPriceAdjusted(trade)` 사용으로 전환 (점진).
3. **상태머신 정식 도입** — TradeSignalStatus union 확장.
4. **거래량 감소 reject 정합** — VCP 특성 분기 분리.

## 참조
- ADR-0115 §"RAW immutable 원칙" — 본 ADR 의 직전 단계
- 사용자 18단계 설계안 §1 "RAW PRICE 절대 수정 금지", §12 "Gate3 7→6 완화"
