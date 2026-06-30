# ADR-0660 — RRR Collapse Partial-Exit Minimum-Profit Guard (RRR 붕괴 부분익절 최소 수익률 가드)

## Status
Accepted (2026-06-30)

## Context

운영자(silverlh614) 진단 요청 (2026-06-30): "부분매도가 너무 빨리 발생한다. 너무 빨리 청산하면
수수료 내고 남는 게 없다."

실측 사례 — 텔레그램 `[부분청산 50%] RRR 붕괴 익절` 시프트업(462870):

| 항목 | 값 |
|------|----|
| 진입가 | 33,350원 |
| 목표가 | 36,684원 |
| 손절가(hardStopLoss) | 30,774원 |
| 청산가(발동) | 33,800원 |
| 발동 시점 수익률 | +1.3% (보유 0일) |

`exitEngine/rules/rrrCollapseExit.ts` 의 붕괴 트리거는 `liveRRR < 1.0`, 즉
`(targetPrice − P) < (P − hardStopLoss)` 이다. 이를 풀면 발동 임계 가격은

```
P > (targetPrice + hardStopLoss) / 2   ← 손절·목표의 정확한 중간값
```

시프트업의 중간값 = (36,684 + 30,774) / 2 = **33,729원 (진입 대비 +1.14%)**. 즉 진입 RRR 이
낮은(목표·손절 거리가 비슷한) 종목은 **진입 직후 +1% 대 미세 상승만으로** 50% 부분익절이
발동한다. 그 수준은 한국 round-trip 비용(매도 거래세 ~0.18% + 위탁수수료 + 슬리피지) 차감 후
실현 이익이 사실상 0 이다.

기존 가드는 `currentPrice > shadowEntryPrice` (수익 0% 초과) 뿐이라, **최소 수익 하한도
최소 보유시간도 없었다.**

## Decision

`rrrCollapseExit` 에 **ENV 조정 가능한 최소 수익률 가드** 1줄을 추가한다.

`returnPct` 가 임계(`RRR_COLLAPSE_MIN_PROFIT_PCT`, 기본 **3%**) 미만이면 RRR 붕괴 발동을
보류(`NO_OP`)한다. 가드는 기존 `currentPrice <= shadowEntryPrice` NO_OP 직후·
`remainingReward` 계산 직전에 배치한다.

```typescript
if (returnPct < getRrrCollapseMinProfitPct()) return NO_OP;
```

### Constants / Config SSOT (동일 파일 거주)

```typescript
export const RRR_COLLAPSE_MIN_PROFIT_PCT_DEFAULT = 3;

export function getRrrCollapseMinProfitPct(): number {
  const raw = process.env.RRR_COLLAPSE_MIN_PROFIT_PCT;
  if (raw === undefined || raw.trim() === '') return RRR_COLLAPSE_MIN_PROFIT_PCT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : RRR_COLLAPSE_MIN_PROFIT_PCT_DEFAULT;
}
```

- 빈값/미설정 → 기본 3
- 음수·NaN → 기본 3 안전 폴백 (잘못된 ENV 가 가드를 무력화하지 못하게)
- `0` 설정 → 가드 비활성 = 구 동작(수익 0% 초과면 발동)

## Environment Variable Rollback

`RRR_COLLAPSE_MIN_PROFIT_PCT=0` 설정 시 가드가 비활성화되어 **구 동작과 byte-identical** 로
즉시 롤백된다 (returnPct ≥ 0 이면 항상 가드 통과 → 기존 `liveRRR < 1.0` 판정만 남음).
운영자는 ENV 한 줄로 임계를 0(기존)·3(기본)·임의 값으로 튜닝할 수 있다.

## Consequences

### Positive
- **본전 조기청산 차단**: +1.3% 같은 비용-차감-후-무의미 수준에서 50% 청산되던 사례 제거.
- **진입 RRR 낮은 종목 보호**: 중간값이 진입가 코앞이던 빡빡한 셋업에서 의미 있는 수익까지 보유.
- **튜닝 가능**: 운영 데이터로 임계를 ENV 한 줄로 조정 (코드 재배포 불요).

### Negative
- **상승 지속 종목의 좀비 청산 지연**: 임계(3%) 도달 전까지는 RRR 붕괴 청산이 보류된다. 단,
  목표가 도달(`legacyTakeProfit`/`trancheTakeProfitLimit`)·트레일링·손절 등 다른 청산 경로는
  무영향이라 보유 정당성 상실 종목도 결국 다른 규칙으로 정리된다.

### Neutral / 안전성
- **LIVE 매매 본체 0줄 변경** — 가드는 발동을 *억제*만 하므로 엄격히 더 보수적 (신규 매도 주문
  경로·수량·가격 로직 무변경, 기존 `reserveSell` SSOT 그대로).
- **손실 청산 경로 무영향** — 가드는 `returnPct < 임계` (수익 영역) 에만 작용. HIT_STOP·하드스톱·
  cascade·R6 등 손실/긴급 청산은 전혀 건드리지 않는다.
- 9대 불변식 #1(엔진 상시가동)/#2(Shadow 무중단)/#7(L4 미사용)/#8(차단 분리) 보존.
  SourceSnapshot·Gate·requiredScore=70·autoTradeEngine order 본문·buyPipeline·kisClient·`src/**` 무접촉.

## Implementation

- 수정 파일: `server/trading/exitEngine/rules/rrrCollapseExit.ts`
  - 상수 `RRR_COLLAPSE_MIN_PROFIT_PCT_DEFAULT` + getter `getRrrCollapseMinProfitPct()` 추가
  - 가드 1줄 추가 (entry-price NO_OP 직후)
- 회귀 테스트: `__tests__/rrrCollapseExit.test.ts` (+4 케이스, 총 10 통과)
  - 임계 미만(+1%) → NO_OP / 임계 이상(+4%) → 발동 / `=0` 롤백 발동 / 음수·NaN → 기본 폴백 보류
- 진단 도구: `scripts/analyze-rrr-collapse.mjs` — 발동 빈도·수익률·사후추세 집계 (별도 read-only)

## References

- ADR-0028: exitEngine 디렉토리 분해 + EXIT_RULES_IN_ORDER SSOT
- ADR-0072: Entry Circuit Breaker (exit 규칙 ENV 튜닝/롤백 선례)
- ADR-0530: Patch Scope Guard
- 운영자 진단 (2026-06-30): 시프트업(462870) RRR 붕괴 +1.3% 보유 0일 50% 부분청산 사례
