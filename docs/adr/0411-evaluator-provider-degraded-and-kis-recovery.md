# ADR-0411: evaluator 단위 PROVIDER_DEGRADED 강등 + Yahoo↔KIS 가격 괴리 KIS recovery

**Status**: Accepted (P0 — ADR-0263 정책 개정 + ADR-0387~0390 status SSOT 활용)
**Date**: 2026-05-06

## 배경

ADR-0263 (PR #636 KIS-Yahoo 50% 괴리 차단) 가 도입한 `return null` 정책이 *마스터 매핑 결함* 가설에만 최적화되어 있어, *Yahoo 측 stale price* (분할/증자/정정 직후 1~3 영업일 잔존) 케이스에서도 universe 에서 종목을 통째로 제거하는 **부수효과** 누적. 운영자는 *왜 종목이 사라졌는지* 추적 불가능 (rejectionLog 도 부재).

동시에 ADR-0387~0390 (PR #655~#658) 가 도입한 `ConditionEvalStatus` 7-value SSOT (FIRED / THRESHOLD_NOT_MET / DATA_UNAVAILABLE / **PROVIDER_DEGRADED** / SKIPPED_BY_POLICY / SANITY_REJECTED / ERROR) 가 evaluator 단위 *데이터 신뢰성 손상* 표현 가능. ADR-0263 의 강한 차단(`return null`) 을 *경계화 + 자동 강등* 으로 격상 가능.

**사용자 micro-correction (2026-05-06)**: 초기 framework 의 *"STRONG → BUY 강등"* 표현이 부정확. 점수 시뮬레이션 결과 14 시계열 evaluator 강등 시 잔여 점수 (per/supply_confluence/earnings_quality 만점 합 ~3.0) 가 R3_EARLY NORMAL 임계 (4점) 미달 → *자연 진입 차단* 효과. 라벨링은 `WATCHLIST_HOLD` 또는 `TECHNICAL_PROVIDER_DEGRADED` 가 정확.

## 결정

### P0-1 — yahooQuoteAdapter ADR-0263 정책 개정 (KIS recovery)

**기존**: `divergence > 50% → return null` (universe 손실)
**개정**: `divergence > 50% → KIS 현재가 채택 + dataQuality marker + universe 보존`

```typescript
if (divergence > 0.5) {
  if (process.env.ADR_0411_KIS_RECOVERY_DISABLED === 'true') {
    return null; // ADR-0263 legacy 동작 복원
  }
  // KIS recovery
  price = kisSnap.price;
  priceSource = 'KIS_REALTIME';
  yahooKisDiverged = true;
  yahooKisRecoveryMeta = { originalYahooPrice, recoveredKisPrice, divergencePct, recoveredAt };
}
```

### P0-2 — `YahooQuoteExtended` schema 확장

신규 옵셔널 3 필드:

| 필드 | 타입 | 의미 |
|---|---|---|
| `dataQuality` | `'OK' \| 'STALE_BASE' \| 'KIS_PRIMARY_YAHOO_STALE_DETECTED'` | 신규 3번째 값 추가 |
| `yahooDerivedIndicatorsReliable` | `boolean` | 시계열 파생 지표 신뢰성 marker (registry 강등 입력) |
| `yahooKisRecovery` | `{ originalYahooPrice, recoveredKisPrice, divergencePct, recoveredAt }` | 진단 메타 |

`dataQuality` 우선순위 SSOT:
1. KIS recovery → `'KIS_PRIMARY_YAHOO_STALE_DETECTED'` (최우선)
2. Yahoo sanity 위반 → `'STALE_BASE'`
3. 정상 → `'OK'`

`yahooDerivedIndicatorsReliable = !yahooKisDiverged && dataQualityIssues.length === 0`

### P0-3 — `registry.run` TIMESERIES_DEPENDENT_EVALUATORS PROVIDER_DEGRADED 자동 강등

**`TIMESERIES_DEPENDENT_EVALUATORS` SSOT 신설** (14 evaluator):

```typescript
export const TIMESERIES_DEPENDENT_EVALUATORS = new Set<ConditionKey>([
  'momentum', 'vcp', 'volume_surge',                                          // ADR-0389
  'ma_alignment', 'volume_breakout', 'turtle_high', 'relative_strength', 'breakout_momentum', // ADR-0390
  'rsi_zone', 'macd_bull', 'pullback', 'ma60_rising', 'weekly_rsi_zone', 'trend_acceleration', // legacy
]);
```

비포함: `per` (fundamental, ADR-0387 P0-3 별도) / `supply_confluence` (KIS Flow) / `earnings_quality` (DART).

**`run()` 진입부 자동 강등**:
- `quote.yahooDerivedIndicatorsReliable === false` 시 시계열 의존 evaluator 호출 자체 skip
- `{ score: 0, status: 'PROVIDER_DEGRADED', detail: 'Yahoo 시계열 신뢰성 손상 (dataQuality=...)' }` 합성
- score / details / conditionKeys 미합산 (기존 PROVIDER_DEGRADED 처리와 동일)
- ENV `ADR_0411_PROVIDER_DEGRADED_DISABLED=true` 우회 (default OFF)

### P0-4 — WATCHLIST_HOLD 정책 (사용자 micro-correction)

`autoPopulateWatchlist` 에서 `dataQuality === 'KIS_PRIMARY_YAHOO_STALE_DETECTED'` 종목:
- universe 보존 (KIS 가격 신뢰성 OK)
- `WatchlistEntry.technicalProviderDegraded=true` + `technicalProviderDegradedAt` 영속
- 운영자 텔레그램·진단용 라벨링

**자연 진입 차단 흐름** (사용자 micro-correction):
1. 시계열 14 evaluator → PROVIDER_DEGRADED (registry 강등)
2. 잔여 비시계열 3 evaluator (per / supply_confluence / earnings_quality) max 합 ~3.0
3. R3_EARLY NORMAL 임계 (4점) 미달 → Gate Score 미달 → 신규 진입 자동 차단
4. 운영자 진단 메시지에 `TECHNICAL_PROVIDER_DEGRADED` 라벨 노출

## 안전 invariant

- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정)
- LIVE 매매 본체 — 시계열 evaluator score 산출 동일 (정상 데이터 유지 시), 강등은 Yahoo↔KIS 50% 괴리 시점만 발동
- ADR-0263 동작 복원 가능 — `ADR_0411_KIS_RECOVERY_DISABLED=true` ENV 1줄
- 강등 정책 자체 비활성화 가능 — `ADR_0411_PROVIDER_DEGRADED_DISABLED=true` ENV 1줄
- 비시계열 evaluator (per / supply_confluence / earnings_quality) 무수정 — 자동 강등 대상 아님
- 사용자 micro-correction 정합 — STRONG→BUY 강등 같은 *수치 조작* 부재, *자연 차단* 메커니즘만

## 잘못된 해결 방법 영구 차단

1. **dataQuality 부재 시 PROVIDER_DEGRADED 자동 강등** — `yahooDerivedIndicatorsReliable === undefined` (legacy quote) 는 강등 미적용 (후방호환 의무).
2. **STRONG_BUY → BUY 수치 강등** — 점수 시뮬레이션상 자연 차단 충분, 별도 강등 정책 추가 시 drift 위험.
3. **per evaluator 강등 대상 포함** — Yahoo PER 은 시점 derived 가 아닌 *현재 fundamental* 이라 ADR-0387 P0-3 별도 처리 (fallback `0` 차단만).
4. **호출자 측 dataQuality 검사 인라인** — `TIMESERIES_DEPENDENT_EVALUATORS` SSOT 단일 소스 의무 (drift 차단).
5. **ADR-0263 폐기** — 50% 괴리 자체는 *경고 신호* 라 보존 의무. 본 ADR 은 *처리 정책* 만 개정.

## 안전망 (운영자 즉시 해소)

| ENV | default | 효과 |
|---|---|---|
| `YAHOO_KIS_PRICE_DIVERGENCE_DISABLED=true` | OFF | divergence 검증 자체 스킵 (ADR-0263/0411 모두 비활성) |
| `ADR_0411_KIS_RECOVERY_DISABLED=true` | OFF | divergence 시 ADR-0263 원안 (`return null`) 복원 |
| `ADR_0411_PROVIDER_DEGRADED_DISABLED=true` | OFF | registry 자동 강등 비활성 (legacy 동작 복원) |

## 회귀 테스트

`registryAdr0411.test.ts` 15 케이스:
- TIMESERIES_DEPENDENT_EVALUATORS SSOT 정합 5
- run() 자동 강등 동작 7 (시계열 강등 / 비시계열 통과 / legacy 후방호환 / 14 evaluator 일괄 / detail marker / unknown fallback)
- ENV 우회 2
- 점수 시뮬레이션 1 (R3_EARLY 임계 미달 자연 차단 검증)

`yahooQuoteAdapterAdr0411.test.ts` 10 케이스:
- KIS recovery 정상 동작 4 (5%/60%/50% boundary/50.1%)
- ENV 우회 2 (LEGACY null / divergence skip)
- 안전 fallback 2 (KIS null / 비KR 종목)
- yahooDerivedIndicatorsReliable marker 2

ADR-0387 +34 / 0388 +28 / 0389 +42 / 0390 +25 / **0411 +25** = **누적 +154 회귀**.

## 후속 PR

- 호출자 측 context propagation (`perSymbolEvaluation` `hadRequiredData` / `skippedByPolicy` 명시 전달, ADR-0387 P1 잔여)
- Yahoo quoteSummary opportunistic enrichment (PER/EPS 데이터 부재 자체 해소, ADR-0387 P1 잔여)
- 잔여 8 evaluator status 마이그레이션 (rsi_zone / macd_bull / pullback / ma60_rising / weekly_rsi_zone / supply_confluence / earnings_quality / trend_acceleration)
- 텔레그램 `TECHNICAL_PROVIDER_DEGRADED` 라벨 운영자 메시지 wiring (위치: `/scan_blockers` 또는 `/health` 의 KIS recovery 사례 표면화)
