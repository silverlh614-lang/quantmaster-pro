# ADR-0397 — Yahoo ETF Fallback Wiring + Source Tier Confidence

**상태**: Accepted (2026-05-06)

**의도된 정책 명칭**: ADR-0372 — Yahoo ETF Fallback Wiring + Source Tier Confidence (사용자 명시, 실제 발급 0397 — INDEX.md `다음 발급` SSOT 정합, ADR-0148 발급 룰 준수)

**관련 ADR**:
- ADR-0396 (= 사용자 명시 ADR-0371) — sourceTier/freshness/coverage/confidence 4-axis 분리 SSOT (본 PR 의 직접 전제)
- ADR-0364 — sectorEnergyFallbackProvider Phase 1 (호출자 0건 dead code) — 본 PR 으로 첫 호출자 wiring
- ADR-0343 — buildSectorEnergyInputsWithMetaWithFallback (macroState cache fallback)
- ADR-0125 — sectorEnergy dataQuality 단일 라벨 (ADR-0396 으로 5-state 격상)

## 배경

### 결함 — Yahoo ETF L4 dead code + KRX 우회 위험

ADR-0364 (Phase 1) 가 `sectorEnergyFallbackProvider.ts` 신설했지만 **호출자 0건 dead code** 상태. KRX OpenAPI 외부 결함 시 `buildSectorEnergyInputsWithMetaWithFallback` 의 macroState cache fallback (48h) 도 실패하면 `dataQuality='FAILED'` 영구 고착 — `applySectorScoreBoost` 가중치 영구 비활성.

### 핵심 정책 — Yahoo ETF 는 L4 보험 레이어 (원천 대체재 아님)

사용자 명시 정책 (ADR-0372) 직접 반영:

```
L1: KRX exact indexCode 매칭          (sourceTier='KRX_CODE',  confidence ≤ 1.0)
L2: stock-daily 합성                  (sourceTier='STOCK_DAILY', confidence ≤ 0.85)
L3: fresh cache (≤ 30분, FRESH)       (sourceTier='CACHE',    confidence ≤ 0.7)
L4: Yahoo ETF fallback ⚠️             (sourceTier='YAHOO_ETF', confidence ≤ 0.5, allowStrongBuy=false)
```

**호출 순서 SSOT 절대 변경 금지** — L4 진입 조건 = KRX 실패 + stock-daily 실패 + cache 부재/EXPIRED 모두 충족 시.

### Yahoo ETF 한계 명시 (확률 0 강제 정책)

```typescript
if (sourceTier === 'YAHOO_ETF') {
  confidence *= 0.5;
  allowStrongBuy = false;
  dataQuality = 'DEGRADED';
}
```

**한계 사유** (ADR 본문 명시):

1. `volumeChangePct = 0` — Yahoo ETF 는 KRX 섹터 거래량 미제공
2. `foreignConcentration = 0` — Yahoo ETF 는 외인 수급 미제공
3. **4주 수익률 단일 축 의존 위험** — sectorEnergyEngine 점수가 단일 신호로만 계산됨

ADR-0396 의 `confidence` 가중치 (sourceWeight × freshnessWeight × coverage) 위에 본 PR 이 *L4 한정 추가 0.5 곱셈* 으로 한 번 더 강등 — confidence 최댓값 0.25 (= 0.5 × 1.0 × 1.0 × 0.5 추가).

## 결정

### 1. Yahoo ETF L4 wiring 진입점 — `buildSectorEnergyInputsWithMetaWithFallback`

기존 분기 (`sectorEnergyProvider.ts:547`):

```typescript
async function buildSectorEnergyInputsWithMetaWithFallback() {
  const result = await buildSectorEnergyInputsWithMetaRaw(); // L1+L2
  if (isSectorEnergyFallbackDisabled()) return result;
  if (result.dataQuality !== 'FAILED') return result;
  // L3: macroState cache (48h)
  const cached = ...;
  if (cached) return /* STALE marker */;
  return result; // 영원히 FAILED
}
```

신규 분기 (본 PR):

```typescript
async function buildSectorEnergyInputsWithMetaWithFallback() {
  const result = await buildSectorEnergyInputsWithMetaRaw(); // L1+L2
  if (result.dataQuality !== 'FAILED') return result;

  // L3: macroState cache (48h, ADR-0343)
  const cached = ...;
  if (cached) return /* STALE + sourceTier='CACHE' marker */;

  // L4: Yahoo ETF fallback (ADR-0397, 본 PR — 신규)
  if (!isSectorEnergyEtfFallbackDisabled()) {
    const yahoo = await buildSectorEnergyFromYahooETF();
    if (yahoo.dataQuality !== 'FAILED' && yahoo.validSectorCount > 0) {
      // L4 한정 추가 강등 — confidence × 0.5, dataQuality='DEGRADED'
      return applyYahooEtfDegradation(yahoo);
    }
  }

  return result; // L1~L4 모두 실패 시 FAILED
}
```

### 2. `applyYahooEtfDegradation` SSOT (사용자 명시 정책)

```typescript
function applyYahooEtfDegradation(result) {
  return {
    ...result,
    sourceTier: 'YAHOO_ETF',           // ADR-0396 4-axis
    dataQuality: 'DEGRADED',            // 사용자 명시 강제 정책 (DEGRADED 5-state union)
    // confidence 는 호출자 측 buildSectorEnergyQualityComposite 로 산출 후 ×0.5 한 번 더 적용
    reasons: [...result.reasons, 'L4 Yahoo ETF fallback (ADR-0397) — confidence × 0.5, allowStrongBuy=false'],
  };
}
```

### 3. `confidence` × 0.5 적용 위치 SSOT

- `computeConfidence` (ADR-0396 SSOT) 는 변경 0 — 4-axis 가중치 정책 그대로 보존.
- L4 wiring 측 `applyYahooEtfDegradation` 직후 `confidence × 0.5` 한 번 더 곱셈.
- `allowStrongBuy = false` 마커는 ADR-0398 (PR-3) 의 STRONG_BUY 게이트에서 read 후 소비.

### 4. ENV 우회

```
SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED=true (default OFF)
```

- 정확 비교 (ADR-0157 정합)
- 활성화 시 즉시 L4 wiring 비활성 → ADR-0371 동작 100% 복원 (회귀 1줄 즉시 롤백)
- `isSectorEnergyEtfFallbackDisabled()` 헬퍼 SSOT 위임 (ADR-0185~0189 정합)

### 5. fetchDailyBars 의존성 — Yahoo OHLCV 호출

기존 `sectorEnergyFallbackProvider.ts:25` 가 `fetchDailyBars(etfSymbol, '1mo')` 호출. 12 ETF 섹터 × 1 호출 = 최대 12 outbound. EgressGuard (ADR-0029) HISTORICAL intent 자동 적용.

**호출 빈도** — `buildSectorEnergyInputsWithMetaRaw` 가 FAILED 일 때만 진입 (정상 시 0 호출). KRX OpenAPI 일시 장애 시점만 활성.

### 6. `applyYahooEtfDegradation` 의 returnPct sanity bound 정합

기존 `buildSectorEnergyFromYahooETF` (라인 99) 의 `safePctChange` `sanityBoundPct: 90` 그대로. 추가 sanity 도입 0.

## 안전 invariant (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — signalScanner/entryEngine/exitEngine/orchestrator/autoTradeEngine 본체 무수정.
2. **KIS 주문 함수 5종 import 0건** — 정적 grep 가드 회귀 테스트 의무.
3. **호출 순서 SSOT 절대 변경 금지** — L1 → L2 → L3 → L4 (ADR-0372 직접 명시).
4. **`confidence × 0.5` 강제** — Yahoo ETF 는 보조 신호로만 사용 가능.
5. **`allowStrongBuy = false` 강제** — ADR-0398 (PR-3) 의 STRONG_BUY 게이트 입력.
6. **호출자 측 inline ENV 검사 0건** — SSOT 위임 (ADR-0185~0189 정합).
7. **buildSectorEnergyFromYahooETF 본체 무수정** — Phase 1 dead code 본체 그대로 활용 (ADR-0364 정합).
8. **macroState cache (L3) 우선순위 절대 보존** — Yahoo ETF (L4) 진입 전 cache 우선 시도.

## 잘못된 해결 방법 (영구 차단)

1. **L4 우선 시도** — KRX 정상 시점에도 Yahoo ETF 호출 (KRX SSOT 위배).
2. **`confidence × 0.5` 가중치 변경** — 사용자 명시 정책 SSOT 위배.
3. **`allowStrongBuy=true` 설정** — Yahoo ETF 는 보조 신호 한계.
4. **`dataQuality='OK'/'PARTIAL'` 부여** — `'DEGRADED'` 강제 정책 (사용자 명시).
5. **호출자 측 inline ENV 검사** — SSOT 위임 위배.
6. **buildSectorEnergyFromYahooETF 본체 변경** — Phase 1 dead code 안정성 위배.
7. **macroState cache (L3) skip + L4 직접 진입** — 호출 순서 SSOT 위배.

## 검증

- vitest **신규 ≥10 케이스** (heuristic 5/100 LoC 충족) — L4 wiring 분기 + applyYahooEtfDegradation + ENV gate + 호출 순서 검증.
- `npm run lint` EXIT=0 (변경 파일 자체).
- `npm run validate:all` 16종 baseline 무회귀.
- vitest 영향 영역 무회귀.
- `ALLOW_DEPLOY_WINDOW=1 npm run precommit` EXIT=0.

## 후속 PR (scope 외)

- **ADR-0398 (= 사용자 명시 0373)** — STRONG_BUY confidence gate (`forbidStrongBuy = sourceTier==='YAHOO_ETF' || dataQuality∈{DEGRADED,FAILED} || confidence<0.6`) + UI Language SSOT + `/sector_energy_diag` 명령.
