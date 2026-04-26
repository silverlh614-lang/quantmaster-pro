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
| `src/hooks/useAutoTradeContext.ts` | Map ClientMarketMode + KST time → AutoTradeContext 5-bucket SSOT (PRE_MARKET / LIVE_MARKET / POST_MARKET / OVERNIGHT / WEEKEND_HOLIDAY) — ADR-0043 |
| `src/components/autoTrading/AutoTradeContextSection.tsx` | Marker component — declares per-context priority/collapsed metadata as props, children pass through (ADR-0043) |
| `src/components/autoTrading/AutoTradeContextualLayout.tsx` | Stable-sort AutoTradeContextSection children by priorityByContext + render with collapse/hide policy (ADR-0043) |
| `server/health/survival.ts` | SurvivalSnapshot SSOT — 일일손실 + 섹터HHI + Kelly정합도 3 게이지 합성, 외부 호출 0건 (ADR-0044) |
| `server/routes/survivalRouter.ts` | GET /api/account/survival 엔드포인트 — collectSurvivalSnapshot read-only 노출 (ADR-0044) |
| `src/api/survivalClient.ts` | 클라이언트 동기 사본 + fetchAccountSurvival — 절대 규칙 #3 서버↔클라 직접 import 금지 (ADR-0044) |
| `src/components/autoTrading/AccountSurvivalGauge.tsx` | AutoTradePage 최상단 풀폭 위젯 — 3 게이지 카드 + tier 색상 + EMERGENCY 권고 박스 (ADR-0044) |
| `src/utils/invalidationConditions.ts` | 보유 포지션 4 카테고리 (손절가/손실/단계/목표) 무효화 조건 휴리스틱 평가 SSOT (ADR-0045) |
| `src/components/autoTrading/InvalidationMeter.tsx` | PositionLifecyclePanel 카드 인라인 미터 — 4 dot + tier 색상 + expand 4 조건 상세 (ADR-0045) |
| `server/routes/decisionInputsRouter.ts` | GET /api/decision/inputs — emergencyStop + pendingApprovals + macroSignals 합성 read-only (ADR-0046) |
| `src/api/decisionClient.ts` | DecisionInputs 타입 동기 사본 + fetchDecisionInputs (ADR-0046) |
| `src/utils/oneDecisionResolver.ts` | 6 case 우선순위 SSOT + VOID 4 조건 + computeVolatilityZScore 순수 함수 (ADR-0046) |
| `src/components/autoTrading/TodayOneDecisionCard.tsx` | AutoTradePage 최상단 단일 결정 카드 — 6 case + VOID 가운데 배치 (ADR-0046) |
| `src/api/learningClient.ts` | LearningStatusSnapshot 동기 사본 + fetchLearningStatus — /api/learning/status read-only (ADR-0047) |
| `src/components/autoTrading/NightlyReflectionCard.tsx` | Pro 모드 어젯밤 학습 카드 — verdict 이모지 + 카운트 + 편향 Top 3 + 누락 경고 (ADR-0047) |

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
- **Telegram callsite 시멘틱 별칭 + sendPickChannelAlert 삭제** (ADR-0039): PR-X3 부터 11 callsite 모두 `ChannelSemantic.{EXECUTION,SIGNAL,REGIME,JOURNAL}` 별칭 또는 `sendPrivateAlert` 사용. `sendPickChannelAlert` 함수는 호출자 0건 마이그레이션 후 telegramClient.ts 에서 삭제 — `TELEGRAM_PICK_CHANNEL_ID` legacy fallback 은 `alertRouter.resolveAnalysisChannelId()` 만 처리. `ChannelBoundary` 화이트리스트는 3 파일(alertRouter / alertCategories / check_channel_boundary)로 축소. `stockPickReporter` 의 sendPickChannelAlert + dispatchAlert(ANALYSIS) 이중 발송 제거 — `dispatchAlert(SIGNAL)` 단일 발송으로 통합. 옵션 정리: `tier`/`category`/`disableChannelNotification` legacy 필드는 dispatchAlert 호출 시 제거 (VIBRATION_POLICY 가 자동 처리), `priority`/`dedupeKey` 만 유지.
- **CH3 REGIME 매크로 다이제스트 정기 발행** (ADR-0040): `server/alerts/macroDigestReport.ts` 가 1일 2회 매크로 다이제스트를 `dispatchAlert(ChannelSemantic.REGIME)` 으로 발송한다. PRE_OPEN KST 08:30 (UTC 23:30 일~목) + POST_CLOSE KST 16:00 (UTC 07:00 월~금). 데이터는 `macroStateRepo.loadMacroState()` 단일 SSOT 만 읽음 — 외부 호출 0건 (다른 cron 이 갱신한 macroState 재사용). **개별 종목 정보 절대 포함 금지** — CH3 정체성은 "시장 전체 상태만". 회귀 테스트가 6자리 코드 패턴 부재 + 잔고 키워드 8종 부재를 자동 검증. dedupeKey `macro_digest:{mode}:{KST 일자}` 로 재시작 시 이중 발송 차단.
- **CH4 JOURNAL 주간 자기비판 리포트** (ADR-0041): `server/alerts/weeklySelfCritiqueReport.ts` 가 일요일 19:00 KST (UTC 10:00 Sun) 에 `dispatchAlert(ChannelSemantic.JOURNAL)` 으로 발송한다. 데이터: `aggregateFillStats(trades, range)` 주간 fill 통계 + `getLearningHistory(7).escalatingBiases` 편향 (3일 연속 ≥ 0.5) + `summarizeStopPatterns(weeklyStops)` 손절 패턴 분포 + `buildStopPatternRecommendation` 자동 권고. **개별 종목 정보 절대 포함 금지** (CH4 메타 학습 정체성) — 회귀 테스트가 6자리 코드 패턴 부재 + 잔고 키워드 8종 부재 자동 검증. 자동 권고 휴리스틱은 결정적 (Gemini 호출 0) — 표본 ≥ 3건 + 비율 ≥ 40% 임계 통과 시 R5_CAUTION/R6_DEFENSE/ATR_HARD_STOP/CASCADE 패턴별 권고문 생성. dedupeKey `weekly_self_critique:{KST 일요일}` 로 이중 발송 차단.
- **/channel_test 4채널 헬스체크 + 손절 카운트다운 sendPrivateAlert** (ADR-0042): `server/telegram/commands/alert/channelTest.cmd.ts` 가 `runChannelHealthCheck()` (alertRouter SSOT) 를 호출해 4채널(EXECUTION/SIGNAL/REGIME/JOURNAL) 동시 발송 후 결과 집계 — `formatChannelHealthCheckResult()` 순수 함수가 정상/미설정/비활성/발송실패 4분기 처리 + 미설정 환경변수 누적 안내. `stopApproachAlert` 손절 접근 3단계 경보(-5%/-3%/-1%)는 `sendTelegramAlert` → `sendPrivateAlert` 시멘틱 정합화 — 사용자 패닉 매도 차단 위해 CH1 EXECUTION 채널이 아닌 개인 DM 만 발송, 실제 손절 발동 시 channelSellSignal 이 사후 보고 (CH1).
- **NightlyReflectionCard boundary** (ADR-0047): `src/components/autoTrading/NightlyReflectionCard.tsx` 는 Pro 모드 한정 — `useSettingsStore.autoTradeViewMode === 'pro'` 일 때만 AutoTradePage 에서 렌더. 컨텍스트별 priority: POST_MARKET=2 / OVERNIGHT=3 / WEEKEND_HOLIDAY=2 / PRE_MARKET=5 / LIVE_MARKET=7 (collapsed). 본 카드는 *읽기 전용* — `keyLessons`/`tomorrowAdjustments` 본문은 카운트만 노출, 정독은 텔레그램 `/learning_status` SSOT 단일 채널 유도. ADR-0007 의 manual approval 채널 정합 유지. 향후 매뉴얼 승인 인프라(experimentProposals.AWAIT_APPROVAL) 도입 시 본 카드 위에 승인/거부 버튼 추가하여 텔레그램 SSOT 와 통합.
- **TodayOneDecisionCard boundary** (ADR-0046): `src/utils/oneDecisionResolver.ts` 가 6 case 우선순위 SSOT — EMERGENCY_STOP > DAILY_LOSS_EMERGENCY > INVALIDATED_POSITIONS > ACCOUNT_CRITICAL > PENDING_APPROVALS > VOID > MONITORING. 위→아래 첫 매칭 단락. 우선순위 변경은 ADR-0046 §2.1 표 갱신 + 회귀 테스트 동시 수정 의무. VOID 4 조건(높은 변동성 / 활성 포지션 0 / 승인 대기 0 / 거시 리스크) 모두 AND — 거짓 양성 차단. 변동성 z-score 는 vixHistory 우선, vkospiDayChange fallback, 둘 다 부재 시 0 (보수적). PR-Z2 (SurvivalSnapshot) + PR-Z3 (InvalidationMeter) 자산 100% 재활용 — 신규 영속 SSOT 0개. UI 위젯은 `<TodayOneDecisionCard>` 단일 — AutoTradePage 의 AutoTradeContextSection 안정 정렬로 AccountSurvivalGauge 보다 먼저 렌더 (children 선언 순서 보존).
- **InvalidationMeter boundary** (ADR-0045): `src/utils/invalidationConditions.ts` 가 4 카테고리 (STOP_LOSS_APPROACH / LOSS_THRESHOLD / STAGE_ESCALATION / TARGET_REACHED) 휴리스틱 평가 SSOT — `PositionItem` 의 *기존 필드* (stopLossPrice / pnlPct / stage / targetPrice1 / currentPrice) 만 사용. 외부 호출 0건. tier 임계 (0/1/≥2 metCount → OK/WARN/CRITICAL, evaluableCount=0 → NA) 변경은 ADR-0045 §2.3 표 갱신 + 회귀 테스트 동시 수정 의무. 매수 시점 무효화 조건의 영속 SSOT (ServerShadowTrade.invalidationConditions[]) 도입은 후속 PR — 본 PR 의 휴리스틱은 *근사값* 임을 명시. UI 위젯 `InvalidationMeter` 는 PositionLifecyclePanel 각 카드 내부에 임베드, AutoTradePage 본체 무수정.
- **AccountSurvivalGauge boundary** (ADR-0044): `server/health/survival.ts` 의 `collectSurvivalSnapshot()` 가 SurvivalSnapshot SSOT — 외부 호출 0건 (assessKillSwitch + evaluatePortfolioRisk + computeKellySurface + loadShadowTrades + loadMacroState 만 read). 신규 영속 SSOT 도입 금지 (peakEquity 영속 추적은 후속 PR). tier 임계값 (Daily Loss 50/25/0% buffer / Sector HHI 2500/4000 / Kelly ratio 1.0/1.5) 변경은 ADR-0044 §2.2 표 갱신 + 회귀 테스트 동시 수정 의무. UI 위젯 `AccountSurvivalGauge` 는 `src/api/survivalClient.ts` 단일 진입점 사용 — 절대 규칙 #3 (서버↔클라 직접 import 금지) 준수. AutoTradePage 통합은 PR-Z1 의 `AutoTradeContextSection` 으로 wrap, 모든 5 컨텍스트에서 priority=1.
- **AutoTradeContextualLayout boundary** (ADR-0043): `useAutoTradeContext()` 가 시각·MarketDataMode → 5 컨텍스트(PRE_MARKET / LIVE_MARKET / POST_MARKET / OVERNIGHT / WEEKEND_HOLIDAY) 매핑 SSOT. 각 자식 섹션은 `AutoTradeContextSection` 으로 wrap 되어 자기 `priorityByContext`/`collapsedByContext` 를 declare — 부모 `AutoTradeContextualLayout` 가 priority 오름차순 + 동률 originalIndex 안정 정렬 후 렌더. priority 9+ 는 hidden, collapsed=true 는 `<details>` 접힘. **기존 자식 컴포넌트 본체 무수정 원칙** — 신규 섹션 추가는 wrap 만으로. 비-AutoTradeContextSection children 은 정렬에서 제외 (별도 위치 배치 권장). Fragment 는 재귀 traverse 하여 조건부 렌더 (`{cond && <Section/>}`) 자연 동작.

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
