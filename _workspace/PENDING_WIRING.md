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
| A1 | 0030 latentSignalScorer | `server/screener/latentSignalScorer.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — watchlistManager tag + stockScreener 통합 + VCP_HUNTER section + 외인/기관 5일 z-score 계산 헬퍼 |
| A2 | 0031 orderTypeOptimizer | `server/trading/orderTypeOptimizer.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | LIVE 회귀 격리 후 wiring — entryEngine `decideOrderType()` 호출 + fillMonitor `recordSlippageEntry()` 호출 + chase 실행 로직 (orderQueue 미체결 1분 후 재발주) |
| A3 | 0006 emitFullCloseAttribution | `server/persistence/attributionRepo.ts` | 2026-05-02 | DECIDED_NOT_WIRING | P0 | **PR-A3-Audit (2026-04-30) 완료** — 100% wired 확정: 전량 청산 6 규칙(hardStopLoss/legacyTakeProfit/cascadeFinal/ma60DeathForceExit/trailingStop/trancheTakeProfitLimit)이 `emitFullCloseAttributionForExit` 직접 호출 wired + 부분 청산 모든 분기는 `reserveSell.ts:102-111` 가 PR-42 M1 으로 `emitPartialAttributionForSell` 자동 호출. 산출물: `_workspace/audit-pr-a3/findings.md` |
| A4 | 0083 walkForwardFramework | `server/learning/walkForwardFramework.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 데이터 6개월 누적 후 — decay='DECAYING' 시 가중치 자동 보수화 |
| A5 | 0084 conditionLifecyclePolicy | `server/learning/conditionLifecyclePolicy.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 데이터 6개월 누적 후 — 27조건 silent/deprecated 가드 wiring (signalScanner / entryRevalidationStep score 보수화) |
| A6 | 0123/0124 recommendationTracker | `server/learning/recommendationTracker.ts` | 2026-05-02 | PARTIAL | P1 | 학습 SSOT 변경 회귀 위험 — monthlyStats.winRate fill 단위 격상 (현재 trade 단위 WIN/LOSS 만, fill 수준 BE 분류 미반영) |
| A7 | 0124 shadowLearningSummary | `server/alerts/shadowLearningSummary.ts` | 2026-05-02 | PARTIAL | P1 | PR-H 후속 — 일일 리포트 라인 BE 표기 추가 |
| A8 | 0160 learningLoopHealth | `server/learning/learningLoopHealth.ts` | 2026-05-02 | PARTIAL | P2 | commit 2258621 머지 시 508 → 460 LoC 변경 (변경 의도 불명확) — 본 모듈 단위 테스트 보강 + ADR-0160 §3 호출자 wiring 검증 |
| A9 | 0160 loadReflectionImpactRecords 활용 | `server/learning/failureToWeight.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | ADR-0160 §1 명시 — F2W reflection multiplier 가 `loadRecentReflections` + `loadFailurePatterns` 만 활용 / `loadReflectionImpactRecords` 본 PR scope 외 — silent/deprecated 모듈 자동 가드 wiring 후속 ADR |

### B. 매매 본체 / 사이징

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| B1 | 0085 TwoBar Confirmation | `server/trading/twoBarConfirmation.ts` | 2026-05-02 | PARTIAL | P0 | **PR-B1-1 (2026-05-01, ADR-0085) SHADOW only 활성** — `BEP_TWO_BAR_LIVE_ENABLED=true` ENV 활성화 운영자 결정 대기 (SHADOW 1주 검증 후) |
| B2 | 0085 Slot Sizing | `server/trading/slotSizing.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | 사용자 결정 대기 — `perSymbolEvaluation.ts:902` `evaluateSlotSizing()` wiring + intraday sizing 동일 분기 — `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true` 명시 활성화 + 1주 검증 후 |
| B3 | 0001 preflight Phase B | `server/trading/signalScanner/preflight.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | LIVE 회귀 위험 격리 — 매크로 게이트 본체 교체 (signalScanner.ts:runPreflight() inline → preflight.ts 위임). signalScanner 분해 Phase B 후속 |
| B4 | 0008 kellyHalfLife | `server/trading/kellyHalfLife.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — 보유 중 재평가 wiring 미완성 (현재 호출자 모두 신규 진입, `timeDecayInput` 미전달) |
| B5 | 0117/0128 entryRevalidationStep | `server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts` | 2026-05-02 | PARTIAL | P1 | 사용자 결정 대기 — DATA_HOLD 분기 SSOT 위임 격상 (현재 진단 디테일 보존 vs 일관성 trade-off) |
| B6 | 0001 Phase B | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 + LIVE 회귀 격리 — evaluateBuyList god function (cc=244) 본체 추가 분해 (인라인 데이터 페치 / Gate revalidation wrapping / 진단 메시지 빌더) |
| B7 | 0085 price7dAgo | `server/persistence/shadowTradeRepo.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — `riskManager.ts:39` 가 reader 사용 (과열 부분 매도). 매수 시점 7일 lookback OHLCV 영속 wiring 미구현 — buyPipeline.buildBuyTrade 또는 신규 cron 에서 외부 OHLCV fetch 후 영속 |
| B8 | 0161~0165 PositionSizingEngine | `server/trading/sizing/positionSizingEngine.ts` | 2026-05-02 | PARTIAL | P2 | **Phase1+2D+Extension+Drawdown+LIVE Activation wiring 완료** (ADR-0161~0165) — P0 SLA 충족 (2026-05-23 만기 21일 전 LIVE Activation 완료). 4 진입 경로 + peakEquity 영속 (SHADOW/LIVE 분리) + drawdown 자동 차단 + LIVE 활성화 ENV `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` (default OFF). **잔여 2 PR (P2)**: lossStreak 외부 학습 SSOT 결합 + universe/sectorWeight 결합. 운영자 활성화 절차 (ADR-0165 §3): SHADOW 1주 검증 → ENV 활성화 → 만족 시 운영 유지. |
| B9 | 0166+0167+0169+0170 RegimeExposureBudget | `server/trading/sizing/regimeExposurePolicy.ts` | 2026-05-02 | PARTIAL | P2 | **Phase A+B+AccurateExposure+AddOnBuy+AutoMapping wiring 완료** (ADR-0166+0167+0169+0170) — 7 레짐 매트릭스 + 4 wiring + 정확 산출 SSOT + trancheExecutor 추매 진입점 (`isAddOnBuy=true`) + 매크로 신호 R1_DEFENSIVE 자동 격상 (`mapInternalToExposureRegimeWithMacro`, ENV `EXPOSURE_REGIME_AUTO_MAPPING_DISABLED=true` default OFF). audit-PR-520 §M1+§M2+§M4 수리 완료 (PR #525 + #527 + #528) — **§"Medium 4건" 모두 수리 완료**. **잔여 2 PR (P2)**: currentPriceMap 시가 평가 (KIS 호출) + UI 출력. 활성화 절차 (ADR-0166 §7 + ADR-0167 §7): SHADOW APPLY → EXPOSURE BUDGET → ACCURATE EXPOSURE → LIVE 4단계. |
| B10 | 0172 SizingEngine marketCap 잔여 | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | **PR-Sizing-Engine-Real-Data (2026-05-02, ADR-0172) 부분 완료** — `avgDailyVolume20d` + `currentSectorWeight` 2 axis 실데이터 wiring 완료 (`computeSizingLiquidityInputs` SSOT + 4 호출자 wiring). **잔여 1 axis (P2)**: `marketCap` Yahoo Finance chart API 미제공 → KIS 기업 정보 API (CTPF1002R) 결합 후 실값 전달 필요. 외부 의존성 — KIS quota 영향 평가 + ADR-0011 정책 검토 후 진행. SLA 미적용 (외부 의존성 면제 — ADR-0158 §"면제 정책"). |

### C. 시그널 입력 (Diag-2~5 의사결정 wiring)

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| C1 | 0137 KIS 종목별 프로그램매매 | `server/clients/kisClient/query.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 1~2주 누적 후 — enrichment 시그널 + signalScanner 가중치 wiring |
| C2 | 0138 KIS 시장 종합 프로그램매매 | `server/clients/kisClient/query.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 1~2주 누적 후 — regime 가중치 wiring |
| C3 | 0139 ECOS 신용공여 | `server/clients/ecosClient.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | STAT_CODE 운영 검증 + 데이터 누적 후 — enemyChecklist 활성화 + regime 보수화 wiring |
| C4 | 0140 Naver 외인 추세 | `server/persistence/foreignerRatioRepo.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 6영업일 누적 후 — enrichment 시그널 + signalScanner 가중치 + enemyChecklist 외인 이탈 플래그 wiring |
| C5 | 0142 FSS Mapping | `server/persistence/fssMappingPolicy.ts` | 2026-05-02 | BLOCKED | P2 | 운영자 결정 + 1~2주 데이터 누적 후 — `FSS_MAPPING_ENABLED=true` ENV 활성화 결정 대기 (`/fss_mapping` 검증 + 시장 행동 일치도 확인) |
| C6 | 0136 PR-1 후속 | `server/trading/regimeBridge.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | regime 의사결정 회귀 격리 — `passiveActiveBoth=null → R3_EARLY 트리거 보수화` wiring |
| C7 | 0149/0150 Phase 1 DART 마무리 | `src/services/stock/enrichment.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P0 | **PR-Phase1-DartFinalize (2026-05-01) 완료** — `performanceReality` (#15) ← `epsGrowth > 0` + `economicMoatVerified` (#8) ← `debtRatio < 50% AND netProfitMargin > 5%` 합성 main + aiFallback 두 경로 격상 + `buildConditionSourceTiers` 5 키 'API' 격상. ADR-0150 발행. 27 조건 격상 진행도 44% → 52% (12 → 14개). |
| C8 | 0149/0151 Phase 2 KIS supply audit | `src/services/stock/enrichment.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P1 | **PR-Phase2-KisSupplyAudit (2026-05-01) 완료** — audit findings §B 권고가 부정확 함을 확정. ADR-0011 PR-25-C 정책 (KIS 호출 금지 + AI 위임) 후 main path 의 0 박제가 silent degradation 결함이었음. ADR-0151 발행. |
| C15 | 0151/0152 Naver 외인 추세 endpoint 신설 | `server/routes/foreignerRatioRouter.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P2 | **PR-Phase2-Real-Phase3 (2026-05-01) 완료** — `GET /api/foreigner-ratio/trend?code=...` HTTP endpoint + 클라 SDK + main path enrichment wiring + #4 supplyInflow 격상. ADR-0152 발행. |
| C9 | 0149/0153 Phase 3 globalIntel 합성 | `src/services/quant/globalIntelSynthesis.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P1 | **PR-Phase2-Real-Phase3 (2026-05-01) 완료** — synthesizeRiskOnEnvironment / synthesizeCycleVerified / synthesizePolicyAlignment 3 합성 헬퍼 SSOT + main + aiFallback 두 경로 wiring + 'API' tier 격상 (3 키). ADR-0153 발행. |
| C10 | 0149/0154/0156 Phase 4 외부 컨센서스 | `server/clients/yahooConsensusClient.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P2 | **PR-Phase5 (2026-05-01) 완료** — ADR-0156 옵션 A 변형 채택 (Yahoo 무료 quoteSummary recommendationTrend + earningsHistory). `consensusTarget` (#13) + `earningsSurprise` (#14) 격상. 27 조건 격상 진행도 70% → 78%. |
| C11 | 0149/0154 #9 notPreviousLeader | (정성 — 격상 불가) | 2026-05-01 | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (직전 사이클 주도주 회피, 시점 의존 + 정성 평가) — AI 추정 영구 잔존 |
| C12 | 0149/0154 #17 psychologicalObjectivity | (정성 — 격상 불가) | 2026-05-01 | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (사용자 메타 인지, 정량 대리 지표 없음) — AI 추정 영구 잔존 |
| C13 | 0149/0154 #20 elliottWaveVerified | (정성 — 격상 불가) | 2026-05-01 | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (엘리엇 파동 카운팅) — AI 추정 영구 잔존 |
| C14 | 0149/0154 #26 divergenceCheck | (정성 — 격상 불가) | 2026-05-01 | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (역전 판단) — AI 추정 영구 잔존 |

### D. UI Phase B/C/D wiring

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| D1 | 0098 ConfluenceMeter | `src/components/common/ConfluenceMeter.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | UI 가시성 — DiscoverWatchlistPage Top 3 시범 임베드 + VerdictCard.Evidence 안 자식 |
| D2 | 0098 confluenceEngine | `server/learning/walkForwardFramework.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 (신규 모듈) — 백엔드 4축 score 산출 wiring + 결손 사유 자동 생성 (백엔드 데이터 출처 + 결손 패턴 매핑) |
| D3 | 0097 VerdictCard | `src/components/watchlist/WatchlistCard.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P1 | UI 가시성 — WatchlistCard 마이그레이션 (variant='verdict' 점진 도입). 50+ 컴포넌트 점진 |
| D4 | 0019 RecommendationSnapshot wiring | `src/services/quant/recommendationSnapshotRepo.ts` | 2026-05-02 | PARTIAL | P1 | UI 가시성 — `createdAt` / `expiresAt` wiring (TimeBand 연동) |
| D5 | 0096 DataQualityRibbon + IDontKnow | `src/components/common/DataQualityRibbon.tsx` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — MarketOverviewHeader / DiscoverWatchlistPage 페이지 상단 임베드 |
| D6 | 0094 UI_LANG.confluence | `src/config/uiLanguage.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — ConfluenceMeter 4축 라벨 SSOT 격상 (현재 컴포넌트 내부 AXIS_LABEL 상수) |
| D7 | 0099 Verbosity Wiring | `src/components/common/UIVerbosityToggle.tsx` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — 5 wiring PR 완주 (PR-Z14~Z18) 후 사용처 점진 마이그레이션 |

### E. 영속 / 진단 / 정합

| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|--------|------|----------|----------------------|
| E1 | 0113 Corporate Action Ledger | `docs/adr/0113-yahoo-drift-tiered-sanity-and-corporate-action-detector.md` | 2026-05-02 | INFRASTRUCTURE_ONLY | P3 | 외부 API 인증 키 확보 후 — DART 공시 매칭 + PriceSnapshot 4 필드 영속 + 24h 격리 + KRX/DART 출처 cumulativeFactor + `getAdjustmentFactor(code, date)` |
| E2 | 0128 dartPoller | `server/alerts/dartPoller.ts` | 2026-05-02 | PARTIAL | P2 | 운영 데이터 누적 후 — `getCorpEventLookback` wiring (corp event 타입별 lookback 차등 90/60/30/14/7일) |
| E3 | 0128 HELD_POSITION 자동 탐지 | `server/data/dataHoldRolePolicy.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 (별도 ADR) — 현재 호출자가 명시 전달, 자동 분류 SSOT |
| E4 | 0090 Cache Coherence Auditor | `server/persistence/cacheCoherenceAuditor.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | 운영 데이터 누적 후 — invariant 확장 (WATCHLIST/MACRO_STATE 등) + Phase 2 cron 자동 audit 발행 + Phase 3 자동 수정 도구 |
| E5 | 0145 KIS GitHub 재검증 | `server/clients/kisClient/query.ts` | 2026-05-01 | DECIDED_NOT_WIRING | P3 | **ADR-0145 정책** — 6개월 주기 검증 (다음: 2026-11-01) — 현재 endpoint/TR ID 정합 운영 모니터링 |
| E6 | 0136~0140 dual-source cross-validation | `server/trading/crossSourceValidator.ts` | 2026-05-02 | INFRASTRUCTURE_ONLY | P3 | 외부 의존성 변경 후 — KRX 외인 + Naver / ECOS + KRX 신용공여 dual-source. ADR-0071 패턴 차용한 별도 후속 PR |
| E7 | 0160 check:learning-boundary validate:all 통합 | `scripts/check_learning_channel_boundary.js` | 2026-05-02 | INFRASTRUCTURE_ONLY | P2 | ADR-0160 §4 명시 — 현재 standalone 명령 (`npm run check:learning-boundary`). `validate:all` 17종 격상으로 precommit 자동 차단 — 회귀 위험 격리를 위해 후속 PR 분리 |

## 진행 통계

| 카테고리 | 항목 수 | P0 | P1 | P2 | P3 |
|----------|---------|----|----|----|----|
| A. 학습 시리즈 | 9 | 1 | 3 | 5 | 0 |
| B. 매매 본체 | 10 | 1 | 3 | 6 | 0 |
| C. 시그널 입력 | 15 | 1 | 3 | 7 | 4 |
| D. UI Phase | 7 | 0 | 3 | 4 | 0 |
| E. 영속/진단 | 7 | 0 | 0 | 4 | 3 |
| **합계** | **48** | **3** | **12** | **26** | **7** |

> 주: C7 (Phase 1) / C8 (Phase 2 audit) / C9 (Phase 3 globalIntel) + C15 (Naver 외인 추세) / **C10 (Phase 4 Yahoo 컨센서스) + #12 institutionalBuying (KRX 5d) PR-Phase5** 모두 *DECIDED_NOT_WIRING* 격상 완료. 27 조건 격상 시리즈 *데이터 가용 한계 도달 — 78% (21/27)*. 잔여 22% (5 키 — #9/#13/#17/#20/#26) 정성 영구 (ADR-0154). 정량 격상 후속 0건. 운영자 집중 영역 = Gemini 프롬프트 품질 + AI 추정 가중치 학습.

## P0 즉시 wiring 권장 (자기학습 freeze 진원지)

1. **A3 emitFullCloseAttribution** — ✅ **완료** (PR-A3-Audit 2026-04-30).
2. **B1 TwoBar Confirmation BEP_PROTECTION** — ✅ **SHADOW only 활성** (PR-B1-1 2026-05-01, ADR-0085).
3. **C7 Phase 1 DART 마무리** — ✅ **완료** (PR-Phase1-DartFinalize 2026-05-01, ADR-0150). 27 조건 격상 52%.
4. **C8 Phase 2 KIS supply audit** — ✅ **완료** (PR-Phase2-KisSupplyAudit 2026-05-01, ADR-0151).
5. **C15 Naver 외인 추세 endpoint** — ✅ **완료** (PR-Phase2-Real-Phase3 2026-05-01, ADR-0152). #4 supplyInflow 격상. 27 조건 격상 56%.
6. **C9 Phase 3 globalIntel 합성** — ✅ **완료** (PR-Phase2-Real-Phase3 2026-05-01, ADR-0153). #5/#1/#16 격상. 27 조건 격상 67%.
7. **#12 institutionalBuying — KRX 5d 기관** — ✅ **완료** (PR-Phase5 2026-05-01, ADR-0155). 27 조건 격상 70%.
8. **C10 Phase 4 외부 컨센서스 (Yahoo)** — ✅ **완료** (PR-Phase5 2026-05-01, ADR-0156). #14/#13 격상. 27 조건 격상 **78% — 데이터 가용 한계**.
9. **driftGuard 근본 해결** — ✅ **완료** (PR-Phase5 2026-05-01, ADR-0157). `evaluateFeedbackLoop` 옵셔널 `now?: Date` 인자 + 테스트 측 `vi.useFakeTimers` 폐기.

## 진행 중 잔여

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
