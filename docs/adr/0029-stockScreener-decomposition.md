# ADR-0029 — stockScreener.ts decomposition (data + adapters + core)

- **Status**: Accepted (2026-04-26)
- **Owner**: server-refactor-orchestrator (engine-dev + quality-guard)

## Context

`server/screener/stockScreener.ts` 는 1,573 줄까지 비대해졌다. CLAUDE.md "복잡도 위반" 표 기준 P1 우선순위. 한 파일에 다음 4 종 책임이 비계층화되어 있다:

1. **데이터 상수** — `STOCK_UNIVERSE` (260+ 종목 KOSPI/KOSDAQ 시드 배열, 라인 148~407 ~260줄)
2. **외부 어댑터** 3종 — Yahoo/KIS/KRX 시세 페칭 + OHLCV → YahooQuoteExtended 변환
   - `fetchYahooQuote` (라인 1032~1290, ~258줄) + 보조 RSI/MACD/EMA helpers
   - `fetchKisQuoteFallback` + `fetchKisIntraday` + `enrichQuoteWithKisMTAS` + `buildExtendedFromKisDaily` (라인 736~1031 + 1291~1341, ~350줄)
   - `fetchKrxScreenerFallback` (라인 691~727, ~37줄)
3. **부수 영속 / 운영** — `RejectionEntry` + `getLastRejectionLog` + `sendWatchlistRejectionReport` (~80줄)
4. **핵심 로직** — `preScreenStocks` (KIS 4-TR 병렬 스크리너) + `autoPopulateWatchlist` (시간대별 3-Preset 워치리스트 자동 충전) + `getScreenerCache` (~470줄)

24 개 외부 importer 가 다음 심볼을 사용 중:
- `fetchYahooQuote` / `fetchKisQuoteFallback` / `enrichQuoteWithKisMTAS` / `fetchKisIntraday` (signalScanner / dryRunScanner / buyPipeline / trancheExecutor / signalScanner/perSymbolEvaluation / intradayScanner / universeScanner / shadowDataGate / stockPickReporter / prefetchedContext)
- `STOCK_UNIVERSE` (telegram add.cmd / dynamicUniverseExpander / intradayScanner / universeScanner / shadowDataGate)
- `YahooQuoteExtended` 타입 (quantFilter / confluenceEngine / buyPipeline / quant/conditions/types / pipelineHelpers / intradayScanner / stage1Audit)
- `getScreenerCache` (intradayScanner / stockPickReporter)
- `preScreenStocks` / `autoPopulateWatchlist` / `sendWatchlistRejectionReport` (tradingOrchestrator)

## Decision

`server/screener/` 아래로 데이터·어댑터·로직을 7 개 파일로 분리. 외부 importer 무수정 — `stockScreener.ts` 가 barrel 역할을 겸한다 (PR-53 패턴 차용).

```
server/screener/
├── stockScreener.ts                      # 핵심 로직(~600줄): preScreenStocks +
│                                         # autoPopulateWatchlist + getScreenerCache +
│                                         # 분해된 모듈 barrel re-export
├── stockUniverse.ts                      # STOCK_UNIVERSE 데이터 상수 (~260줄, 데이터-only)
├── rejectionLog.ts                       # RejectionEntry + getLastRejectionLog +
│                                         # setLastRejectionLog (~30줄)
├── watchlistRejectionReport.ts           # sendWatchlistRejectionReport (~50줄)
└── adapters/
    ├── yahooQuoteAdapter.ts              # fetchYahooQuote + RSI/MACD/EMA helpers +
    │                                     # YahooQuoteExtended 타입 (~350줄)
    ├── kisQuoteAdapter.ts                # fetchKisQuoteFallback + fetchKisIntraday +
    │                                     # enrichQuoteWithKisMTAS + buildExtendedFromKisDaily (~360줄)
    └── krxScreenerAdapter.ts             # fetchKrxScreenerFallback (~50줄)
```

### Module @responsibility 초안

- **stockUniverse.ts**: `KOSPI/KOSDAQ 워치리스트 발굴 시드 종목 마스터 데이터 상수`
- **rejectionLog.ts**: `워치리스트 자동 충전 시 탈락 사유 메모리 캐시 SSOT`
- **watchlistRejectionReport.ts**: `워치리스트 탈락 사유 텔레그램 일괄 리포트 송출`
- **adapters/yahooQuoteAdapter.ts**: `Yahoo Finance OHLCV+지표 시세 페칭 어댑터 — Yahoo 단일 통로`
- **adapters/kisQuoteAdapter.ts**: `KIS 시세 + 일봉 캔들 → YahooQuoteExtended 호환 어댑터`
- **adapters/krxScreenerAdapter.ts**: `KRX 투자자별 매매 폴백 스크리너 어댑터`
- **stockScreener.ts**: `사전 스크리너 + 시간대별 3-Preset 워치리스트 자동 충전 핵심 로직 + barrel`

## Consequences

- **외부 importer 무수정**: 24 importer 의 `'./screener/stockScreener.js'` 경로 보존. 분해된 7 파일의 export 는 stockScreener.ts barrel 에서 모두 re-export.
- **타입 SSOT**: `YahooQuoteExtended` 는 `adapters/yahooQuoteAdapter.ts` 에 정의 + `stockScreener.ts` 에서 re-export. 7 importer 는 `YahooQuoteExtended` 만 가져가므로 영향 없음.
- **테스트 커버리지**: 기존 `stage1Audit.test.ts` / `intradayScanner.test.ts` / `dynamicUniverseExpander.test.ts` / `prefetchedContext.test.ts` / `conditionRegistry.test.ts` 의 import 경로 무수정.
- **단위 테스트 가능**: 어댑터 mock 으로 `autoPopulateWatchlist` / `preScreenStocks` 단위 테스트 가능 (후속 PR).
- **새 데이터 소스 추가**: ADR-0013 multi-source 4-tier fallback 사상과 정렬 — `adapters/` 디렉토리에 파일 1개 추가 + barrel re-export 로 끝.
- **복잡도**: 모든 신규 파일 1,500 줄 임계 안. stockScreener.ts ≈ 600 줄로 축소.

## Alternatives Considered

1. **분해 안 함** — 거부. 1,573 줄 → 다음 시드 추가 시 임계 위반 임박. 어댑터 단위 테스트 불가.
2. **types.ts 별도 파일** — 거부. `YahooQuoteExtended` 는 fetchYahooQuote 의 반환 타입이라 어댑터 옆이 자연. 별도 types 파일은 의미 없는 간접화.
3. **adapters/ 평탄화 (디렉토리 없이 파일만)** — 거부. 3 개 어댑터가 향후 (Naver Mobile / DART OHLCV) 더 늘어날 가능성 → 디렉토리가 자연스러운 그룹.
4. **preScreenStocks 추가 분해** — 본 PR scope 밖. KIS 4-TR 병렬 호출 본체 (~265줄) 는 단일 책임이라 그대로 유지. 향후 별도 ADR 로 진행.

## Migration Plan

1. **Phase 1** (본 PR): ADR-0029 작성.
2. **Phase 2** (본 PR): 빈 파일 + @responsibility 태그 + 이동 플랜 체크리스트.
3. **Phase 3a**: `stockUniverse.ts` 분리 (데이터-only, 가장 안전). `STOCK_UNIVERSE` 만 이동, 본체는 import + re-export.
4. **Phase 3b**: `rejectionLog.ts` 분리. `lastRejectionLog` module-local 변수를 module 내부로 캡슐화 + `setLastRejectionLog(entries)` setter 신설 (autoPopulateWatchlist 가 호출).
5. **Phase 3c**: `watchlistRejectionReport.ts` 분리.
6. **Phase 3d**: `adapters/yahooQuoteAdapter.ts` 분리 — RSI/MACD/EMA 보조 함수 + YahooQuoteExtended 타입 + fetchYahooQuote.
7. **Phase 3e**: `adapters/kisQuoteAdapter.ts` 분리 — buildExtendedFromKisDaily + fetchKisQuoteFallback + fetchKisIntraday + enrichQuoteWithKisMTAS.
8. **Phase 3f**: `adapters/krxScreenerAdapter.ts` 분리 — fetchKrxScreenerFallback.
9. **Phase 4**: stockScreener.ts 본체 정리 — 분해된 6 파일 import + barrel re-export. preScreenStocks + autoPopulateWatchlist + getScreenerCache 만 본 파일에 남김.
10. **Phase 5**: vitest server/screener + 외부 importer 영향 검증 + validate:all + precommit.
11. **Phase 6**: CLAUDE.md "복잡도 위반" 표 P1 항목 정식 제거 + ARCHITECTURE.md +6 boundary + 변경 이력.

## Boundary Rules

- **stockService 단일 통로**: 자동매매·서버 스크리너의 외부 데이터 페칭은 본 분해 후에도 `stockScreener.ts` (barrel) 또는 `adapters/*` 를 직접 import — 양쪽 다 허용. 신규 importer 는 직접 어댑터 import 권장.
- **kisClient 단일 통로**: `adapters/kisQuoteAdapter.ts` 는 `realDataKisGet` / `kisChartDataFetcher` 만 사용. raw KIS REST 호출 0건.
- **adapters 간 import 금지**: 각 어댑터는 독립적이어야 한다. yahooQuoteAdapter 가 kisQuoteAdapter 를 import 하지 않는다 (지표 계산 helper 는 yahooQuoteAdapter 안에 자체 보유).
- **barrel re-export**: stockScreener.ts 가 분해된 6 파일의 모든 public export 를 다시 export — 외부 24 importer 무수정 보장.
