# ADR-0117: Sanity Trade-Block Gate (DataQuality Quarantine)

## 상태
승인 (2026-04-30)

## 배경

### 사용자 진단

> "지금 로그의 본질은 `safePctChange` 가 *경고기* 로만 작동하고 있다는 점.
> 위 패치의 목적은 `safePctChangeStrict` 를 *거래 차단 게이트* 로 승격시키는 것."

ADR-0028 `safePctChange` + ADR-0113 `safePctChangeDetailed` 가 sanity 위반 감지
+ tier 분류 + STALE_BASE marker 부착했지만, 호출자가 `?? 0` 또는 `?? null`
fallback 으로 silent degradation 가능. 결과적으로:
- `entryEngine.extensionPct` 가 sanity 위반 시 *조건 평가 스킵* (보수적) 만 수행
  → ok=true 반환 가능 → 진입 허용
- `watchlistManager.applyEntryPriceDrift` 가 KEEP 폴백 → entryPrice 박제
- `sizingTier` 는 dataQuality 입력 자체 부재 → 부정 가격으로 사이징 산출 가능

### 사용자 핵심 요구

sanity 위반 발생 시 **거래 차단 6 종**:
1. extensionPct 계산 중단
2. entryEngine WAIT / DATA_HOLD 반환
3. watchlist drift 업데이트 금지 + isDataQuarantined 마커
4. sizingTier BLOCKED 반환
5. tradeAllowed=false
6. sizePct=0

## 결정

### 1. `safePctChangeStrict` SSOT — 거래 차단 게이트

`server/utils/safePctChange.ts` 하단에 추가.

```typescript
export type SafePctStrictStatus =
  | 'OK'
  | 'STALE_BASE_OR_SPLIT_ADJUSTMENT'
  | 'ZERO_OR_INVALID_PRICE'
  | 'SOURCE_UNTRUSTED';

export function safePctChangeStrict(params: {
  current: number;
  base: number;
  source?: string;
  context: string;
  maxAbsPct?: number;
  forbidYahooHistorical?: boolean;
}): SafePctStrictResult;
```

블록 정책 SSOT:
- `current/base ≤ 0` 또는 NaN/Infinity → `ZERO_OR_INVALID_PRICE` + 3종 차단
- `|pct| > maxAbsPct` (default 90%) → `STALE_BASE_OR_SPLIT_ADJUSTMENT` + 3종 차단
- `source === 'YAHOO_HISTORICAL'` AND `forbidYahooHistorical=true` → `SOURCE_UNTRUSTED` + 3종 차단

ENV `DATA_QUALITY_STRICT_DISABLED=true` 우회 — 위반 시 ok=true + warn 로그만.
default OFF (정책 적용).

### 2. `DataQualityInfo` + `WaitReason` union (server/types)

```typescript
export interface DataQualityInfo {
  status: 'OK' | 'STALE_BASE_OR_SPLIT_ADJUSTMENT' | 'ZERO_OR_INVALID_PRICE' | 'SOURCE_UNTRUSTED';
  reason: string;
  current?: number; base?: number; source?: string; context?: string;
  updatedAt: string;
}

export type WaitReason =
  | 'PRE_BREAKOUT' | 'GATE_FAIL' | 'DATA_HOLD' | 'RISK_OFF'
  | 'NO_LAST_TRIGGER' | 'SIZING_BLOCKED';

export function shouldBlockTradingByDataQuality(dq?: DataQualityInfo): boolean;
```

`shouldBlockTradingByDataQuality` 공통 게이트 SSOT — entryEngine /
orchestrator / autoTradeEngine 최종 결정 직전 의무 사용.

### 3. entryEngine `evaluateEntryRevalidation` extensionPct wiring

기존 `safePctChange` 로 `extensionPct` 산출 → `safePctChangeStrict` 승격.
sanity 위반 시 즉시 `{ ok: false, reasons, dataQuality, waitReason: 'DATA_HOLD' }`
반환. `dropFromOpenPct` / `openGapPct` 는 본 PR scope 밖 (silent + 30% 자체 가드).

반환 타입에 `dataQuality?` + `waitReason?` 옵셔널 필드 추가 — 후방호환.

### 4. watchlistManager `applyEntryPriceDrift` — DATA_HOLD 분기

`safePctChangeStrict` 사용 → ok=false 시 새 반환 케이스 `'DATA_HOLD'` 추가.

`WatchlistEntry` 옵셔널 2 필드:
- `isDataQuarantined?: boolean`
- `dataQuality?: DataQualityInfo`

호출자(`perSymbolEvaluation`)가 'DATA_HOLD' 분기에서 entryPrice 갱신 금지 +
isDataQuarantined=true + dataQuality 영속.

### 5. sizingTier BLOCKED 분기

`SizingTierDeciderInput` 에 `dataQuality?: DataQualityInfo` 옵셔널 추가.
`shouldBlockTradingByDataQuality` 호출 후 위반 시 BLOCKED 반환:

```typescript
if (input.dataQuality && shouldBlockTradingByDataQuality(input.dataQuality)) {
  return {
    ok: false,
    logMessage: `[SizingTier] BLOCKED / DATA_QUARANTINE_${input.dataQuality.status}`,
    failReasons: [`DATA_QUARANTINE_${input.dataQuality.status}`],
  };
}
```

### 6. perSymbolEvaluation — DATA_HOLD 분기

`evaluateEntryRevalidation` 결과의 `result.waitReason === 'DATA_HOLD'` 시:
- console.log `[AutoTrade] {name}({code}) → WAIT / DATA_HOLD / {reason}` 형식
- failCount 증가 X (NON_CRITICAL — 다음 사이클 재시도)
- stageLog.gate = 'DATA_HOLD'
- pushTrace + continue

## 영향 범위

| 영역 | 변경 | 위험 |
|------|------|------|
| `safePctChangeStrict` 신규 SSOT | 신규 함수 | 외부 의존 0 |
| `DataQualityInfo` + `WaitReason` 타입 | 신규 타입 모듈 | 외부 의존 0 |
| `evaluateEntryRevalidation` 시그니처 | 옵셔널 2 필드 추가 | 후방호환 |
| `WatchlistEntry` schema | 옵셔널 2 필드 추가 | 후방호환 |
| `applyEntryPriceDrift` 반환 union | 'DATA_HOLD' 추가 | 호출자 1곳 wiring |
| `sizingTierDecider` | dataQuality 옵셔널 + BLOCKED 분기 | 입력 미전달 시 기존 동작 |
| `perSymbolEvaluation` | DATA_HOLD 분기 신규 | failCount 미증가 |
| ENV `DATA_QUALITY_STRICT_DISABLED` | 즉시 우회 가능 | — |
| LIVE 매매 본체 | 추가 안전 게이트 (의도된 차단) | — |

## 후속 PR (scope 외)

1. `evaluateEntryRevalidation` 의 `dropFromOpenPct` / `openGapPct` strict 승격
2. orchestrator / autoTradeEngine 최종 결정 직전 `shouldBlockTradingByDataQuality` wiring
3. 텔레그램 리포트 / 대시보드 UI 의 `dataQuality.status` 표시
4. 상태머신 정식 도입 (TradeSignalStatus union 확장)

## 참조
- ADR-0028 `safePctChange` — 본 ADR 의 base
- ADR-0113 `safePctChangeDetailed` — tier 분류 layer
- ADR-0115 / 0116 — entryPrice immutable + RAW/ADJUSTED 분리
- 사용자 18단계 설계안 §6 "Drift Sanity Hard Filter" + §15 "DATA_HOLD 상태"
