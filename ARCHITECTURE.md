# ARCHITECTURE.md

This document defines module boundaries to guide AI-assisted refactoring and serve as a code-review checklist.
When modifying any file, ensure changes stay within the owning module's stated responsibility.

---

## Module Boundaries

> **Path note**: `src/` contains frontend and shared source; `server/` (root-level) contains the standalone Express server (routes, clients).

| Module | Single Responsibility (<= 25 words) |
|--------|--------------------------------------|
| `src/services/quantEngine.ts` (gateEngine) | Evaluate Gate 0/1/2/3 conditions and compute final stock score |
| `src/services/quantEngine.ts` (bearEngine) | Execute bear-market strategies: seasonality, screener, Kelly, simulator |
| `src/services/stockService.ts` | Fetch and aggregate stock data from Yahoo Finance, DART, KIS, and Gemini |
| `src/services/autoTrading.ts` | Handle client-side manual-trigger trading: shadow trades, slippage, Kelly orders |
| `src/services/ecosService.ts` | Query Bank of Korea ECOS API for macro indicators: rate, FX, M2, GDP, trade |
| `src/utils/indicators.ts` | Compute technical indicators: RSI, MACD, Bollinger Bands, Ichimoku, VCP |
| `server/trading/signalScanner.ts` | Run 24/7 server-side automated signal scanning and trade execution via KIS order API |
| `server/quantFilter.ts` | Evaluate 8 server-side Gate conditions from Yahoo Finance data with adaptive weights |
| `server/clients/kisClient.ts` | Proxy all KIS API calls with token management and VTS/real switching |
| `server/routes/kisRouter.ts` | Expose REST endpoints that delegate KIS supply, short-selling, and order calls |
| `server/routes/autoTradeRouter.ts` | Expose REST endpoints for auto-trade control, watchlist management, and macro state |
| `server/trading/preMarketGapProbe.ts` | Compute pre-market gap from KIS previous close; classify as proceed/warn/skip by threshold |
| `server/orchestrator/tradingOrchestrator.ts` | Coordinate pre-market auction order prep via watchlist, gap probe, and gate re-evaluation |
| `server/services/aiUniverseService.ts` | Single channel for AI-recommendation universe discovery and enrichment via Google Search + Naver Finance (no KIS/KRX) |
| `server/clients/googleSearchClient.ts` | Proxy Google Custom Search JSON API with whitelist and daily budget guard |
| `server/clients/naverFinanceClient.ts` | Fetch Naver mobile finance snapshots for AI-recommendation enrichment |
| `server/persistence/krxStockMasterRepo.ts` | Persist KRX stock master (24h TTL) shared by AI recommendation and auto-trading |
| `server/services/multiSourceStockMaster.ts` | Orchestrate 4-tier fallback (KRX → Naver → Shadow → Seed) + validation + health updates (ADR-0013) |
| `server/persistence/stockMasterHealthRepo.ts` | Persist per-source health score (0-100) and rolling success/failure stats (ADR-0013) |
| `server/persistence/shadowMasterDb.ts` | Persist last-known-good stock master snapshot — only validated payloads (ADR-0013) |
| `server/clients/naverStockListClient.ts` | Fetch Naver mobile market-cap leaders as Tier 2 fallback (ADR-0013) |
| `server/data/stockMasterSeed.ts` | Hard-coded KOSPI/KOSDAQ leader seed — Tier 4 ultimate fallback (ADR-0013) |
| `server/health/diagnostics.ts` | Collect 8-axis system health snapshot — shared by /health Telegram cmd and /api/health/pipeline HTTP route |
| `src/components/market/MarketModeBanner.tsx` | Always-rendered top banner — MHS + Regime + VKOSPI + USD/KRW + allowed/forbidden trading policy (ADR-0018) |
| `src/components/common/DataQualityBadge.tsx` | Display computed/api/aiInferred count badge for stock card — heuristic fallback when server sourceTier metadata absent (ADR-0018) |
| `src/components/watchlist/GateStatusCard.tsx` | Compact read-only Gate 0/1/2/3 pass summary embedded in WatchlistCard (ADR-0018) |
| `src/types/ui.ts` | UI redesign P0-A shared types + REGIME_TRADING_POLICY SSOT for 6 regime levels (ADR-0018) |
| `src/utils/dataQualityClassifier.ts` | Compute DataQualityCount from StockRecommendation — heuristic fallback grouping 27 conditions into computed/api/aiInferred (ADR-0018) |
| `src/utils/regimeMapping.ts` | Map gate0Result.tradeRegime + bearRegimeResult into 6-level RegimeLevel for MarketModeBanner (ADR-0018) |
| `server/trading/exitEngine/index.ts` | Orchestrate exit evaluation — `_exitRunning` mutex + per-shadow loop + EXIT_RULES_IN_ORDER priority (ADR-0028) |
| `server/trading/exitEngine/types.ts` | ExitContext / ExitRuleResult / ExitRule signature SSOT (ADR-0028) |
| `server/trading/exitEngine/helpers/reserveSell.ts` | Record sell fill as SHADOW/PROVISIONAL/FAILED — `주문 접수 ≠ 체결` SSOT (ADR-0028) |
| `server/trading/exitEngine/helpers/rollbackFullClose.ts` | Capture and rollback shadow snapshot when full-close order fails (BUG #7, ADR-0028) |
| `server/trading/exitEngine/helpers/attribution.ts` | Emit partial attribution for SHADOW partial sell fills (PR-42 M1, ADR-0028) |
| `server/trading/exitEngine/helpers/rsiSeries.ts` | Wilder RSI series + bearish divergence detector pure functions (ADR-0028) |
| `server/trading/exitEngine/helpers/ma60.ts` | MA20/MA60 reversal judgement + KST business-day arithmetic + 120-day close fetcher (ADR-0028) |
| `server/trading/exitEngine/helpers/priceHistory.ts` | Yahoo symbol candidate generation + price/RSI history fetch helper (ADR-0028) |
| `server/trading/exitEngine/rules/*.ts` | One file per exit rule (16 rules) — byte-equivalent of original `_updateShadowResultsImpl` blocks (ADR-0028) |
| `server/screener/stockScreener.ts` | preScreenStocks (KIS 4-TR) + autoPopulateWatchlist (3-Preset) + getScreenerCache + barrel re-export (ADR-0029) |
| `server/screener/stockUniverse.ts` | KOSPI/KOSDAQ 워치리스트 발굴 시드 종목 마스터 데이터 상수 (ADR-0029) |
| `server/screener/rejectionLog.ts` | 워치리스트 자동 충전 시 탈락 사유 메모리 캐시 SSOT (ADR-0029) |
| `server/screener/watchlistRejectionReport.ts` | 워치리스트 탈락 사유 텔레그램 일괄 리포트 송출 (ADR-0029) |
| `server/screener/adapters/yahooQuoteAdapter.ts` | Yahoo Finance OHLCV+지표 시세 페칭 어댑터 — Yahoo 단일 통로 (ADR-0029) |
| `server/screener/adapters/kisQuoteAdapter.ts` | KIS 시세 + 일봉 캔들 → YahooQuoteExtended 호환 어댑터 (ADR-0029) |
| `server/screener/adapters/krxScreenerAdapter.ts` | KRX 투자자별 매매 폴백 스크리너 어댑터 (ADR-0029) |
| `server/screener/adapters/_indicators.ts` | Yahoo·KIS 어댑터 공용 RSI MACD EMA 지표 순수 계산 헬퍼 (ADR-0029) |

---

## Boundary Rules

- **gateEngine boundary**: Functions named `evaluateGate*`, `evaluateStock`, `computeSignalVerdict`, and related scoring helpers belong here. Do not add data-fetching or order logic.
- **bearEngine boundary**: Functions named `evaluateBear*`, `evaluateInverseGate*`, `evaluateMarketNeutral`, `evaluateIPS`, `evaluateFSS` belong here. Do not mix with bull-market Gate evaluation.
- **kisClient boundary**: All raw KIS REST calls (`kisGet`, `kisPost`, `getKisToken`) must go through this module. No other module may call the KIS API directly.
- **stockService boundary**: All external data fetches for **auto-trading and server-side screener** (Yahoo, DART, Gemini, KIS via proxy, KRX via proxy) originate here. quantEngine must not perform network requests.
- **aiUniverseService boundary**: All external data fetches for **AI-recommendation universe discovery and enrichment** originate here. KIS/KRX direct calls are forbidden — use `googleSearchClient` + `naverFinanceClient` + `krxStockMasterRepo` (the master repo's once-a-day KRX download is the only allowed KRX touchpoint). Auto-trading paths must not import this module.
- **autoTradeEngine boundary**: This is the sole channel for real order execution on the server. Client-side modules must not place live orders when `AUTO_TRADE_ENABLED=true`.
- **multiSourceStockMaster boundary**: AI-recommendation universe must refresh the master via this orchestrator only. Direct calls to `refreshKrxStockMaster()` are forbidden outside the orchestrator and its tests. Shadow DB must only be updated by validated Tier 1 / Tier 2 payloads.
- **diagnostics boundary**: `server/health/diagnostics.ts` is the SSOT for system health snapshot collection. `/health` Telegram cmd and `/api/health/pipeline` HTTP route must import `collectHealthSnapshot()` — they may not duplicate data-gathering. External probes (Yahoo/DART HTTP) belong in `runExternalProbes()` — keep them out of the snapshot core to keep the function pure for testing.
- **MarketModeBanner vs MarketRegimeBanner boundary** (ADR-0018): `MarketModeBanner` is **always rendered** and exposes the trading policy box (`REGIME_TRADING_POLICY` SSOT). `MarketRegimeBanner` is the **alert layer** that only renders during non-BULL or VKOSPI/Inverse Gate alerts. Both stack in `MarketOverviewHeader`. Do not merge — responsibilities differ.
- **DataQualityBadge vs ConfidenceBadge boundary** (ADR-0018): `ConfidenceBadge` shows the **single price source** (REALTIME/YAHOO/AI/STALE). `DataQualityBadge` shows the **27+1 condition source mix count** (computed/api/aiInferred). Both coexist on stock cards — no merge.
- **GateStatusCard vs GateStatusWidget boundary** (ADR-0018): `GateStatusCard` is the **compact read-only** version embedded in WatchlistCard (no expand/interaction). `GateStatusWidget` is the **full expandable** version inside StockDetailModal. Do not unify with prop modes — interaction code in card would balloon LoC.
- **REGIME_TRADING_POLICY SSOT**: All future code that maps `RegimeLevel` to allowed/forbidden trading strategies must import from `src/types/ui.ts`. Do not duplicate the 6-level table elsewhere.
- **exitEngine boundary** (ADR-0028): `server/trading/exitEngine.ts` is a barrel re-export only. All logic lives under `server/trading/exitEngine/`. Adding a new exit rule = create `rules/<name>.ts` exporting an `async (ctx: ExitContext) => Promise<ExitRuleResult>` + add to `EXIT_RULES_IN_ORDER` in `index.ts`. Rule files may NOT import other rule files — shared logic goes through `helpers/*`. The `_exitRunning` mutex (PR-6 #12) lives in `index.ts` only.
- **stockScreener boundary** (ADR-0029): `server/screener/stockScreener.ts` is a hybrid (core preScreenStocks + autoPopulateWatchlist) + barrel re-export of 6 split modules. Adding a new data source = create `adapters/<name>QuoteAdapter.ts` + barrel re-export. Adapters MUST NOT import other adapters — shared math goes through `adapters/_indicators.ts`. `YahooQuoteExtended` type lives in `yahooQuoteAdapter.ts` and is re-exported. `lastRejectionLog` mutable state lives in `rejectionLog.ts` only — accessed via `getLastRejectionLog`/`setLastRejectionLog` SSOT.
- **alertRouter SSOT + 채널 ID boundary** (ADR-0037): `server/alerts/alertRouter.ts` 는 텔레그램 4채널 발송 단일 진입점이다. `dispatchAlert(category, message, options?)` 외 경로로 채널 송출 금지. `process.env.TELEGRAM_{TRADE,ANALYSIS,INFO,SYSTEM,PICK}_CHANNEL_ID` 직접 접근은 `alertRouter.ts`/`alertCategories.ts`/`telegramClient.ts (LEGACY)` 외에서 금지 — `npm run validate:channelBoundary` 가 자동 차단. 신규 코드는 `ChannelSemantic.{EXECUTION,SIGNAL,REGIME,JOURNAL}` 시멘틱 별칭 사용 권장. 진동 정책은 `VIBRATION_POLICY` 매트릭스 SSOT 만 참조 — 호출자가 `disableNotification` 명시 시 override 우선, 미지정 시 정책 자동 적용.
- **개인 회선(DM) vs 채널 분리** (ADR-0038): 잔고/자산/비상정지/손절 접근/KIS 오류/EgressGuard 차단 같은 민감 정보는 채널이 아니라 `sendPrivateAlert(message, opts?)` (개인 DM 전용 SSOT) 로만 발송한다. 채널 발송 (`dispatchAlert`/`channelBuySignalEmitted` 등 12종 함수) 메시지 본문에 잔고 키워드(`총자산`/`주문가능현금`/`잔여 현금`/`보유자산`/`평가손익` 등 8종) 가 string literal 또는 template literal 안에 들어가면 `npm run validate:sensitiveAlerts` 가 자동 차단. `console.*(...)` (Railway 로그) / `throw new Error(...)` (예외 메시지) / 인라인 `// safe-channel-keyword` 주석은 의도적 예외 처리. `sendTelegramBroadcast` 는 PR-X2 부터 `@deprecated` — 신규 코드는 `sendPrivateAlert` 또는 `dispatchAlert` 사용.

---

## Planned Decompositions (advisory)

The following files currently exceed `scripts/check_complexity.js` thresholds. Their
planned decomposition is documented in `docs/adr/`. Until migration completes, the
current file continues to own the listed responsibility above.

| File | Lines | ADR | Planned sub-modules |
|------|------:|-----|---------------------|
| `server/trading/signalScanner.ts` | 1,820 | [ADR-0001](./docs/adr/0001-signalScanner-decomposition.md) | `signalScanner/{index,preflight,candidateSelect,perSymbolEvaluation,approvalQueue,scanDiagnostics}` |
| `server/telegram/webhookHandler.ts` | 1,700 | TBD (P1) | — |
| `server/screener/stockScreener.ts` | 1,571 | TBD (P1) | — |
| ~~`server/trading/exitEngine.ts`~~ | 18 (barrel) | [ADR-0028](./docs/adr/0028-exitEngine-decomposition.md) ✅ | `exitEngine/{index,types,helpers/*,rules/*}` 분해 완료 (PR-53) |

When implementing a decomposition, follow `.claude/skills/server-refactor-orchestrator/SKILL.md` 6-Phase flow and update this table.
