# Pending Wiring Backlog — QuantMaster Pro

@responsibility Wiring 미완 PR 단일 추적 SSOT — 인프라만 머지된 ADR 의 호출자 wiring 상태 + SLA 자동 만료 가시화.

## 목적

ADR 들이 *인프라 (영속 + SSOT 함수 + 회귀 테스트)* 만 머지하고 *호출자 wiring (LIVE 매매·UI·진단 경로 활성화)* 은 회귀 위험 격리 / 운영 데이터 누적 / 사용자 결정 대기 사유로 후속 PR 분리되는 패턴이 누적. 본 백로그가 단일 추적 SSOT — *영원히 dead code 로 남는 결함* 영구 차단.

## 룰

1. **PR 머지 시 wiring 미완 명시** — PR 노트의 "잔여 후속 PR" / "scope 밖" / "wiring 후속" 항목을 본 백로그에 1회 등록 의무.
2. **wiring 완료 시 항목 제거** — 후속 PR 머지 시 본 백로그 해당 항목 *삭제* + CLAUDE.md 변경 이력 인용.
3. **상태 4 단계** — `INFRASTRUCTURE_ONLY` (인프라만, 호출자 0건) / `PARTIAL` (일부 호출자 wired, 일부 잔여) / `BLOCKED` (외부 의존성·운영 데이터·사용자 결정 대기) / `DECIDED_NOT_WIRING` (의도된 SSOT/유틸 함수, 영구 미사용 허용).
4. **우선순위 3 등급** — `P0` LIVE 매매 또는 자기학습 결함 (즉시 wiring 권장) / `P1` UI 가시성 또는 진단 정합 (1~2주 내) / `P2` 운영 데이터 누적 후 (1~3개월) / `P3` 외부 의존성 변경 후 (불확정).
5. **SLA 자동 만료** (ADR-0158, 본 PR 신규) — 등재일 + SLA_DAYS[priority] 초과 시 빌드 경고, grace 14일 추가 초과 시 빌드 실패. 면제 정책 (BLOCKED 외부 의존성 명시) 외 강제.

## SLA 자동 만료 정책 (ADR-0158)

**우선순위별 SLA**:

| 우선순위 | SLA | grace 후 강제 | 의도 |
|----------|-----|----------------|------|
| **P0** | **21일** | grace 14일 후 빌드 FAIL | LIVE 매매·자기학습 결함 즉시 수리 (1 PR 사이클 + 검증 + 마무리) |
| **P1** | **45일** | grace 14일 후 빌드 FAIL | UI 가시성·진단 정합 (1.5 audit 사이클) |
| **P2** | **120일** | grace 14일 후 빌드 FAIL | 운영 데이터 누적 (4개월) |
| **P3** | **무기한** | SLA 미적용 | 외부 의존성 변경 후 (불확정) |

**면제 정책** — BLOCKED 상태 + reason 컬럼에 다음 패턴 중 하나 명시 시 SLA 면제:

- `외부 의존성` / `외부 API` / `운영자 결정` / `사용자 결정`
- `데이터 누적` / `운영 데이터 누적` / `데이터 가용` / `데이터 기반`
- `ADR-\d{4} 정책` (정책 SSOT 명시 인용)
- `검증 후` / `1~2주` / `N개월 후` (시간 의존성 명시)

**ENV 우회**:

- `WIRING_SLA_GRACE_DAYS=N` (기본 14, 0~30일 조정 가능, 0 시 즉시 FAIL)
- `WIRING_SLA_DISABLED=true` (긴급 운영 우회 — 정책 즉시 비활성)

**등재일 schema** — `YYYY-MM-DD` 형식 KST 기준. 신규 PR 머지 시 *해당 PR 머지일* 명시. DECIDED_NOT_WIRING 항목은 *결정 PR 머지일* 명시 (SLA 미적용, audit 추적성만).

## 후속 PR 백로그

### A. 학습 시리즈 (Shadow / Self-Learning)

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| A1 | 0030 latentSignalScorer | `server/screener/latentSignalScorer.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — watchlistManager tag + stockScreener 통합 + VCP_HUNTER section. **외인/기관 5일 z-score 통합 목적은 ADR-0614/0617 KIS-native(consecutive net-buy ledger·leader 발굴)로 superseded — 2026-06-18 제거(ADR-0561 KIS-Primary 정합).** VCP score 축만 잔존. |
| A2 | 0031/0186 orderTypeOptimizer | `server/trading/orderTypeOptimizer.ts` | 2026-05-02 | PARTIAL | P1 | **PR-A2-Wiring-1 (2026-05-05, ADR-0186) 의사결정 가시화 wiring 완료** — `buyPipeline.createBuyTask` 진입부에 `decideOrderType` 호출 + `ServerShadowTrade.orderTypeDecision?` 옵셔널 영속 + 진단 로그. ENV `ORDER_TYPE_OPTIMIZER_ENABLED=true` default OFF (운영자 SHADOW 1주 검증 후 활성화). **실제 placeKisMarketBuyOrder 호출 시 orderType 무변경** (LIMIT 그대로) — LIVE 매매 본체 영향 0. **잔여 P1 wiring**: A2-Wiring-2 (`fillMonitor` 체결 시 `recordSlippageEntry` 호출, 학습 데이터 수집) + A2-Wiring-3 (LIVE 적용 — IOC_MARKET `idempotency='unsafe'` ADR-0014 정합 + AGGRESSIVE_LIMIT chase logic). |
| A4 | 0083 walkForwardFramework | `server/learning/walkForwardFramework.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 데이터 6개월 누적 후 — decay='DECAYING' 시 가중치 자동 보수화 |
| A5 | 0084 conditionLifecyclePolicy | `server/learning/conditionLifecyclePolicy.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 데이터 6개월 누적 후 — 27조건 silent/deprecated 가드 wiring (signalScanner / entryRevalidationStep score 보수화) |
| A6 | 0123/0124 recommendationTracker | `server/learning/recommendationTracker.ts` | 2026-05-02 | PARTIAL | P1 | 학습 SSOT 변경 회귀 위험 — monthlyStats.winRate fill 단위 격상 (현재 trade 단위 WIN/LOSS 만, fill 수준 BE 분류 미반영) |
| A8 | 0160 learningLoopHealth | `server/learning/learningLoopHealth.ts` | 2026-05-02 | PARTIAL | P2 | commit 2258621 머지 시 508 → 460 LoC 변경 (변경 의도 불명확) — 본 모듈 단위 테스트 보강 + ADR-0160 §3 호출자 wiring 검증 |
| A9 | 0160 loadReflectionImpactRecords 활용 | `server/learning/failureToWeight.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | ADR-0160 §1 명시 — F2W reflection multiplier 가 `loadRecentReflections` + `loadFailurePatterns` 만 활용 / `loadReflectionImpactRecords` 본 PR scope 외 — silent/deprecated 모듈 자동 가드 wiring 후속 ADR |
| A10 | 0173 §1 MissedLearningQueue | `server/learning/missedLearningQueue.ts` | 2026-05-03 | BLOCKED | P1 | **운영자 결정 대기 — ENV `MISSED_LEARNING_QUEUE_ENABLED=true` 명시 활성화만 잔여** (PR-Learning-Wiring-Burndown, 2026-06-10): replay dispatcher 실함수 매핑 완료 — `server/learning/missedLearningReplayDispatcher.ts` 가 7 jobName → 실제 학습 복구 함수 dispatch (default dispatcher 결합). 단일 job throw 시 해당 job 만 FAILED + 전체 replay 무중단 (회귀 테스트). SLA 면제 (운영자 결정 — ADR-0158 §면제). |
| A11 | 0173 §5 LearningFreshnessGuard | `server/learning/learningFreshnessGuard.ts` | 2026-05-03 | INFRASTRUCTURE_ONLY | P1 | **PR-Shadow-Learning-Persistence-Phase1 (2026-05-03, ADR-0173)** — 호출자 0건 dead code. Phase 3 ReflectionInjectionBus 결합 후 활성화: `mainReflection` / `scoreBuyCandidate` / `condition weight engine` / `position sizing adjustment` 5 lesson 타입 (recentReflections / conditionLessons / biasHeatmap / counterfactualLessons / gateAttributionLessons) 에 `applyFreshnessDecay` 호출 wiring + `LEARNING_FRESHNESS_GUARD_ENABLED=true` 명시 활성화. SLA 만기 2026-06-17. |
| A12 | 0174 §2.1 SafetyGateAttribution | `server/learning/safetyGateAttribution.ts` | 2026-05-03 | BLOCKED | P1 | **운영자 결정 대기 — ENV `SAFETY_GATE_ATTRIBUTION_ENABLED=true` 명시 활성화만 잔여** (PR-Learning-Wiring-Burndown, 2026-06-10): 일일 cron wiring 완료 — `server/scheduler/learningJobs.ts` 'safety_gate_attribution' (KST 평일 16:40, ScheduleClass='TRADING_DAY_ONLY', ENV 첫 분기, scheduleCatalog 등재, 정적 가드 테스트). dead 게이트 (DATA_SANITY/EXPOSURE_BUDGET/ENEMY_CHECKLIST sampleSize=0) 는 Phase 3 ReflectionInjectionBus reason 컨텍스트 전달 후 자연 활성 (본 wiring 무접촉). SLA 면제 (운영자 결정 — ADR-0158 §면제). |
| A13 | 0174 §2.2 ShadowVsLiveDelta | `server/learning/shadowVsLiveDelta.ts` | 2026-05-03 | BLOCKED | P1 | **운영자 결정 대기 — ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED=true` 명시 활성화만 잔여** (PR-Learning-Wiring-Burndown, 2026-06-10): 일일 cron wiring 완료 — `server/scheduler/learningJobs.ts` 'shadow_live_delta_report' (KST 평일 16:45, ScheduleClass='TRADING_DAY_ONLY', ENV 첫 분기, scheduleCatalog 등재, 정적 가드 테스트). **LIVE_BUY_SHADOW_BETTER_SIZE plumbing only 그대로** — `sizingEngineSnapshot` 비교 알고리즘은 Phase 3 후속 (본 wiring 무접촉). SLA 면제 (운영자 결정 — ADR-0158 §면제). |
| A14 | 0175 FutureReturnResolver cron | `server/learning/futureReturnResolver.ts` | 2026-05-03 | BLOCKED | P1 | **운영자 결정 대기 — ENV `FUTURE_RETURN_RESOLVER_ENABLED=true` 명시 활성화만 잔여** (PR-Learning-Wiring-Burndown, 2026-06-10): priceFetcher wiring 완료 — cron 호출부가 `server/clients/historicalClosePrice.ts` `fetchHistoricalClosePrice` (KIS 일봉 L1 무조건 primary + Yahoo 최후 fallback — `check_kis_primary_invariant` WHITELIST, ADR-0561 충족) 주입. asOf 시점 종가 = 일봉 배열 `date <= asOf` 최신 bar close (미래 bar 누출 금지 + 전 provider 실패 시 null → errors++ 안전 분기, 회귀 테스트). SLA 면제 (운영자 결정 — ADR-0158 §면제). |
| A15 | 0176 MissedLearningReplay cron | `server/scheduler/learningJobs.ts` | 2026-05-03 | BLOCKED | P1 | **운영자 결정 대기 — ENV `MISSED_LEARNING_QUEUE_ENABLED=true` 명시 활성화만 잔여** (PR-Learning-Wiring-Burndown, 2026-06-10): replay cron (`30 0 * * 1-5` UTC = KST 평일 09:30 + ScheduleClass='TRADING_DAY_ONLY') + jobName → 실함수 dispatcher 매핑 완료 (A10 동일 dispatcher SSOT — mock plumbing 제거). 활성화 시 5 학습 cron silent skip → enqueue → 다음 영업일 09:30 replay → 실제 복구 함수 호출 (throw 시 해당 job 만 FAILED). SLA 면제 (운영자 결정 — ADR-0158 §면제). |

### B. 매매 본체 / 사이징

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| B2 | 0085 Slot Sizing | `server/trading/slotSizing.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | 사용자 결정 대기 — `perSymbolEvaluation.ts:902` `evaluateSlotSizing()` wiring + intraday sizing 동일 분기 — `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true` 명시 활성화 + 1주 검증 후 |
| B3 | 0001 preflight Phase B | `server/trading/signalScanner/preflight.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | LIVE 회귀 위험 격리 — 매크로 게이트 본체 교체 (signalScanner.ts:runPreflight() inline → preflight.ts 위임). signalScanner 분해 Phase B 후속 |
| B4 | 0008 kellyHalfLife | `server/trading/kellyHalfLife.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — 보유 중 재평가 wiring 미완성 (현재 호출자 모두 신규 진입, `timeDecayInput` 미전달) |
| B5 | 0117/0128 entryRevalidationStep | `server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts` | 2026-05-02 | PARTIAL | P1 | 사용자 결정 대기 — DATA_HOLD 분기 SSOT 위임 격상 (현재 진단 디테일 보존 vs 일관성 trade-off) |
| B6 | 0001 Phase B | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 + LIVE 회귀 격리 — evaluateBuyList god function (cc=244) 본체 추가 분해 (인라인 데이터 페치 / Gate revalidation wrapping / 진단 메시지 빌더) |
| B7 | 0085 price7dAgo | `server/persistence/shadowTradeRepo.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — `riskManager.ts:39` 가 reader 사용 (과열 부분 매도). 매수 시점 7일 lookback OHLCV 영속 wiring 미구현 — buyPipeline.buildBuyTrade 또는 신규 cron 에서 외부 OHLCV fetch 후 영속 |
| B8 | 0161~0165 PositionSizingEngine | `server/trading/sizing/positionSizingEngine.ts` | 2026-05-02 | PARTIAL | P2 | **Phase1+2D+Extension+Drawdown+LIVE Activation wiring 완료** (ADR-0161~0165) — P0 SLA 충족 (2026-05-23 만기 21일 전 LIVE Activation 완료). 4 진입 경로 + peakEquity 영속 (SHADOW/LIVE 분리) + drawdown 자동 차단 + LIVE 활성화 ENV `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` (default OFF). **잔여 2 PR (P2)**: lossStreak 외부 학습 SSOT 결합 + universe/sectorWeight 결합. 운영자 활성화 절차 (ADR-0165 §3): SHADOW 1주 검증 → ENV 활성화 → 만족 시 운영 유지. |
| B9 | 0166+0167+0169+0170 RegimeExposureBudget | `server/trading/sizing/regimeExposurePolicy.ts` | 2026-05-02 | PARTIAL | P2 | **Phase A+B+AccurateExposure+AddOnBuy+AutoMapping wiring 완료** (ADR-0166+0167+0169+0170) — 7 레짐 매트릭스 + 4 wiring + 정확 산출 SSOT + trancheExecutor 추매 진입점 (`isAddOnBuy=true`) + 매크로 신호 R1_DEFENSIVE 자동 격상 (`mapInternalToExposureRegimeWithMacro`, ENV `EXPOSURE_REGIME_AUTO_MAPPING_DISABLED=true` default OFF). audit-PR-520 §M1+§M2+§M4 수리 완료 (PR #525 + #527 + #528) — **§"Medium 4건" 모두 수리 완료**. **잔여 2 PR (P2)**: currentPriceMap 시가 평가 (KIS 호출) + UI 출력. 활성화 절차 (ADR-0166 §7 + ADR-0167 §7): SHADOW APPLY → EXPOSURE BUDGET → ACCURATE EXPOSURE → LIVE 4단계. |
| B10 | 0172 SizingEngine marketCap 잔여 | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | **PR-Sizing-Engine-Real-Data (2026-05-02, ADR-0172) 부분 완료** — `avgDailyVolume20d` + `currentSectorWeight` 2 axis 실데이터 wiring 완료 (`computeSizingLiquidityInputs` SSOT + 4 호출자 wiring). **잔여 1 axis (P2)**: `marketCap` Yahoo Finance chart API 미제공 → KIS 기업 정보 API (CTPF1002R) 결합 후 실값 전달 필요. 외부 의존성 — KIS quota 영향 평가 + ADR-0011 정책 검토 후 진행. SLA 미적용 (외부 의존성 면제 — ADR-0158 §"면제 정책"). |
| B13 | 0093 fomc_relaxed_ 알림 wiring 복원 | `server/trading/signalScanner/preflight.ts` | 2026-05-05 | INFRASTRUCTURE_ONLY | P2 | ADR-0147b (signalScanner Phase 3 분해, PR #523) 머지 시 preflight.ts 의 `fomc_relaxed_${date}` dedupeKey + "우호 환경 완화" 텔레그램 알림 wiring 누락 (정책 회귀). `gatingAlertDedupe.test.ts` 의 `it.skip` 으로 등재. `fomcCalendar.ts` 정책 자체는 적용 (자금 안전 영향 0) — 운영자 인지 결함만. wiring 복원 후 `it.skip` → `it` 활성화 + 본 행 DECIDED_NOT_WIRING 격상 |
| B14 | 0414 PriceCorrection Stage 2 Shadow | `server/trading/signalScanner/priceCorrectionEngine.ts` | 2026-05-06 | BLOCKED | P1 | **재분류 2026-07-03 (Patch-PENDING-WIRING-B14-DEFER-001): PARTIAL→BLOCKED — 운영자 결정 (silverlh614) Stage 2b 연기. SLA 면제 (ADR-0158 §면제 — 운영자 결정 + 검증 후 재개)**: Stage 1 관측 correction confidence 평균 0.100 < Stage 2b shadow 채택 게이트 0.5 → 지금 wiring 을 깔아도 사실상 no-op (관측 가치 0). correction confidence 개선 검증 후 재개 — 재검토 트리거: `/scan_blockers` Price Correction Overlay avg confidence ≥ 0.5 관측 시. **Stage 2a 완료 (PR-PriceCorrection-Stage2a, 2026-06-18, ADR-0623)** — `PRICE_CORRECTION_SHADOW_ENABLED` ENV(default OFF·`isPriceCorrectionDisabled` 우선) 신설 + Seam A: dead 모듈(`evaluatePriceIntegrity`/`evaluatePriceCorrection`)을 live diagnostics 로 전환(`ScanSummary.priceIntegrity`/`.priceCorrection` 집계 채움 → `/scan_blockers` 종목별 가시화). byte-equivalent(ENV OFF)·LIVE 무접촉·외부 API 0·원본 mutate 0. **잔여 (Stage 2b P1)**: shadow corrected 치환 — `kisIntradayCorrectionStep` 시그니처 확장 + SHADOW 분기 reCheckQuote 복제본에 corrected price/prevClose 주입 + 4중 게이팅(`shadowEnabled && stockShadowMode && usableForShadow && confidence≥0.5`) + buildBuyTrade lineage 스탬프 + 회귀 #5/#6. SLA 만기 2026-06-20 — Stage 2a wiring 으로 status 격상. 활성화 절차: Stage 2b 후 운영자 1주 SHADOW 검증 → Stage 3(B15) 진입. |
| B15 | 0414 PriceCorrection Stage 3 Live | `server/trading/signalScanner/priceCorrectionEngine.ts` | 2026-05-06 | BLOCKED | P0 | **운영자 결정 대기 + Stage 2(B14) SHADOW 검증 후** (ADR-0414 정책 — Stage 1→2→3 순차 게이트, Stage 3 는 Stage 2 미완 시 진입 불가). Stage 1 Read-Only 인프라만 머지됨. **잔여 (Stage 3 P0)**: `PRICE_CORRECTION_LIVE_ENABLED=true` ENV + 운영자 명시 승인 + signalScanner / 27조건 / Gate 1~3 wiring + `usableForLiveEntry=true` 강제 해제 (현재 Stage 1 항상 false). LIVE 매매 본체 결합 — 회귀 위험 *큼*. 활성화 절차: B14(Stage 2) SHADOW 1주 + corrected vs original 백테스트 비교 + 운영자 명시 승인 → ENV 활성화 → 운영 데이터 1주 검증 후 유지. **재분류 2026-06-02 (Patch-PENDING-WIRING-B15-RECLASSIFY-001)**: INFRASTRUCTURE_ONLY→BLOCKED — Stage 3 는 Stage 2+운영자 승인이 본질적 선행이라 BLOCKED 가 정확(C19 정합). SLA 면제 (ADR-0158 §면제 — 운영자 결정 + 검증 후). |

### C. 시그널 입력 (Diag-2~5 의사결정 wiring)

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| C1 | 0137 KIS 종목별 프로그램매매 | `server/clients/kisClient/query.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 1~2주 누적 후 — enrichment 시그널 + signalScanner 가중치 wiring |
| C2 | 0138 KIS 시장 종합 프로그램매매 | `server/clients/kisClient/query.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 1~2주 누적 후 — regime 가중치 wiring |
| C3 | 0139 ECOS 신용공여 | `server/clients/ecosClient.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | STAT_CODE 운영 검증 + 데이터 누적 후 — enemyChecklist 활성화 + regime 보수화 wiring |
| C5 | 0142 FSS Mapping | `server/persistence/fssMappingPolicy.ts` | 2026-05-02 | BLOCKED | P2 | 운영자 결정 + 1~2주 데이터 누적 후 — `FSS_MAPPING_ENABLED=true` ENV 활성화 결정 대기 (`/fss_mapping` 검증 + 시장 행동 일치도 확인) |
| C6 | 0136 PR-1 후속 | `server/trading/regimeBridge.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | regime 의사결정 회귀 격리 — `passiveActiveBoth=null → R3_EARLY 트리거 보수화` wiring |
| C19 | 0546 Gate1 Regime-Aware Required (Phase 2) | `server/trading/gateConfig.ts` | 2026-05-30 | BLOCKED | P0 | **운영자 결정 대기 + forward-outcome 데이터 누적 후** — `resolveGate1RequiredScore` SSOT. Phase 1(ADR-0546)은 SSOT 신설 + 섀도 병행 로깅까지(`GATE1_REGIME_AWARE_REQUIRED=false` 동작 보존). **정합 3건 해소 (C19 patch, 2026-06-18, byte-equivalent)**: `entryRevalidationStep`/`normalizeMacroRegime` regime 라벨 이중명명(RegimeLevel↔MacroRegime) SSOT 문서화+테스트 / resolvedRegime 도메인 분리 명시(`minGateRegime`/`policyRegime`) / 분모 폴백(R4=5) 회귀 고정. **잔여 (LIVE flip P0)**: 3영업일+ forward-outcome 로 `regimeAwareRequired`(R3_EARLY→40~60) 승률 비손상 검증 후 `GATE1_REGIME_AWARE_REQUIRED=true` 전환 + R3 Sanity Guard 입력을 레짐 인식값으로 승격(GATE1_PASS_ZERO 해소). LIVE 매매 활성화 경로 — 검증 후 진행. SLA 면제 (운영자 결정 + 데이터 누적). |

### D. UI Phase B/C/D wiring

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| D1 | 0098 ConfluenceMeter | `src/components/common/ConfluenceMeter.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | UI 가시성 — DiscoverWatchlistPage Top 3 시범 임베드 + VerdictCard.Evidence 안 자식 |
| D2 | 0098 confluenceEngine | `server/learning/walkForwardFramework.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 (신규 모듈) — 백엔드 4축 score 산출 wiring + 결손 사유 자동 생성 (백엔드 데이터 출처 + 결손 패턴 매핑) |
| D3 | 0097 VerdictCard | `src/components/watchlist/WatchlistCard.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | UI 가시성 — WatchlistCard 마이그레이션 (variant='verdict' 점진 도입). 50+ 컴포넌트 점진 |
| D5 | 0096 DataQualityRibbon + IDontKnow | `src/components/common/DataQualityRibbon.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — MarketOverviewHeader / DiscoverWatchlistPage 페이지 상단 임베드 |
| D6 | 0094 UI_LANG.confluence | `src/config/uiLanguage.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — ConfluenceMeter 4축 라벨 SSOT 격상 (현재 컴포넌트 내부 AXIS_LABEL 상수) |
| D7 | 0099 Verbosity Wiring | `src/components/common/UIVerbosityToggle.tsx` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — 5 wiring PR 완주 (PR-Z14~Z18) 후 사용처 점진 마이그레이션 |
| D8 | 0504 positionsRouter REAL mode wiring | `server/routes/autoTrade/positionsRouter.ts` | 2026-05-12 | INFRASTRUCTURE_ONLY | P1 | UI 가시성 — getOpenPositions SSOT 위임 + REAL mode `fetchKisHoldings` wiring (응답 schema breaking change 위험으로 별도 PR 분리, ADR-0504) |

### E. 영속 / 진단 / 정합

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| E1 | 0113 Corporate Action Ledger | `docs/adr/0113-yahoo-drift-tiered-sanity-and-corporate-action-detector.md` | 2026-05-02 | INFRASTRUCTURE_ONLY | P3 | 외부 API 인증 키 확보 후 — DART 공시 매칭 + PriceSnapshot 4 필드 영속 + 24h 격리 + KRX/DART 출처 cumulativeFactor + `getAdjustmentFactor(code, date)` |
| E2 | 0128 dartPoller | `server/alerts/dartPoller.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — `getCorpEventLookback` wiring (corp event 타입별 lookback 차등 90/60/30/14/7일) |
| E3 | 0128 HELD_POSITION 자동 탐지 | `server/data/dataHoldRolePolicy.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 (별도 ADR) — 현재 호출자가 명시 전달, 자동 분류 SSOT |
| E4 | 0090 Cache Coherence Auditor | `server/persistence/cacheCoherenceAuditor.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — invariant 확장 (WATCHLIST/MACRO_STATE 등) + Phase 2 cron 자동 audit 발행 + Phase 3 자동 수정 도구 |
| E7 | 0160 check:learning-boundary validate:all 통합 | `scripts/check_learning_channel_boundary.js` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | ADR-0160 §4 명시 — 현재 standalone 명령 (`npm run check:learning-boundary`). `validate:all` 17종 격상으로 precommit 자동 차단 — 회귀 위험 격리를 위해 후속 PR 분리 |
| E8 | 0395 PR-B `/mode_consistency` 3-state 업그레이드 | `server/telegram/commands/system/modeConsistency.cmd.ts` | 2026-05-06 | BLOCKED | P2 | **🔁 재노출 2026-06-18 (안전·거버넌스 자산 — 방치 부채 가시화, P3→P2 격상). 원 사유: SL 이후 추천(사용자 결정)** (사용자 명시 5/6 PR-A 머지 후 "나머지는 부채로 등록 (sl 이후 추천)"). 현재 메시지 (`env AUTO_TRADE_MODE` / `runtime tradingMode` / `KIS_IS_REAL` / kill switch) → `getExecutionMode()` 3-layer (env / persistent / runtime / final) + persistent override 활성 시 강한 경고 + legacy `getTradingMode` 보조 정보 격상. 분류 5 분기 (CONSISTENT / PERSISTENT_OVERRIDE_ACTIVE / RUNTIME_OVERRIDE_ACTIVE / KILL_SWITCH_DOWNGRADED / UNINTENDED_DIVERGENCE). ADR-0395 (PR #664) 영속 override 운영 가시성 갭. SLA 면제 (사용자 결정 패턴). |
| E9 | 0395 PR-C `/exec_mode_persist` + `/exec_mode_clear` 텔레그램 명령 | `server/telegram/commands/system/` (신규 2 cmd) | 2026-05-06 | BLOCKED | P2 | **🔁 재노출 2026-06-18 (안전·거버넌스 자산 — 방치 부채 가시화, P3→P2 격상). 원 사유: SL 이후 추천(사용자 결정)**. `setPersistentExecutionMode(mode, meta?)` + `clearPersistentExecutionMode()` 운영자 텔레그램 직접 제어 진입점. `/exec_mode_persist OFF/PAPER/LIVE` (alias `/emp`) + `/exec_mode_clear` (alias `/emc`). 안전장치 — KIS_IS_REAL=false + LIVE persistent 거부 또는 강한 경고 / 입력 검증 (OFF/PAPER/LIVE 외 거부) / 결과 메시지 finalMode 표시 + 재배포 후에도 유지 안내. ADR-0395 인프라의 운영자 진입점 (현재 코드 또는 직접 fs 편집 만 가능). SLA 면제 (사용자 결정 패턴). |
| E10 | 0395 PR-D KillSwitch persistent downgrade | `server/trading/killSwitch.ts` | 2026-05-06 | BLOCKED | P2 | **🔁 재노출 2026-06-18 (안전·거버넌스 자산 — 방치 부채 가시화, P3→P2 격상). 원 사유: SL 이후 추천(사용자 결정)**. 현재 `setTradingMode('SHADOW')` legacy 강등 (재시작 시 env LIVE 복귀 가능) → `setPersistentExecutionMode('OFF', { setBy: 'kill-switch', reason })` 영속 강등 (재시작 후에도 OFF 유지, 운영자 `/exec_mode_clear` 의무). 사용자 명시 안전 가드레일 — **default OFF (legacy 동작) 1주 측정 → ENV `KILL_SWITCH_PERSISTENT_DOWNGRADE_ENABLED=true` 명시 활성화** (transient KillSwitch 발동 시 새벽 운영자 개입 강제 회피). LIVE 회귀 위험 격리 — 본 항목은 운영 데이터 누적 + 사용자 결정 후 진행. SLA 면제 (사용자 결정 패턴). |
| E11 | 0148 P7 no-execution-mode-skip-in-learning ESLint rule | `scripts/check_execution_mode_ssot.js` (신규) | 2026-05-06 | BLOCKED | P2 | **🔁 재노출 2026-06-18 (안전·거버넌스 자산 — 방치 부채 가시화, P3→P2 격상). 원 사유: SL 이후 추천(사용자 결정)**. ADR-0148 정적 검증 SCHEMA_FILES 패턴 차용한 신규 검증 도구. 학습 namespace (`server/learning/**`) 에서 `if (getExecutionMode() === 'OFF') return` / `if (mode !== 'LIVE') return` / `switch(getExecutionMode())` 안 OFF/PAPER 학습 중단 패턴 차단. AST 레벨 패턴 매칭 — 정당한 라벨링 사용 (telemetry 메타) 허용. `validate:all` 16종 → 17종 격상 + BASELINE 카탈로그 흡수. SLA 면제 (사용자 결정 패턴). |

## 진행 통계

| 카테고리 | 항목 수 | P0 | P1 | P2 | P3 |
|----------|---------|----|----|----|----|
| A. 학습 시리즈 | 13 | 0 | 8 | 5 | 0 |
| B. 매매 본체 | 12 | 1 | 4 | 7 | 0 |
| C. 시그널 입력 | 6 | 1 | 1 | 4 | 0 |
| D. UI Phase | 7 | 0 | 3 | 4 | 0 |
| E. 영속/진단 | 9 | 0 | 0 | 8 | 1 |
| **합계** | **47** | **2** | **16** | **28** | **1** |

> 주: 위 통계는 active backlog 기준이다. 완료/영구결정 `DECIDED_NOT_WIRING` 15건은 2026-05-25 정리로 active table 에서 제거했다.

> 주: P0 active backlog 는 B15 (PriceCorrection Stage 3 Live, ADR-0414) + C19 (Gate1 Regime-Aware Required LIVE flip, ADR-0546) 2건. 둘 다 운영자 명시 승인 + 검증 데이터 누적 전까지 LIVE wiring 보류.

## P0 즉시 wiring 권장

1. **B15 PriceCorrection Stage 3 Live** — Stage 2 SHADOW 검증 + corrected vs original 백테스트 + 운영자 명시 승인 전까지 LIVE wiring 판단 보류.

## 진행 중 잔여

- **active backlog 47건** — 완료/영구결정 기록은 active table 에서 제거. 2026-06-18 KIS-Primary 충돌 폐기 3건(C4·E6 + A1 외인 z-score 목적) + 방치 사용자결정 부채 정리(C16/C17/C18 진단부채 폐기, E8~E11 안전·거버넌스 자산 재노출 P3→P2).
- **정량 격상 후속 0건** — 27 조건 시리즈 데이터 가용 한계 도달 (78%). 잔여 22% 정성 영구 (ADR-0154 §3).
- **운영자 집중 영역** — Gemini 프롬프트 품질 향상 + AI 추정 가중치 학습 (ADR-0149 매핑 정정 후 30일 누적).

## 변경 이력

| 날짜 | PR | 내용 |
|------|----|------|
| 2026-05-01 | PR-Governance-1 | 초기 백로그 작성 — 5 카테고리 32 항목 + 4 상태 / 3 우선순위 SSOT |
| 2026-05-01 | PR-Phase0-MappingFix | C7~C14 신규 8 항목 — 27 조건 격상 후속 (Phase 1~4 INFRASTRUCTURE_ONLY/BLOCKED 4 + DECIDED_NOT_WIRING 정성 4). 합계 33→41 / P0 2→3 / P1 9→12 / P2 19→20 / P3 3→7 |
| 2026-05-01 | PR-Phase1-DartFinalize | C7 → DECIDED_NOT_WIRING (Phase 1 완료). performanceReality (#15) + economicMoatVerified (#8) DART 격상 main + aiFallback 두 경로. 27 조건 격상 진행도 44% → 52% (12 → 14개). ADR-0150 발행. 카테고리 카운트 동일 (C 14 / 합계 41). |
| 2026-05-01 | PR-Phase2-KisSupplyAudit | C8 → DECIDED_NOT_WIRING (Phase 2 audit + silent degradation 차단 완료). audit findings §B 권고 정정. C15 (Naver 외인 추세 endpoint) 신규 P2 등재. ADR-0151 발행. 카운트 변경 — C 14→15 / P2 6→7 / 합계 41→42. |
| 2026-05-01 | PR-Phase2-Real-Phase3 | C9 (Phase 3 globalIntel 합성) + C15 (Naver 외인 추세 endpoint) 동시 → DECIDED_NOT_WIRING. ADR-0152 + ADR-0153 발행. #4 supplyInflow + #5 riskOnEnvironment + #1 cycleVerified + #16 policyAlignment 4 키 격상. 27 조건 격상 진행도 52% → 67% (14 → 18개). |
| 2026-05-01 | PR-Phase4-Closeout | ADR-0154 발행 — Phase 4 BLOCKED 영구 정책 + 정성 4 항목 영구 DECIDED_NOT_WIRING + #12 옵션 C 권장 + driftGuard 시간 의존 결함 차단. C10 + C11~C14 정책 SSOT 명문화. 진행 통계 무변경 (정책 ADR 만). 27 조건 격상 시리즈 마무리. |
| 2026-05-01 | PR-Phase5 | ADR-0155 + ADR-0156 + ADR-0157 발행 — #12 KRX 5d 기관 (옵션 C) + Phase 4 Yahoo 컨센서스 (옵션 A 변형) + driftGuard 근본 해결 (`now?: Date` 옵셔널). C10 → DECIDED_NOT_WIRING. 27 조건 격상 **67% → 78% (3 키 격상, 18 → 21 개)** — 데이터 가용 한계 도달. 잔여 22% 정성 영구. driftGuard baseline 1 fail 영구 차단. |
| 2026-05-02 | PR-Governance-3-SLA | ADR-0158 발행 — Wiring SLA 자동 만료 정책 SSOT (P0=21일 / P1=45일 / P2=120일 / P3=무기한 + grace 14일 + 면제 정책 + ENV 우회 2종). 7번째 컬럼 *등재일* 추가 + 47 baseline 항목 일괄 부여. `check_pending_wiring.js` 카테고리 H 추가 (H1 SLA 초과 WARN / H2 grace 초과 FAIL / H3 등재일 형식 / H4 BLOCKED 면제). PR 템플릿 강제 필드 추가 — INFRASTRUCTURE_ONLY 등재 시 wiring 약속 PR 또는 SLA 만기일 둘 중 하나 명시 의무. 카테고리 카운트 동일 (5 카테고리 42 항목). |
| 2026-05-03 | PR-Shadow-Learning-Persistence-Phase1 | A10 + B11 + A11 신규 3 항목 등재 — ADR-0173 §1 MissedLearningQueue (A10 P1) + §2 ShadowLearningOnlyScan (B11 P1) + §5 LearningFreshnessGuard (A11 P1) 모두 INFRASTRUCTURE_ONLY (호출자 0건 dead code) + SLA 만기 2026-06-17. 4 Phase 시리즈 (Phase 1 인프라 / Phase 2 분석 / Phase 3 wiring + LIVE / Phase 4 UI). 합계 48→51 / A 9→11 / B 10→11 / P1 12→15. |
| 2026-05-03 | PR-Shadow-Learning-Phase2a | A12 + A13 신규 2 항목 등재 — ADR-0174 §2.1 SafetyGateAttribution (A12 P1) + §2.2 ShadowVsLiveDelta (A13 P1) 모두 INFRASTRUCTURE_ONLY (호출자 0건 dead code 영속 분석 SSOT) + SLA 만기 2026-06-17. Phase 2 분할 정책 (2a 분석 dead code / 2b cron LIVE 결합). 합계 51→53 / A 11→13 / P1 15→17. |
| 2026-05-03 | PR-Shadow-Learning-Phase2b1 | A14 신규 1 항목 등재 — ADR-0175 FutureReturnResolver cron (A14 P1) INFRASTRUCTURE_ONLY (cron 등록 완료, ENV `FUTURE_RETURN_RESOLVER_ENABLED` default OFF) + SLA 만기 2026-06-17. Phase 2b 분할 정책 (2b-1 future return resolve 단일 cron / 2b-2 MissedLearningQueue replay cron + 7 학습 작업 enqueue wiring). 합계 53→54 / A 13→14 / P1 17→18. |
| 2026-05-03 | PR-Shadow-Learning-Phase2b2 | A10 INFRASTRUCTURE_ONLY → PARTIAL 격상 (MissedLearningQueue wiring 완료) + A15 신규 등재 — ADR-0176 MissedLearningReplay cron (A15 P1) INFRASTRUCTURE_ONLY (cron 등록 완료, replayMissedLearningJobs dispatcher 매핑 Phase 3 후속) + SLA 만기 2026-06-17. Phase 2b-2 — scheduleGuard hook 옵셔널 + 5 학습 cron `enqueueOnSkip: {}` wiring + 신규 replay cron. 합계 54→55 / A 14→15 / P1 18→19. |
| 2026-05-05 | PR-Governance-Recovery-505 | B12 신규 등재 — ADR-0168b (별칭) emergency-data-quality-circuit-breaker (`server/dataQuality/emergencyDataQualityGuards.ts`) INFRASTRUCTURE_ONLY P1 (호출자 0건 critical 경로 — signalScanner / watchlistManager / buyPipeline / stockScreener) + SLA 만기 2026-06-19. 본 PR 거버넌스 정합 회복 — INDEX.md ADR-0146/0147/0168 신규 충돌 별칭 부여 (0146a/b·0147a/b·0168a/b, ADR-0159 정합) + 전체 인덱스 3 항목 추가. 합계 55→56 / B 11→12 / P1 18→19. |
| 2026-05-05 | PR-B12-A | B12 INFRASTRUCTURE_ONLY → PARTIAL 격상 — ADR-0184 발행 (emergency-data-quality-guards-wiring-phase-a). site 1 (universeScanner 3 함수 master guard, ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED` default OFF) + site 2 (watchlistRepo.saveWatchlist invalid KRX code filter, default ON `0070X0` 영구 차단) 2 wiring 완료. ENV 헬퍼 SSOT 2종 신규 + 회귀 31 케이스 (ENV 9 + 정적 가드 16 + watchlistRepo 6). 잔여 site 3 (buyPipeline) + site 4 (Stage1 strict) 는 B12-B 별도 PR. 통계 무변경 (B12 row 만 상태 격상). |
| 2026-05-05 | PR-B12-B | B12 PARTIAL → DECIDED_NOT_WIRING 격상 — ADR-0185 발행 (emergency-data-quality-guards-wiring-phase-b). site 3 (buyPipeline.createBuyTask KRX code sanity, ENV `EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED` default ON, `normalizeKrxCode` null 시 early SKIP + markBlocked) + site 4 (pipelineHelpers.evaluateStage1Filter strict 분기, ENV `EMERGENCY_STAGE1_STRICT_ENABLED` default OFF, `Stage1RejectionReason` union DATA_MISSING_* 5종 확장 + EMPTY_REASON_COUNTS SSOT 갱신) 2 wiring 완료. ENV 헬퍼 SSOT 2종 신규 (`isEmergencyBuyPipelineCodeGuardEnabled` + `isEmergencyStage1StrictEnabled`). 회귀 30 케이스. ADR-0168b §"Future wiring" 4 boundary 100% 완료. 통계 P1 19→18 / 합계 56→56 (DECIDED_NOT_WIRING 항목 카운트 유지). |
| 2026-05-05 | PR-A2-Wiring-1 | A2 INFRASTRUCTURE_ONLY → PARTIAL 격상 — ADR-0186 발행 (order-type-optimizer-wiring-phase-1). `buyPipeline.createBuyTask` 진입부에 `decideOrderType` 호출 + `ServerShadowTrade.orderTypeDecision?` 옵셔널 영속 + 진단 로그 wiring. ENV `ORDER_TYPE_OPTIMIZER_ENABLED=true` default OFF (운영자 SHADOW 1주 검증 후 활성화). **LIVE 매매 본체 영향 0** — 실제 placeKisMarketBuyOrder 호출 시 orderType 무변경 (LIMIT 그대로). ENV 헬퍼 SSOT 신규 (`isOrderTypeOptimizerEnabled`). 회귀 12 케이스. 잔여 A2-Wiring-2 (fillMonitor slippage 영속) + A2-Wiring-3 (LIVE 적용 IOC + chase) 별도 PR. 통계 무변경 (A2 row 만 상태 격상). |
| 2026-05-06 | PR-A-Provider-Degraded-Visibility 후속 부채 등재 | 사용자 명시 PR-A 머지 (#665) 직후 "나머지는 부채로 등록 (sl 이후 추천)" 요청. 7 신규 항목 등재 — C16 (PR-E 8 evaluator status migration) + C17 (P5 context propagation `hadRequiredData`/`skippedByPolicy`) + C18 (P6 Yahoo quoteSummary PER/EPS opportunistic) + E8 (PR-B `/mode_consistency` 3-state 업그레이드) + E9 (PR-C `/exec_mode_persist`+`/exec_mode_clear` 텔레그램 명령) + E10 (PR-D KillSwitch persistent downgrade) + E11 (P7 no-execution-mode-skip-in-learning ESLint rule). 모두 BLOCKED P3 + reason "사용자 결정 대기 — SL 발생 후 추천 재검토" — SLA 면제 (사용자 결정 패턴 인용 정합 ADR-0158 §"면제 정책"). 합계 57→64 / C 15→18 / E 7→11 / P3 7→14. 신규 ADR 발급 0건 — 본 백로그 등재만. |
| 2026-05-06 | PR-P0-Activation | B1 + B11 PARTIAL → DECIDED_NOT_WIRING 격상 — 사용자 명시 "P0 패치 후 머지 실시" 직접 반영. B1 (TwoBar Confirmation BEP_PROTECTION) `BEP_TWO_BAR_LIVE_ENABLED` default OFF → ON (`!== 'false'` 정확 비교) + B11 (ShadowLearningOnlyScan) `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED` default OFF → ON. ADR-0085 + ADR-0183 §"PR-P0-Activation" 섹션 추가 (ADR 발급 0건). 회귀 테스트 정합 정정 68/68 pass. P0 SLA 만기 2026-05-23/24 17~18일 전 충족. **LIVE 매매 본체 영향**: B1 LIVE 모드 진입 시 BEP_PROTECTION 분기 활성 (사용자 SHADOW only 운영이라 영향 0). B11 SHADOW only 격리 (allowRealOrder=false 강제) — 데이터 수집 활성화만, LIVE 매매 영향 0. 회귀 발견 시 두 ENV 모두 `=false` 1줄 즉시 롤백. **P0 임박 잔여 0건** (4건 모두 DECIDED_NOT_WIRING 격상 완료). 통계 표 무변경 (status 격상만, 우선순위 카운트 유지). |
| 2026-05-06 | PR-Price-Integrity-Correction-Overlay-Readonly (ADR-0414) | B14 + B15 신규 2 항목 등재 — ADR-0414 Stage 1 Read-Only Mode 인프라만 (호출자 0건 dead code 의도). B14 (Stage 2 Shadow, P1 SLA 만기 2026-06-20) + B15 (Stage 3 Live, P0 SLA 만기 2026-05-27 — Stage 2 검증 후). PriceIntegrityChecker (7 status union + 결정 트리 8 분기) + PriceCorrectionEngine (correctionType 6 union + confidence 3축 가중치 + DROP_GAP_CALCULATION 정책) + PriceCorrectionLineage (ruleVersion `v1-readonly`) 3 SSOT 모듈 신규. ENV `PRICE_CORRECTION_DISABLED=true` 우회 default OFF. **LIVE 매매 본체 0줄 변경** — Stage 1 invariant `usableForLiveEntry=false` 항상 강제 (절대 원칙 #3). 회귀 54 케이스 (PriceIntegrityChecker 16 + PriceCorrectionEngine 14 + PriceCorrectionLineage 6 + Stage 1 통합 7 + 정적 grep 가드 12). KIS/KRX 자동매매 quota 0 침범. 합계 64→66 / B 13→15 / P0 4→5 / P1 19→20. |
| 2026-05-07 | PR-ADR-0439-Provisional-Cache-Lookup | C19 INFRASTRUCTURE_ONLY → DECIDED_NOT_WIRING 격상 — ADR-0439 (= 사용자 명시 ADR-0434, PENDING_WIRING C19 P2 부채 해소) 발행. provisionalShadowPriceProvider `lookupCachedPrice` 4-tier (INTRADAY/DAILY/MARKET_DATA/READ_ONLY_QUOTE) wiring 활성화 — counterfactualShadowPriceProviderAdapter 헬퍼 (ADR-0434) export 키워드만 추가 (본체 0줄 변경) + horizon → reader 라우팅 매트릭스 (intraday horizons → INTRADAY 우선, daily horizons → DAILY 우선) + SCAN_SNAPSHOT 우선 + ENV `PROVISIONAL_CACHE_LOOKUP_DISABLED` default OFF + maxExternalLookups default 0 그대로 (cache-only 정책 보존, 외부 API 호출 도입 0). 회귀 38 신규 + 인접 111/111 무회귀. **LIVE 매매 본체 0줄 변경** + KIS/KRX/Yahoo/Naver outbound 0 (`getSnapshot` read-only). 외부 API 호출 활성화 (`maxExternalLookups>0`) 는 별도 ADR. C19 P2 SLA 만기 2026-09-04 약 4개월 전 충족. 통계 표 무변경 (status 격상만, 카테고리 / 우선순위 카운트 유지). |
| 2026-05-25 | Patch-Pending-Wiring-Active-Cleanup-001 | active backlog 에서 `DECIDED_NOT_WIRING` 완료/영구결정 15건 제거 — A3/B1/B11/B12/C7/C8/C9/C10/C11~C14/C15/C19/E5. 진행 통계 68→53, P0 5→1(B15만 유지). 문서 전용, runtime impact 0. |
| 2026-06-10 | PR-D4-RecommendationSnapshot-TimeBand-Wiring | D4 (ADR-0019 후속 wiring, ADR 발급 0건 patch type) 소진 — 행 삭제. `expiresAt` 단일 출처 selector (`getSnapshotExpiresAt` = recommendedAt + SNAPSHOT_EXPIRY_MS, expireStale 30일과 동일 상수·동일 기점) + TimeBand/VerdictCard props 어댑터 (`toTimeBandWindow` — PENDING/EXPIRED 만 윈도, OPEN/CLOSED null) + store selector (`getTimeBandWindow(stockCode)`). TimeBand remainingPct=0 ↔ repo EXPIRED 전이 동일 시점 기준 cross-module 회귀 테스트 고정 (`TimeBand.snapshotExpiry.test.ts`). persist 스키마 무변경 (파생 selector — 영속 필드 추가 0). **페이지 임베드는 D3 (VerdictCard 실사용처 0건) 가 계속 추적** — D3 임베드 시 본 selector 소비. 통계 D 8→7 / P1 18→17 / 합계 54→53. D4 P1 SLA 만기 2026-06-16 6일 전 충족. |
| 2026-06-10 | PR-A7-ShadowLearningSummary-BE | A7 (ADR-0124 PR-H 후속, ADR 발급 0건 patch type) 소진 — 행 삭제. `buildShadowLearningSummary` reportLine/narrativeLine 에 BE 카운트 조건부 표기 (`본절 fill N건`, BE>0 시에만 — 선례 PR-E/F/G 동일 규칙). 데이터 공급: `aggregateFillStats(loadShadowTrades())` SSOT read-only (ADR-0112 분류, WIN_PCT_MIN=1.0 / BE band -0.5~+0.5). `ShadowLearningSummary.beFills?` additive optional (기존 호출자 `reportGenerator.loadDailyShadowLearningLines` 무수정). `BE_CLASSIFICATION_DISABLED=true` 시 SSOT 0 반환 → 자동 silent. 데이터 부족 빈 문자열 byte 보존 (hasAnyData 판정 무변경 — BE 단독 라인 생성 금지). 학습 SSOT (aggregateFillStats/nightlyReflection/biasHeatmap) 0줄 변경. 신규 회귀 6 케이스 (`shadowLearningSummaryBeAdr0124.test.ts`). 통계 A 14→13 / P1 17→16 / 합계 53→52. A7 P1 SLA 만기 2026-06-16 6일 전 충족. |
| 2026-06-10 | PR-Learning-Wiring-Burndown | 학습 클러스터 5건 (A10/A12/A13/A14/A15, ADR-0173~0176 후속 wiring, ADR 발급 0건 patch type) 소진 — A10+A15 replay dispatcher 실함수 매핑 (기 머지 `missedLearningReplayDispatcher.ts` 회귀 테스트 보강 + 단일 실패 격리 검증) / A12+A13 일일 cron 신규 wiring (`learningJobs.ts` 'safety_gate_attribution' KST 16:40 + 'shadow_live_delta_report' KST 16:45, TRADING_DAY_ONLY + ENV 첫 분기 + scheduleCatalog 등재) / A14 priceFetcher KIS 일봉(L1) wiring 검증 (`fetchHistoricalClosePrice` — 미래 bar 누출 금지 + 실패 null 회귀 테스트). 5건 모두 → BLOCKED (운영자 ENV 명시 활성화만 잔여, SLA 면제 — 2026-06-17 만기 해소). 진행 통계 무변경 (status 격상만, 카테고리/우선순위 카운트 유지). 전 ENV default OFF — flag OFF runtime byte-equivalent. |
| 2026-06-18 | Patch-Backlog-Discard-KIS-Primary-Conflict | 최신 패치 방향(ADR-0561 KIS-Primary·0601/0614/0617 KIS-native 수급) 충돌 잔여작업 폐기 — **C4**(Naver 외인추세 signalScanner/enemyChecklist wiring: L3→매매결정 승격 = ADR-0561 위반, KIS-native superseded, 프로덕션 소비처 0) + **E6**(Naver dual-source cross-validation: L3↔L1 동격 검증 충돌, production 호출자 0) active table 제거. **A1** 외인/기관 z-score 통합 목적 제거(0614/0617 superseded), VCP 축만 잔존. C4 → ADR-0140 §잔여후속PR 2·3 `FROZEN_L3_NON_EXECUTION_ADR0561` 동결(foreignerRatioRepo 는 `/foreigner_trend` 텔레그램 진단 전용 생존). 통계 52→50(C 10→9·E 10→9·P2 25→24·P3 9→8). 문서 전용·runtime 0·코드 0줄. |
| 2026-06-18 | Patch-Backlog-StaleUserDecision-Cleanup | 오래(43일) 방치돼 맥락 휘발된 사용자결정 부채 7건 처리 — **C16/C17/C18**(8 evaluator status migration·context propagation·Yahoo quoteSummary PER, 진단 정밀화 부채·최근 RS/shadow 방향과 무관·C18은 ADR-0561 D3 긴장) active table 폐기 / **E8·E9·E10·E11**(실행모드 일관성·운영자 모드 제어·KillSwitch 영속강등·학습 execution-mode-skip ESLint, ADR-0395/0148 안전·거버넌스 자산) 은 폐기 대신 **P3→P2 격상 + 재노출**(방치 부채 가시화). 통계 50→47(C 9→6·P3 8→1·P2 24→28). 문서 전용·코드 0줄. |
