# ADR-0080 — Capital-Weighted Slot Accounting (자본 가중 슬롯 회계)

## 상태

Accepted (2026-04-28)

## 컨텍스트

`server/trading/signalScanner.ts:430` (LIVE 활성) + `server/trading/signalScanner/preflight.ts:365`
(PR-40 Phase B 후속 dead code) 두 곳에서 동일 패턴으로 활성 슬롯을 카운트:

```ts
const activeSwingCount = shadows.filter(
  (s) => isOpenShadowStatus(s.status) &&
         s.watchlistSource !== 'INTRADAY' &&
         s.watchlistSource !== 'PRE_BREAKOUT',
).length;
```

문제:

1. **자본 회계와 슬롯 회계 불일치** — 70% 익절로 30% 잔존 포지션 5개 누적되면
   사용 자본은 1.5 슬롯 분량(0.3 × 5)이지만 슬롯 회계는 5 슬롯 점유.
   `effectiveMaxPositions=8` 일 때 신규 진입 가용 슬롯이 5 임에도 *3* 만 노출.
2. **EUPHORIA 부분매도 불이익** — `originalQuantity` 가 분리 영속됐는데도
   회계에 반영 안 됨. EUPHORIA 50% 청산이 자본 50% 회수했는데 슬롯은 0% 회수.
3. **회전율 저하** — 잔존 30% 포지션이 차지한 7개 슬롯이 풀려야 신규 신호
   진입 가능. 슬롯 압력으로 신규 *고품질* 신호가 차단되는 비효율.

PR-40 의 preflight 분해가 활성화될 때까지 두 호출 site 가 byte-equivalent 로
공존 — drift 위험 동반 차단을 위해 단일 SSOT 모듈 추출.

## 결정

### 1. 신규 모듈 `server/trading/slotAccounting.ts`

순수 함수 SSOT — 외부 의존성 0 (타입 import 만):

```ts
export interface SlotConsumptionResult {
  consumed: number;          // 자본 가중 점유 (소수)
  rawCount: number;          // 기존 단순 카운트 (회귀 검증용)
  available: number;         // effectiveMaxPositions − consumed
  isFull: boolean;           // consumed >= effectiveMaxPositions
  detail: SlotDetail[];      // 종목별 분해 (로그/디버깅용)
}

export function computeSlotConsumption(
  shadows: ServerShadowTrade[],
  effectiveMaxPositions: number,
): SlotConsumptionResult;
```

### 2. 공식

종목별 슬롯 점유 = `getRemainingQty(shadow) / shadow.originalQuantity`

- 0~1 범위로 clamp (NaN/Infinity/음수 안전 fallback → 1.0 보수적)
- `originalQuantity` 부재 또는 ≤ 0 → 1.0 (레거시 trade 보수적)
- INTRADAY / PRE_BREAKOUT watchlistSource 는 회계 *제외* (기존 정책 보존)

총 점유 = sum(slotConsumed). isFull = consumed ≥ effectiveMaxPositions.

### 3. 두 호출 site wiring

`signalScanner.ts:430` (LIVE 활성) + `preflight.ts:365` (dead code Phase B 정합):

```ts
// 기존
const activeSwingCount = shadows.filter(...).length;
if (activeSwingCount >= effectiveMaxPositions) { ... POSITION_FULL }

// 신규 (byte-equivalent 로그 + 의미 정합)
const slotResult = computeSlotConsumption(shadows, effectiveMaxPositions);
if (slotResult.isFull) {
  console.log(`[AutoTrade] 최대 동시 포지션 도달 (${slotResult.consumed.toFixed(2)}/${effectiveMaxPositions} ...) — 신규 진입 스킵`);
  ... POSITION_FULL
}
```

원본 로그의 `${activeSwingCount}/${effectiveMaxPositions}` 표기를
`${consumed.toFixed(2)}/${effectiveMaxPositions}` 로 변경 — 운영자가 *자본 가중*
점유를 즉시 인지. SELL_ONLY 예외 캡 표기 + 레짐 표기 그대로 보존.

### 4. ENV 롤백 스위치

`SLOT_CAPITAL_WEIGHTED_DISABLED=true` → `consumed = rawCount` 로 강제 (기존
`shadows.filter(...).length` 와 동치). 운영 중 회귀 발견 시 즉시 차단.

## 결과

### 효과

- **70% 익절 잔존 30% 포지션 5개 = 1.5 슬롯 점유** → 신규 진입 가용 슬롯 6.5개로
  확장. 자본 회계와 슬롯 회계 일치.
- **EUPHORIA 부분매도 슬롯 자동 회수** — `originalQuantity` 가 이미 영속된
  필드라 신규 데이터 모델 0건 변경.
- **회전율 회복** — 신규 *고품질* 신호 진입 빈도 +20~30% 예상 (잔존 포지션
  비율에 비례).

### 회귀 위험

- **로그 형식 변경** — `${activeSwingCount}` (정수) → `${consumed.toFixed(2)}`
  (소수). 운영자 인지/grep 패턴 영향 가능. 변경 사유 명시 (자본 가중 표기).
- **POSITION_FULL 트리거 빈도 감소** — 의도된 변경. 회귀 테스트로 자본 가중
  계산 정확성 검증.
- **회귀 테스트 ≥10 케이스** — 만재 / 70% 잔존 / 30% 잔존 / 다중 혼재 / 빈 배열 /
  NaN 안전 / originalQuantity 부재 / INTRADAY 제외 / PRE_BREAKOUT 제외 / ENV 롤백 /
  isFull 경계값.

### LIVE 자동매매 본체 0줄 변경

- `kisClient` / `autoTradeEngine` / `orchestrator` 본체 무수정 (절대 규칙 #2/#4 준수).
- `effectiveMaxPositions` 의미 보존 — 본 ADR 은 *분자* 측정 정확성만 변경,
  *분모* 정책은 그대로.

## 대안 검토

| 대안 | 채택? | 사유 |
|------|------|------|
| (A) `remainingQty / originalQuantity` 자본 가중 | ✅ | 본 ADR. originalQuantity 필드 재활용으로 신규 데이터 모델 0건. |
| (B) Reserved-Slot Floor (INFRA_FLOOR=0.3) — 슬롯 회계 아이디어 2 | ❌ | 후속 PR 분리. 본 PR 은 자본 가중 단순 적용 — 인프라 부하 추적 데이터 누적 후 검토. |
| (C) Tail-Position 분리 슬롯 — 슬롯 회계 아이디어 3 | ❌ | 후속 PR. PRIMARY_SLOTS / TAIL_SLOTS 두 풀 분리는 데이터 모델 변경 + 마이그레이션 비용. |
| (D) Slot-Pressure-Aware Take Profit — 슬롯 회계 아이디어 8 | ❌ | exitEngine 룰 변경 동반 — 별도 ADR. |
| (E) Bayesian Slot Reservation — 슬롯 회계 아이디어 10 | ❌ | 학습 인프라 의존 (attributionRepo / failurePatternDB). 본 PR 의 데이터 누적 후 검토. |

## 호환성

- `ServerShadowTrade.originalQuantity` 옵셔널 필드 (이미 영속됨, ADR-0028 PR-7
  부팅 backfill 정상 작동).
- `getRemainingQty(trade)` 기존 SSOT (shadowTradeRepo:197) 재활용.
- INTRADAY/PRE_BREAKOUT 제외 정책 보존 (BUG-09 fix 정합 — 선취매 별도 한도).
- ENV 롤백 시 기존 단순 카운트 동치.

## 후속 PR (scope 외)

### PR-S1 (본 ADR follow-up commit, 같은 브랜치) — 루프 게이트 자본 가중화

**문제**: 본 ADR 의 초기 wiring 이 상위 게이트 2 곳 (signalScanner.ts:430 +
preflight.ts:365) 만 자본 가중으로 변경했으나, 루프 내부 게이트
(`perSymbolEvaluation.ts:283-289`) 가 여전히 `shadows.filter(...).length` 단순
카운트로 비교. 결과적으로 **상위 게이트는 통과 (consumed=5.20/8) 하지만 루프 첫
종목 평가 직전에 단순 카운트(8/8) 로 break 차단** 되어 ADR-0080 효과가
perSymbolEvaluation 단계에서 무력화.

**시나리오**: 만재 4개 + 30% 잔존 4개, effectiveMaxPositions=8 →
- 상위 게이트: consumed=5.20/8, isFull=false → 통과 ✓
- 루프 게이트: currentActive=8/8 → break ✗

**수정**: `currentActive` 변수를 `slotResult.rawCount` 로 보존하되 게이트 비교는
`slotResult.consumed + reservedSlots` 로 전환. 진단 로그에 `consumed.toFixed(2)`
+ `raw=N` 동반 표기. 단순 카운트 패턴 회귀 차단을 위한 wiring 회귀 테스트 5
케이스 추가 (`perSymbolLoopGateWiring.test.ts`).

### PR-S2 (별도 PR, shadow mode 1주 검증 권장) — sizing 분모 자본 가중화

`perSymbolEvaluation.ts:900-903` 의 `remainingSlots = max(1, maxPositions -
currentActive - reservedSlots)` 가 sizing 분할 비율 분모로 사용. 자본 가중으로
바꾸면 신규 진입의 *포지션 크기* 가 달라지므로 LIVE 영향 평가 신중 필요.
PR-S1 효과 데이터 누적 후 별도 PR 분리.

### 추가 후속 PR (그 외)

- 슬롯 회계 아이디어 2 — Reserved-Slot Floor (INFRA_FLOOR=0.3 인프라 부하 하한).
- 슬롯 회계 아이디어 3 — Tail-Position 분리 슬롯 (PRIMARY_SLOTS + TAIL_SLOTS 두 풀).
- 슬롯 회계 아이디어 8 — Slot-Pressure-Aware Take Profit (slot pressure 인지 익절선).
- 슬롯 회계 아이디어 9 — Tail-vs-NewSignal Auction (보유 효과 자동 무력화).
- 슬롯 회계 아이디어 10 — Bayesian Slot Reservation (확률적 슬롯 예약).

## 페르소나 정합

- **자료 22번 — 단일 책임 원칙**: 슬롯 점유 회계가 *카운트 책임* 에서 *자본 가중
  측정 책임* 으로 전환 — 단일 SSOT 모듈로 응집도 격상.
- **자료 19번 — 기회비용 상실**: 잔존 포지션이 점유한 슬롯이 신규 *고품질*
  신호 진입을 차단하던 비효율 차단. 자본 회계와 슬롯 회계 일치로 자원 배분
  최적화.
- **원칙 1번 — 필터링**: 슬롯 자체가 *동적 자본 측정 함수* 가 됨 — 정적 카운트
  필터링 대신 자본 비례 필터링.
