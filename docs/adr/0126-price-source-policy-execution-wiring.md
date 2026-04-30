# ADR-0126: Price Source Policy execution wiring — 매수 직전 final 방어선

**상태:** 채택 (PR-2, 2026-04-30)
**시리즈:** PR #442 후속 (사용자 명시 PR-2) — ADR-0121 인프라 위 wiring

## 컨텍스트

ADR-0121 (PR-C) 가 `evaluateDataQuality` + `shouldAllowExecution` SSOT 도입했지만 *호출자 wiring 부재*. 사용자 명시 후속 PR-2:

> ADR-0121은 아직 인프라입니다.
> 실제로 매수 직전에는 반드시 shouldAllowExecution(dataQuality) 가 들어가야 합니다.
> 아니면 Yahoo 강등 정책은 문서와 테스트만 있고 실행에는 영향이 없습니다.

## 결정

### 1. `toDataQualityInfo(result)` 매핑 SSOT

ADR-0121 의 `DataQualityResult` (6값 — VALID/WARN/INVALID/CORPORATE_ACTION_SUSPECT/STALE/MISSING) 를 ADR-0117 의 `DataQualityInfo` (4값 — OK/STALE_BASE_OR_SPLIT_ADJUSTMENT/ZERO_OR_INVALID_PRICE/SOURCE_UNTRUSTED) 로 매핑:

```
VALID/WARN                 → undefined (매수 허용, OK 등가)
INVALID                    → STALE_BASE_OR_SPLIT_ADJUSTMENT (괴리 10~30%)
CORPORATE_ACTION_SUSPECT   → STALE_BASE_OR_SPLIT_ADJUSTMENT (괴리 30%+, 액면분할)
STALE                      → SOURCE_UNTRUSTED (KIS 부재)
MISSING                    → ZERO_OR_INVALID_PRICE (둘 다 부재)
```

`shouldBlockTradingByDataQuality(dq)` 가 자동 sizingTier BLOCKED 트리거.

### 2. `evaluateDataQualityFromStock(stock, currentPrice, context?)` 합성 SSOT

호출자가 한 줄로 평가:
- `stock.priceKrw` (Yahoo 가격)
- `currentPrice` (KIS 실시간 현재가)
- → `DataQualityInfo | undefined` 반환
- ENV `PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED=true` 시 즉시 undefined (gate 무력화)

### 3. perSymbolEvaluation 매수 직전 wiring

`sizingTierDecider` 호출 직전 (final candidate 결정 위치) 에 가드 추가:

```typescript
const priceSourceDataQuality = evaluateDataQualityFromStock(
  { priceKrw: stock.priceKrw ?? null },
  currentPrice,
  `final-candidate:${stock.code}`,
);
const mergedDataQuality = stock.dataQuality ?? priceSourceDataQuality;

const tierResult = sizingTierDecider({
  ...,
  dataQuality: mergedDataQuality,
});
```

**우선순위**: 기존 `stock.dataQuality` (ADR-0117 drift sanity) > `priceSourceDataQuality` (ADR-0126 신규). 둘 다 있으면 drift sanity 우선 — 기존 회귀 보호.

### 4. ENV 비상 우회

`PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED=true` — 신규 wiring 무력화. 회귀 분석 시 기존 동작 (priceSource 게이트 부재) 즉시 복원.

### 5. 사용자 §4 매수 차단 정책 정합

```
if (!shouldAllowExecution(dataQuality)) {
  tradeAllowed = false
  sizePct = 0
  waitReason = DATA_HOLD
}
```

위 정책이 **sizingTierDecider BLOCKED 분기로 자동 활성**:
- `tierResult.ok = false`
- `tierResult.logMessage` 에 `DATA_QUARANTINE_${status}` 포함
- `scanCounters.waitSizingBlocked++` (ADR-0118 PR-Z18)
- `continue` → 매수 진입 차단

## 결과

### 변경 파일

- `server/trading/priceSourcePolicy.ts` (+toDataQualityInfo + evaluateDataQualityFromStock + isPriceSourceExecutionGateDisabled)
- `server/trading/priceSourcePolicyAdr0126.test.ts` (신규 22 케이스)
- `server/trading/signalScanner/perSymbolEvaluation.ts` (sizingTierDecider 호출에 mergedDataQuality 인자 + import)

### 검증

- vitest server/trading **107/107 pass** (신규 22 + 기존 priceSourcePolicy/sectorScoreBoost 무회귀)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 — sizingTierDecider 입력 dataQuality 추가. ENV 1줄 우회 가능

### 운영 효과

- **1차 로그 098460 +221% 시나리오 자동 차단**: KIS=15000 + Yahoo=48150 → CORPORATE_ACTION_SUSPECT → DataQualityInfo.status = STALE_BASE_OR_SPLIT_ADJUSTMENT → sizingTier BLOCKED → 매수 진입 차단 + waitSizingBlocked++ + emptyScanReason 분류 (ADR-0118 → ORDER_BLOCKED 또는 PR-3 후 DATA_INVALID 가중)
- **drift sanity 우선순위 보존**: 기존 ADR-0117 의 stock.dataQuality 가 있으면 그것 우선 사용 — 기존 회귀 100% 보호
- **ENV 비상 우회**: false positive 발생 시 즉시 무력화 가능

### 후속 PR

- **PR-3**: ScanSummary 에 sectorEnergyQuality? 추가 + /scan_blockers 노출 + emptyScanReason DATA_INVALID 가중
- 추가 wiring (사용자 명시 위치) 별도 PR — entryEngine / orderDispatch / autoTradeEngine / watchlist drift update — 회귀 위험 격리 위해 분리
