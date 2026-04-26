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
| `server/utils/marketDayClassifier.ts` | KRX 영업일 7분기 분류 SSOT — 자기학습·스케줄러·매매 보수 모드 단일 컨텍스트 (ADR-0043) |
| `server/scheduler/scheduleGuard.ts` | cron 콜백 자동 가드 래퍼 — ScheduleClass 별 영업일/주말 차단 + 메트릭 기록 (ADR-0043) |
| `server/learning/learningDataValidator.ts` | 학습 입력 영업일 검증 — 비영업일 레코드 자동 필터링·거부 진단 헬퍼 (ADR-0043) |
| `server/trading/holidayResumePolicy.ts` | 연휴 복귀 첫 영업일 보수 매매 정책 SSOT — Kelly 축소 + Gate 상향 + 시초 진입 차단 (ADR-0044) |
| `server/trading/holidayResumeAlert.ts` | 연휴 복귀 보수 모드 텔레그램 알림 cron 함수 — 09:05 KST 평일 발송 (ADR-0044) |
| `server/persistence/krxHolidayRepo.ts` | KRX 휴장일 patch 영속 — 운영자 차년도 추가 휴장일 디스크 저장·idempotent (ADR-0045) |
| `server/trading/krxHolidayAudit.ts` | KRX 차년도 휴장일 등록 감사 — 매년 12/1 cron, 미달 시 CRITICAL 텔레그램 (ADR-0045) |
| `src/services/quant/f2wDriftDetector.ts` | F2W 가중치 σ 변화 감시 — drift 감지 시 LIVE 학습 일시정지 SSOT (ADR-0046) |
| `server/alerts/f2wDriftAlert.ts` | 클라이언트 F2W drift POST 진입점 — dispatchAlert(JOURNAL) + sendPrivateAlert 일괄 (ADR-0046) |
| `server/persistence/reflectionImpactRepo.ts` | 13개 reflection 모듈 일자별 meaningful boolean 영속 — 1년 ring buffer (ADR-0047) |
| `server/learning/reflectionImpactPolicy.ts` | reflection 모듈 status (normal/grace/silent/deprecated) 판정 SSOT — 임계 5%/1% (ADR-0047) |
| `server/learning/reflectionImpactRecorder.ts` | nightlyReflection report 로부터 13 모듈 meaningful 추론·일괄 영속 헬퍼 (ADR-0047) |
| `src/services/quant/learningCoverage.ts` | F2W 학습 (조건 × 레짐) 셀 카운트 SSOT — 30건 미만 셀 가중치 보정 차단 (ADR-0048) |
| `src/hooks/useAutoTradeContext.ts` | Map ClientMarketMode + KST time → AutoTradeContext 5-bucket SSOT (PRE_MARKET / LIVE_MARKET / POST_MARKET / OVERNIGHT / WEEKEND_HOLIDAY) — ADR-0049 |
| `src/components/autoTrading/AutoTradeContextSection.tsx` | Marker component — declares per-context priority/collapsed metadata as props, children pass through (ADR-0049) |
| `src/components/autoTrading/AutoTradeContextualLayout.tsx` | Stable-sort AutoTradeContextSection children by priorityByContext + render with collapse/hide policy (ADR-0049) |
| `server/health/survival.ts` | SurvivalSnapshot SSOT — 일일손실 + 섹터HHI + Kelly정합도 3 게이지 합성, 외부 호출 0건 (ADR-0050) |
| `server/routes/survivalRouter.ts` | GET /api/account/survival 엔드포인트 — collectSurvivalSnapshot read-only 노출 (ADR-0050) |
| `src/api/survivalClient.ts` | 클라이언트 동기 사본 + fetchAccountSurvival — 절대 규칙 #3 서버↔클라 직접 import 금지 (ADR-0050) |
| `src/components/autoTrading/AccountSurvivalGauge.tsx` | AutoTradePage 최상단 풀폭 위젯 — 3 게이지 카드 + tier 색상 + EMERGENCY 권고 박스 (ADR-0050) |
| `src/utils/invalidationConditions.ts` | 보유 포지션 4 카테고리 (손절가/손실/단계/목표) 무효화 조건 휴리스틱 평가 SSOT (ADR-0051) |
| `src/components/autoTrading/InvalidationMeter.tsx` | PositionLifecyclePanel 카드 인라인 미터 — 4 dot + tier 색상 + expand 4 조건 상세 (ADR-0051) |
| `server/routes/decisionInputsRouter.ts` | GET /api/decision/inputs — emergencyStop + pendingApprovals + macroSignals 합성 read-only (ADR-0052) |
| `src/api/decisionClient.ts` | DecisionInputs 타입 동기 사본 + fetchDecisionInputs (ADR-0052) |
| `src/utils/oneDecisionResolver.ts` | 6 case 우선순위 SSOT + VOID 4 조건 + computeVolatilityZScore 순수 함수 (ADR-0052) |
| `src/components/autoTrading/TodayOneDecisionCard.tsx` | AutoTradePage 최상단 단일 결정 카드 — 6 case + VOID 가운데 배치 (ADR-0052) |
| `src/api/learningClient.ts` | LearningStatusSnapshot 동기 사본 + fetchLearningStatus — /api/learning/status read-only (ADR-0053) |
| `src/components/autoTrading/NightlyReflectionCard.tsx` | Pro 모드 어젯밤 학습 카드 — verdict 이모지 + 카운트 + 편향 Top 3 + 누락 경고 (ADR-0053) |
| `server/learning/conditionSourceMap.ts` | 27 조건 COMPUTED/AI 분류 + classifyTier SSOT — 클라 evolutionEngine 동기 사본 (ADR-0054) |
| `src/api/concordanceClient.ts` | ConcordanceMatrix 동기 사본 + fetchAttributionConcordance (ADR-0054) |
| `src/components/analysis/ConcordanceMatrix.tsx` | RecommendationHistoryPage 5×5 합치도 매트릭스 — diagonal vs off-diagonal 메타 룰 (ADR-0054) |
| `src/utils/gateMiniIndicator.ts` | 4-Gate 미니 인디케이터 평가 SSOT — PR-A buildGateCardSummary 재활용, 4-tier 분류 (ADR-0055) |
| `src/components/watchlist/GateMiniIndicator.tsx` | WatchlistCard 헤더 우상단 4 dot 미니 인디케이터 — 즉시 인지용 (ADR-0055) |
| `server/utils/yahooProbeRetry.ts` | Yahoo 다중 호스트 재시도 + 다중 심볼 probe 헬퍼 SSOT — 미래 확장점 (ADR-0056) |

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
- **marketDayClassifier boundary** (ADR-0043): `server/utils/marketDayClassifier.ts` 는 KRX 영업일 7분기(TRADING_DAY/WEEKEND/KRX_HOLIDAY/PRE_HOLIDAY/POST_HOLIDAY/LONG_HOLIDAY_*) 분류 + 다음/이전 영업일 산술 SSOT. `KRX_HOLIDAYS` Set 직접 import 금지 — `isKrxHoliday()` 또는 `getMarketDayContext()` 만 사용. 외부 의존(state/persistence)을 도입하지 않는 순수 모듈로 유지.
- **krxHolidays boundary** (ADR-0045): `server/trading/krxHolidays.ts` 의 `KRX_HOLIDAYS` 는 `STATIC_HOLIDAYS` (정적 fallback) + `krxHolidayRepo` patch (영속) 합집합 ReadonlySet. 부팅 시 `reloadKrxHolidaySet()` 1회 호출 필수 — `maintenanceJobs.registerMaintenanceJobs()` 가 담당. 외부 호출자(`trancheExecutor` 포함) 는 인스턴스가 동일하므로 자동 반영. `STATIC_HOLIDAYS` 직접 import 금지 — `getStaticKrxHolidays()` view 사용.
- **holidayResumePolicy boundary** (ADR-0044): `server/trading/holidayResumePolicy.ts` 는 연휴 복귀 첫 영업일 보수 매매 정책 SSOT. `BudgetPolicy`(ADR-0036) 와 별개 운영 — `kellyMultiplier` 는 BudgetPolicy 의 `fractionalKellyCap` 위에 곱해지는 추가 축소 계수, `gateScoreBoost` 는 `ENTRY_MIN_GATE_SCORE` 위에 더하는 추가 임계. 호출자가 명시적으로 `apply*` 헬퍼를 호출해야 효과 발동 (LIVE 매매 본체 0줄 변경 보장). 외부 의존성 marketDayClassifier 만 import — state/persistence/clients import 금지.
- **scheduleGuard boundary** (ADR-0043): `scheduledJob(cronExpr, ScheduleClass, jobName, fn)` 래퍼는 `cron.schedule` 의 단일 진입점. 신규 cron 등록 시 ScheduleClass 명시 필수 (TRADING_DAY_ONLY/WEEKEND_MAINTENANCE/MARKET_ADJACENT/ALWAYS_ON 4값). cron 표현식 `1-5`/`0-4` 평일 가드는 1차 방어선, ScheduleClass 가 KRX 공휴일을 평일에 차단하는 진짜 방어선.
- **stockScreener boundary** (ADR-0029): `server/screener/stockScreener.ts` is a hybrid (core preScreenStocks + autoPopulateWatchlist) + barrel re-export of 6 split modules. Adding a new data source = create `adapters/<name>QuoteAdapter.ts` + barrel re-export. Adapters MUST NOT import other adapters — shared math goes through `adapters/_indicators.ts`. `YahooQuoteExtended` type lives in `yahooQuoteAdapter.ts` and is re-exported. `lastRejectionLog` mutable state lives in `rejectionLog.ts` only — accessed via `getLastRejectionLog`/`setLastRejectionLog` SSOT.
- **alertRouter SSOT + 채널 ID boundary** (ADR-0037): `server/alerts/alertRouter.ts` 는 텔레그램 4채널 발송 단일 진입점이다. `dispatchAlert(category, message, options?)` 외 경로로 채널 송출 금지. `process.env.TELEGRAM_{TRADE,ANALYSIS,INFO,SYSTEM,PICK}_CHANNEL_ID` 직접 접근은 `alertRouter.ts`/`alertCategories.ts`/`telegramClient.ts (LEGACY)` 외에서 금지 — `npm run validate:channelBoundary` 가 자동 차단. 신규 코드는 `ChannelSemantic.{EXECUTION,SIGNAL,REGIME,JOURNAL}` 시멘틱 별칭 사용 권장. 진동 정책은 `VIBRATION_POLICY` 매트릭스 SSOT 만 참조 — 호출자가 `disableNotification` 명시 시 override 우선, 미지정 시 정책 자동 적용.
- **개인 회선(DM) vs 채널 분리** (ADR-0038): 잔고/자산/비상정지/손절 접근/KIS 오류/EgressGuard 차단 같은 민감 정보는 채널이 아니라 `sendPrivateAlert(message, opts?)` (개인 DM 전용 SSOT) 로만 발송한다. 채널 발송 (`dispatchAlert`/`channelBuySignalEmitted` 등 12종 함수) 메시지 본문에 잔고 키워드(`총자산`/`주문가능현금`/`잔여 현금`/`보유자산`/`평가손익` 등 8종) 가 string literal 또는 template literal 안에 들어가면 `npm run validate:sensitiveAlerts` 가 자동 차단. `console.*(...)` (Railway 로그) / `throw new Error(...)` (예외 메시지) / 인라인 `// safe-channel-keyword` 주석은 의도적 예외 처리. `sendTelegramBroadcast` 는 PR-X2 부터 `@deprecated` — 신규 코드는 `sendPrivateAlert` 또는 `dispatchAlert` 사용.
- **Telegram callsite 시멘틱 별칭 + sendPickChannelAlert 삭제** (ADR-0039): PR-X3 부터 11 callsite 모두 `ChannelSemantic.{EXECUTION,SIGNAL,REGIME,JOURNAL}` 별칭 또는 `sendPrivateAlert` 사용. `sendPickChannelAlert` 함수는 호출자 0건 마이그레이션 후 telegramClient.ts 에서 삭제 — `TELEGRAM_PICK_CHANNEL_ID` legacy fallback 은 `alertRouter.resolveAnalysisChannelId()` 만 처리. `ChannelBoundary` 화이트리스트는 3 파일(alertRouter / alertCategories / check_channel_boundary)로 축소. `stockPickReporter` 의 sendPickChannelAlert + dispatchAlert(ANALYSIS) 이중 발송 제거 — `dispatchAlert(SIGNAL)` 단일 발송으로 통합. 옵션 정리: `tier`/`category`/`disableChannelNotification` legacy 필드는 dispatchAlert 호출 시 제거 (VIBRATION_POLICY 가 자동 처리), `priority`/`dedupeKey` 만 유지.
- **CH3 REGIME 매크로 다이제스트 정기 발행** (ADR-0040): `server/alerts/macroDigestReport.ts` 가 1일 2회 매크로 다이제스트를 `dispatchAlert(ChannelSemantic.REGIME)` 으로 발송한다. PRE_OPEN KST 08:30 (UTC 23:30 일~목) + POST_CLOSE KST 16:00 (UTC 07:00 월~금). 데이터는 `macroStateRepo.loadMacroState()` 단일 SSOT 만 읽음 — 외부 호출 0건 (다른 cron 이 갱신한 macroState 재사용). **개별 종목 정보 절대 포함 금지** — CH3 정체성은 "시장 전체 상태만". 회귀 테스트가 6자리 코드 패턴 부재 + 잔고 키워드 8종 부재를 자동 검증. dedupeKey `macro_digest:{mode}:{KST 일자}` 로 재시작 시 이중 발송 차단.
- **CH4 JOURNAL 주간 자기비판 리포트** (ADR-0041): `server/alerts/weeklySelfCritiqueReport.ts` 가 일요일 19:00 KST (UTC 10:00 Sun) 에 `dispatchAlert(ChannelSemantic.JOURNAL)` 으로 발송한다. 데이터: `aggregateFillStats(trades, range)` 주간 fill 통계 + `getLearningHistory(7).escalatingBiases` 편향 (3일 연속 ≥ 0.5) + `summarizeStopPatterns(weeklyStops)` 손절 패턴 분포 + `buildStopPatternRecommendation` 자동 권고. **개별 종목 정보 절대 포함 금지** (CH4 메타 학습 정체성) — 회귀 테스트가 6자리 코드 패턴 부재 + 잔고 키워드 8종 부재 자동 검증. 자동 권고 휴리스틱은 결정적 (Gemini 호출 0) — 표본 ≥ 3건 + 비율 ≥ 40% 임계 통과 시 R5_CAUTION/R6_DEFENSE/ATR_HARD_STOP/CASCADE 패턴별 권고문 생성. dedupeKey `weekly_self_critique:{KST 일요일}` 로 이중 발송 차단.
- **/channel_test 4채널 헬스체크 + 손절 카운트다운 sendPrivateAlert** (ADR-0042): `server/telegram/commands/alert/channelTest.cmd.ts` 가 `runChannelHealthCheck()` (alertRouter SSOT) 를 호출해 4채널(EXECUTION/SIGNAL/REGIME/JOURNAL) 동시 발송 후 결과 집계 — `formatChannelHealthCheckResult()` 순수 함수가 정상/미설정/비활성/발송실패 4분기 처리 + 미설정 환경변수 누적 안내. `stopApproachAlert` 손절 접근 3단계 경보(-5%/-3%/-1%)는 `sendTelegramAlert` → `sendPrivateAlert` 시멘틱 정합화 — 사용자 패닉 매도 차단 위해 CH1 EXECUTION 채널이 아닌 개인 DM 만 발송, 실제 손절 발동 시 channelSellSignal 이 사후 보고 (CH1).
- **F2W Drift Detector boundary** (ADR-0046): `src/services/quant/f2wDriftDetector.ts` 는 자기학습 가중치 σ 변화 감시 SSOT. `feedbackLoopEngine.evaluateFeedbackLoop` 진입부 가드 외에서 `pauseF2W` / `clearF2WPause` 호출 금지 — 운영자 수동 해제는 별도 텔레그램 명령 (`/clear_f2w_pause` 후속 PR) 으로만. shadow=true 호출은 본 가드 우회 (ADR-0027 grace 보존). drift 감지 시 클라이언트가 `POST /api/learning/f2w-drift-alert` → `server/alerts/f2wDriftAlert.ts` 가 `dispatchAlert(ChannelSemantic.JOURNAL)` + `sendPrivateAlert` 일괄 발송. 클라이언트 측 모듈은 server/alerts import 금지 — fetch HTTP 경계만 사용. **개별 종목 정보 절대 포함 금지** (CH4 JOURNAL 정체성) — 회귀 테스트가 6자리 코드 패턴 부재 + 잔고 키워드 8종 부재 자동 검증. `LEARNING_F2W_DRIFT_DISABLED=true` 환경변수로 전체 회로 무력화 가능 — 사고 조사 시 임시 우회 경로.
- **Learning Coverage Heatmap boundary** (ADR-0048): `src/services/quant/learningCoverage.ts` 는 F2W (조건 × 레짐) 셀 카운트 SSOT — 27 × 7 = 189 셀. `feedbackLoopEngine.evaluateFeedbackLoop` 진입부 가드: 어떤 셀도 `COVERAGE_THRESHOLD=30` 미만이면 해당 조건 가중치 보정 스킵 (`coverageGated[]` 결과 노출). entryRegime 부재 v1 레코드는 `FALLBACK_REGIME='UNCERTAIN'` 그룹화. shadow=true 호출도 게이트 활성 (학습 무결성). 외부 의존성 0 — `regimeMemoryBank` 의 ALL_REGIMES 와 동일한 자체 사본 보유 (순환 import 차단). `LEARNING_COVERAGE_GATE_DISABLED=true` 환경변수 회로 무력화. 영속 데이터 신규 0건 — TradeRecord.entryRegime 만 사용 (메모리 only). 페르소나 "불확실성 높으면 관망" 의 학습 영역 적용.
- **Reflection Module Half-Life boundary** (ADR-0047): `server/persistence/reflectionImpactRepo.ts` 는 13개 reflection 모듈 영향률 영속 SSOT (1년 ring buffer). `server/learning/reflectionImpactPolicy.ts` 는 임계 5%/1% 정책 SSOT — `getModuleStatus()` 결정 트리: ENV 무력화 → grace period 30일 → 표본 < 20건 grace → 영향률 < 1% deprecated → < 5% silent → 그 외 normal. `reflectionImpactRecorder.ts` 가 nightlyReflectionEngine 의 report 완성 시점에 1회 호출되어 13개 모듈 meaningful 일괄 추론·영속 — 모듈 호출 직접 wrapping 금지 (광범위 변경 회피). 본 PR 은 *측정만* — 실제 silent/deprecated 가드 wiring (실행 스킵 / 출력 억제) 은 데이터 누적 후 후속 PR. 운영자 진단 endpoint `GET /api/learning/reflection-impact?days=180` — status/impactRate/runs 일괄 반환. `LEARNING_REFLECTION_HALFLIFE_DISABLED=true` 환경변수로 모든 모듈 'normal' 강제.
- **AutoTradeContextualLayout boundary** (ADR-0049): `useAutoTradeContext()` 가 시각·MarketDataMode → 5 컨텍스트(PRE_MARKET / LIVE_MARKET / POST_MARKET / OVERNIGHT / WEEKEND_HOLIDAY) 매핑 SSOT. 각 자식 섹션은 `AutoTradeContextSection` 으로 wrap 되어 자기 `priorityByContext`/`collapsedByContext` 를 declare — 부모 `AutoTradeContextualLayout` 가 priority 오름차순 + 동률 originalIndex 안정 정렬 후 렌더. priority 9+ 는 hidden, collapsed=true 는 `<details>` 접힘. **기존 자식 컴포넌트 본체 무수정 원칙** — 신규 섹션 추가는 wrap 만으로. 비-AutoTradeContextSection children 은 정렬에서 제외 (별도 위치 배치 권장). Fragment 는 재귀 traverse 하여 조건부 렌더 (`{cond && <Section/>}`) 자연 동작.
- **AccountSurvivalGauge boundary** (ADR-0050): `server/health/survival.ts` 의 `collectSurvivalSnapshot()` 가 SurvivalSnapshot SSOT — 외부 호출 0건 (assessKillSwitch + evaluatePortfolioRisk + computeKellySurface + loadShadowTrades + loadMacroState 만 read). 신규 영속 SSOT 도입 금지 (peakEquity 영속 추적은 후속 PR). tier 임계값 (Daily Loss 50/25/0% buffer / Sector HHI 2500/4000 / Kelly ratio 1.0/1.5) 변경은 ADR-0050 §2.2 표 갱신 + 회귀 테스트 동시 수정 의무. UI 위젯 `AccountSurvivalGauge` 는 `src/api/survivalClient.ts` 단일 진입점 사용 — 절대 규칙 #3 (서버↔클라 직접 import 금지) 준수. AutoTradePage 통합은 PR-Z1 의 `AutoTradeContextSection` 으로 wrap, 모든 5 컨텍스트에서 priority=1.
- **InvalidationMeter boundary** (ADR-0051): `src/utils/invalidationConditions.ts` 가 4 카테고리 (STOP_LOSS_APPROACH / LOSS_THRESHOLD / STAGE_ESCALATION / TARGET_REACHED) 휴리스틱 평가 SSOT — `PositionItem` 의 *기존 필드* (stopLossPrice / pnlPct / stage / targetPrice1 / currentPrice) 만 사용. 외부 호출 0건. tier 임계 (0/1/≥2 metCount → OK/WARN/CRITICAL, evaluableCount=0 → NA) 변경은 ADR-0051 §2.3 표 갱신 + 회귀 테스트 동시 수정 의무. 매수 시점 무효화 조건의 영속 SSOT (ServerShadowTrade.invalidationConditions[]) 도입은 후속 PR — 본 PR 의 휴리스틱은 *근사값* 임을 명시. UI 위젯 `InvalidationMeter` 는 PositionLifecyclePanel 각 카드 내부에 임베드, AutoTradePage 본체 무수정.
- **TodayOneDecisionCard boundary** (ADR-0052): `src/utils/oneDecisionResolver.ts` 가 6 case 우선순위 SSOT — EMERGENCY_STOP > DAILY_LOSS_EMERGENCY > INVALIDATED_POSITIONS > ACCOUNT_CRITICAL > PENDING_APPROVALS > VOID > MONITORING. 위→아래 첫 매칭 단락. 우선순위 변경은 ADR-0052 §2.1 표 갱신 + 회귀 테스트 동시 수정 의무. VOID 4 조건(높은 변동성 / 활성 포지션 0 / 승인 대기 0 / 거시 리스크) 모두 AND — 거짓 양성 차단. 변동성 z-score 는 vixHistory 우선, vkospiDayChange fallback, 둘 다 부재 시 0 (보수적). PR-Z2 (SurvivalSnapshot) + PR-Z3 (InvalidationMeter) 자산 100% 재활용 — 신규 영속 SSOT 0개. UI 위젯은 `<TodayOneDecisionCard>` 단일 — AutoTradePage 의 AutoTradeContextSection 안정 정렬로 AccountSurvivalGauge 보다 먼저 렌더 (children 선언 순서 보존).
- **NightlyReflectionCard boundary** (ADR-0053): `src/components/autoTrading/NightlyReflectionCard.tsx` 는 Pro 모드 한정 — `useSettingsStore.autoTradeViewMode === 'pro'` 일 때만 AutoTradePage 에서 렌더. 컨텍스트별 priority: POST_MARKET=2 / OVERNIGHT=3 / WEEKEND_HOLIDAY=2 / PRE_MARKET=5 / LIVE_MARKET=7 (collapsed). 본 카드는 *읽기 전용* — `keyLessons`/`tomorrowAdjustments` 본문은 카운트만 노출, 정독은 텔레그램 `/learning_status` SSOT 단일 채널 유도. ADR-0007 의 manual approval 채널 정합 유지. 향후 매뉴얼 승인 인프라(experimentProposals.AWAIT_APPROVAL) 도입 시 본 카드 위에 승인/거부 버튼 추가하여 텔레그램 SSOT 와 통합.
- **ConcordanceMatrix boundary** (ADR-0054): `server/learning/conditionSourceMap.ts` 가 27 조건 분류(REAL_DATA 9 + AI 18) + classifyTier(8/6/4/2 임계값) SSOT — 클라 `src/services/quant/evolutionEngine.ts CONDITION_SOURCE_MAP` 동기 사본. 회귀 테스트가 양쪽 정합성 검증, 변경 시 동시 수정 의무. `/api/attribution/concordance` 는 `loadCurrentSchemaRecords()` 만 read (외부 호출 0건). 5×5=25 cell 보장. diagonal/off-diagonal 통계 합산. Bucket 임계값 변경은 ADR-0054 §2.1 표 갱신 + 회귀 테스트 동시 수정 의무. UI `ConcordanceMatrix` 는 RecommendationHistoryPage 임베드 — AutoTradePage 가 아님 (분석 페이지 분리).
- **pipelineDiagnosis Yahoo SSOT boundary** (ADR-0056): `server/trading/pipelineDiagnosis.ts` 는 Yahoo Finance 직접 fetch 금지 — `getYahooHealthSnapshot()` (`server/trading/marketDataRefresh.ts`) SSOT 만 read. 자체 fetch 추가는 24h 누적 통계 기반 판단을 우회해 단발성 503 알림 폭주를 다시 일으킨다. 알림 등급 분리: `issues`(OPERATIONAL CRITICAL — 즉시 텔레그램) / `warnings`(OPERATIONAL — 즉시 텔레그램) / `informational`(INFORMATIONAL — 일일 요약, 텔레그램 미발송). `informational` 필드는 옵셔널 후방호환. `server/utils/yahooProbeRetry.ts` (query1→query2 재시도 + 다중 심볼 헬퍼) 는 미래 확장점 — pipelineDiagnosis 본체에서는 미사용, 향후 수동 진단 명령·관측성 SSOT 에서 활용. cron `30 21 * * 0-4` (UTC = KST 06:30 KST) — NYSE 마감 직후 + 한국장 개장 2.5h 전 데이터 신선도/운영 관련성 동시 극대화.
- **GateMiniIndicator boundary** (ADR-0055): `src/utils/gateMiniIndicator.ts` 가 4-Gate 미니 인디케이터 평가 SSOT — PR-A `buildGateCardSummary` 와 동일 SSOT(`GATE1_IDS`/`GATE2_IDS`/`GATE3_IDS`/`CONDITION_PASS_THRESHOLD`/`CONDITION_ID_TO_CHECKLIST_KEY`) 재활용. 4-tier classify(PASS≥0.5 / PARTIAL≥0.3 / FAIL>0 / NA totalCount=0). 외부 호출 0건. 본 PR 은 *클라이언트 휴리스틱*, 사용자 원안의 서버 SQLite 캐시 + circuit breaker 인프라는 stock.checklist 부재 케이스 발생 시 후속 PR 분리(ADR-0055 §6 명문화). UI: `GateMiniIndicator` 는 `WatchlistCard` 헤더 우측 컴팩트 4 dot — PR-A `GateStatusCard` (카드 본문 expand 가능 풀카드) 와 책임 분리: 미니=*즉시 인지*, 풀카드=*상세 검토*.

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
