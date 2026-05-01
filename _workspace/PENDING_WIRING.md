# Pending Wiring Backlog — QuantMaster Pro

@responsibility Wiring 미완 PR 단일 추적 SSOT — 인프라만 머지된 ADR 의 호출자 wiring 상태 가시화.

## 목적

ADR 들이 *인프라 (영속 + SSOT 함수 + 회귀 테스트)* 만 머지하고 *호출자 wiring (LIVE 매매·UI·진단 경로 활성화)* 은 회귀 위험 격리 / 운영 데이터 누적 / 사용자 결정 대기 사유로 후속 PR 분리되는 패턴이 누적. 본 백로그가 단일 추적 SSOT — *영원히 dead code 로 남는 결함* 영구 차단.

## 룰

1. **PR 머지 시 wiring 미완 명시** — PR 노트의 "잔여 후속 PR" / "scope 밖" / "wiring 후속" 항목을 본 백로그에 1회 등록 의무.
2. **wiring 완료 시 항목 제거** — 후속 PR 머지 시 본 백로그 해당 항목 *삭제* + CLAUDE.md 변경 이력 인용.
3. **상태 4 단계** — `INFRASTRUCTURE_ONLY` (인프라만, 호출자 0건) / `PARTIAL` (일부 호출자 wired, 일부 잔여) / `BLOCKED` (외부 의존성·운영 데이터·사용자 결정 대기) / `DECIDED_NOT_WIRING` (의도된 SSOT/유틸 함수, 영구 미사용 허용).
4. **우선순위 3 등급** — `P0` LIVE 매매 또는 자기학습 결함 (즉시 wiring 권장) / `P1` UI 가시성 또는 진단 정합 (1~2주 내) / `P2` 운영 데이터 누적 후 (1~3개월) / `P3` 외부 의존성 변경 후 (불확정).

## 후속 PR 백로그

### A. 학습 시리즈 (Shadow / Self-Learning)

| ID | ADR | 모듈 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|------|----------|----------------------|
| A1 | 0030 latentSignalScorer | `server/screener/latentSignalScorer.ts` | INFRASTRUCTURE_ONLY | P2 | watchlistManager tag + stockScreener 통합 + VCP_HUNTER section + 외인/기관 5일 z-score 계산 헬퍼 — 운영 데이터 누적 후 |
| A2 | 0031 orderTypeOptimizer | `server/trading/orderTypeOptimizer.ts` | INFRASTRUCTURE_ONLY | P1 | entryEngine `decideOrderType()` 호출 + fillMonitor `recordSlippageEntry()` 호출 + chase 실행 로직 (orderQueue 미체결 1분 후 재발주) — LIVE 회귀 격리 후 wiring |
| A3 | 0006 emitFullCloseAttribution | `server/persistence/attributionRepo.ts` | INFRASTRUCTURE_ONLY | P0 | 5 청산 규칙 (hardStopLoss/legacyTakeProfit/cascadeFinal/ma60DeathForceExit/r6EmergencyExit) + 2 OCO 분기 (ocoCloseLoop STOP_FILLED/PROFIT_FILLED) wiring — *학습 freeze 진원지*, 4 PR 분할 권장 (2026-04-30 audit) |
| A4 | 0083 walkForwardFramework | `server/learning/walkForwardFramework.ts` | INFRASTRUCTURE_ONLY | P2 | decay='DECAYING' 시 가중치 자동 보수화 — 데이터 6개월 누적 후 |
| A5 | 0084 conditionLifecyclePolicy | `server/learning/conditionLifecyclePolicy.ts` | INFRASTRUCTURE_ONLY | P2 | 27조건 silent/deprecated 가드 wiring (signalScanner / entryRevalidationStep score 보수화) — 데이터 6개월 누적 후 |
| A6 | 0123/0124 recommendationTracker | `server/learning/recommendationTracker.ts` | PARTIAL | P1 | monthlyStats.winRate fill 단위 격상 (현재 trade 단위 WIN/LOSS 만, fill 수준 BE 분류 미반영) — 학습 SSOT 변경 회귀 위험 |
| A7 | PR-H shadowLearningSummary | `server/alerts/shadowLearningSummary.ts` | PARTIAL | P1 | 일일 리포트 라인 BE 표기 추가 (PR-H 후속) |

### B. 매매 본체 / 사이징

| ID | ADR | 모듈 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|------|----------|----------------------|
| B1 | 0085 TwoBar Confirmation | `server/trading/twoBarConfirmation.ts` | INFRASTRUCTURE_ONLY | P0 | `exitEngine/rules/hardStopLoss.ts` BEP_PROTECTION 분기 wiring + `bepGlideTouchAt` 영속 갱신 (1차 터치 시 save) — LIVE 청산 회귀 격리 |
| B2 | 0085 Slot Sizing | `server/trading/slotSizing.ts` | INFRASTRUCTURE_ONLY | P1 | `perSymbolEvaluation.ts:902` `evaluateSlotSizing()` wiring + intraday sizing 동일 분기 — `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true` 명시 활성화 + 1주 검증 후 |
| B3 | 0001 preflight Phase B | `server/trading/signalScanner/preflight.ts` | INFRASTRUCTURE_ONLY | P1 | 매크로 게이트 본체 교체 (signalScanner.ts:runPreflight() inline → preflight.ts 위임) — LIVE 회귀 위험 격리, signalScanner 분해 Phase B 후속 |
| B4 | 0008 kellyHalfLife | `server/trading/kellyHalfLife.ts` | PARTIAL | P2 | 보유 중 재평가 wiring 미완성 (현재 호출자 모두 신규 진입, `timeDecayInput` 미전달) — 운영 데이터 누적 후 |
| B5 | 0117/0128 entryRevalidationStep | `server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts` | PARTIAL | P1 | DATA_HOLD 분기 SSOT 위임 격상 (현재 진단 디테일 보존 vs 일관성 trade-off) — 사용자 결정 대기 |
| B6 | ADR-0001 Phase B | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | PARTIAL | P2 | evaluateBuyList god function (cc=244) 본체 추가 분해 (인라인 데이터 페치 / Gate revalidation wrapping / 진단 메시지 빌더) — 운영 데이터 누적 후, LIVE 회귀 격리 |
| B7 | 과열 신호 #3 price7dAgo | `server/persistence/shadowTradeRepo.ts` | INFRASTRUCTURE_ONLY | P2 | `riskManager.ts:39` 가 reader 사용 (과열 부분 매도). 매수 시점 7일 lookback OHLCV 영속 wiring 미구현 — buyPipeline.buildBuyTrade 또는 신규 cron 에서 외부 OHLCV fetch 후 영속 |

### C. 시그널 입력 (Diag-2~5 의사결정 wiring)

| ID | ADR | 모듈 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|------|----------|----------------------|
| C1 | 0137 KIS 종목별 프로그램매매 | `server/clients/kisClient/query.ts` | INFRASTRUCTURE_ONLY | P2 | enrichment 시그널 + signalScanner 가중치 wiring — 운영 데이터 1~2주 누적 후 |
| C2 | 0138 KIS 시장 종합 프로그램매매 | `server/clients/kisClient/query.ts` | INFRASTRUCTURE_ONLY | P2 | regime 가중치 wiring — 운영 데이터 1~2주 누적 후 |
| C3 | 0139 ECOS 신용공여 | `server/clients/ecosClient.ts` | INFRASTRUCTURE_ONLY | P2 | enemyChecklist 활성화 + regime 보수화 wiring — STAT_CODE 운영 검증 + 데이터 누적 후 |
| C4 | 0140 Naver 외인 추세 | `server/persistence/foreignerRatioRepo.ts` | INFRASTRUCTURE_ONLY | P2 | enrichment 시그널 + signalScanner 가중치 + enemyChecklist 외인 이탈 플래그 wiring — 6영업일 누적 후 |
| C5 | 0142 FSS Mapping | `server/persistence/fssMappingPolicy.ts` | BLOCKED | P2 | `FSS_MAPPING_ENABLED=true` ENV 활성화 — 운영자가 `/fss_mapping` 검증 + 시장 행동 일치도 확인 + 1~2주 데이터 누적 후 결정 |
| C6 | 0136 PR-1 후속 | `server/trading/regimeBridge.ts` | INFRASTRUCTURE_ONLY | P1 | `passiveActiveBoth=null → R3_EARLY 트리거 보수화` wiring — regime 의사결정 회귀 격리 |

### D. UI Phase B/C/D wiring

| ID | ADR | 모듈 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|------|----------|----------------------|
| D1 | 0098 ConfluenceMeter | `src/components/common/ConfluenceMeter.tsx` | INFRASTRUCTURE_ONLY | P1 | DiscoverWatchlistPage Top 3 시범 임베드 + VerdictCard.Evidence 안 자식 |
| D2 | 0098 confluenceEngine | `server/learning/confluenceEngine.ts` (신규) | INFRASTRUCTURE_ONLY | P2 | 백엔드 4축 score 산출 wiring + 결손 사유 자동 생성 (백엔드 데이터 출처 + 결손 패턴 매핑) |
| D3 | 0097 VerdictCard | `src/components/watchlist/WatchlistCard.tsx` | INFRASTRUCTURE_ONLY | P1 | WatchlistCard 마이그레이션 (variant='verdict' 점진 도입) — 50+ 컴포넌트 점진 |
| D4 | 0019 RecommendationSnapshot wiring | `src/services/quant/recommendationSnapshotRepo.ts` | PARTIAL | P1 | `createdAt` / `expiresAt` wiring (TimeBand 연동) |
| D5 | 0096 DataQualityRibbon + IDontKnow | `src/components/common/DataQualityRibbon.tsx` | INFRASTRUCTURE_ONLY | P2 | MarketOverviewHeader / DiscoverWatchlistPage 페이지 상단 임베드 |
| D6 | 0094 UI_LANG.confluence | `src/config/uiLanguage.ts` | INFRASTRUCTURE_ONLY | P2 | ConfluenceMeter 4축 라벨 SSOT 격상 (현재 컴포넌트 내부 AXIS_LABEL 상수) |
| D7 | 0099 Verbosity Wiring | `src/components/**/*.tsx` | PARTIAL | P2 | 5 wiring PR 완주 (PR-Z14~Z18) 후 사용처 점진 마이그레이션 — VerdictCard / ConfluenceMeter / Ribbon / IDontKnow / DataQualityBadge / GateStatusCard 모두 forceShow 패턴 적용. wiring 외 잔여 0건 |

### E. 영속 / 진단 / 정합

| ID | ADR | 모듈 | 상태 | 우선순위 | 차단 사유 / 다음 액션 |
|----|-----|------|------|----------|----------------------|
| E1 | 0113 Corporate Action Ledger | `server/data/corporateActions.ts` (신규) | INFRASTRUCTURE_ONLY | P3 | DART 공시 매칭 + PriceSnapshot 4 필드 영속 + 24h 격리 + KRX/DART 출처 cumulativeFactor + `getAdjustmentFactor(code, date)` — 외부 API 인증 키 확보 후 |
| E2 | 0128 dartPoller | `server/scheduler/dartPoller.ts` | PARTIAL | P2 | `getCorpEventLookback` wiring (corp event 타입별 lookback 차등 90/60/30/14/7일) |
| E3 | 0128 HELD_POSITION 자동 탐지 | `server/data/dataHoldRolePolicy.ts` | INFRASTRUCTURE_ONLY | P2 | 현재 호출자가 명시 전달, 자동 분류 SSOT — 별도 ADR + 운영 데이터 누적 후 |
| E4 | 0090 Cache Coherence Auditor | `server/persistence/cacheCoherenceAuditor.ts` | INFRASTRUCTURE_ONLY | P2 | invariant 확장 (WATCHLIST/MACRO_STATE 등) + Phase 2 cron 자동 audit 발행 + Phase 3 자동 수정 도구 |
| E5 | 0145 KIS GitHub 재검증 | `server/clients/kisClient/query.ts` | DECIDED_NOT_WIRING | P3 | 6개월 주기 검증 (다음: 2026-11-01) — 현재 endpoint/TR ID 정합 운영 모니터링 |
| E6 | 0136~0140 dual-source cross-validation | `server/trading/crossSourceValidator.ts` | INFRASTRUCTURE_ONLY | P3 | KRX 외인 + Naver / ECOS + KRX 신용공여 dual-source — ADR-0071 패턴 차용한 별도 후속 PR |

## 진행 통계

| 카테고리 | 항목 수 | P0 | P1 | P2 | P3 |
|----------|---------|----|----|----|----|
| A. 학습 시리즈 | 7 | 1 | 3 | 3 | 0 |
| B. 매매 본체 | 7 | 1 | 3 | 3 | 0 |
| C. 시그널 입력 | 6 | 0 | 1 | 5 | 0 |
| D. UI Phase | 7 | 0 | 3 | 4 | 0 |
| E. 영속/진단 | 6 | 0 | 0 | 3 | 3 |
| **합계** | **33** | **2** | **9** | **19** | **3** |

## P0 즉시 wiring 권장 (자기학습 freeze 진원지)

1. **A3 emitFullCloseAttribution** (4 PR 분할, 2026-04-30 audit) — `attributionRepo.ts` `emitFullCloseAttribution(input)` SSOT 신설 + `helpers/attribution.ts` `emitFullCloseAttributionForExit(shadow, exit)` wrapper + 5 청산 규칙 try/catch 격리 wiring + 2 OCO 분기 동일 + `entryConditionScores` 영속 audit (전제 조건 PR).
2. **B1 TwoBar Confirmation BEP_PROTECTION** — `exitEngine/rules/hardStopLoss.ts` BEP_PROTECTION 분기에 `evaluateTwoBarConfirmation()` 호출 추가 — 단봉 노이즈 청산 차단 즉시 효과 + `bepGlideTouchAt` 영속 갱신.

## 후속 PR — 자동 audit 정적 스크립트

본 백로그 갱신 누락 차단을 위해 후속 PR 에서 `scripts/check_pending_wiring.js` 신규 — CLAUDE.md "후속 PR" / "wiring 후속" / "scope 밖" 표현 grep 결과 vs 본 파일 §"후속 PR 백로그" 표 정합 검증 + `validate:all` 통합. 본 PR 은 인프라 수동 작성만, 자동 검사는 별도 PR 분리 (회귀 위험 격리).

## 변경 이력

| 날짜 | PR | 내용 |
|------|----|------|
| 2026-05-01 | PR-Governance-1 | 초기 백로그 작성 — 5 카테고리 32 항목 + 4 상태 / 3 우선순위 SSOT |
