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
| A3 | 0006 emitFullCloseAttribution | `server/persistence/attributionRepo.ts` | DECIDED_NOT_WIRING | P0 | **PR-A3-Audit (2026-05-01) 결과 — 100% wired 확정**: 전량 청산 6 규칙(hardStopLoss/legacyTakeProfit/cascadeFinal/ma60DeathForceExit/trailingStop/trancheTakeProfitLimit)이 `emitFullCloseAttributionForExit` 직접 호출 wired + 부분 청산 모든 분기는 `reserveSell.ts:102-111` 가 PR-42 M1 으로 `emitPartialAttributionForSell` 자동 호출. 지침서 7843c96f 의 5 잔여 (r6/atr/bd/ch/ep) 모두 추가 wiring 불필요 — r6/cascadeHalf/euphoriaPartial/bearishDiv 는 reserveSell 자동 attribution, atrDynamicStop 은 청산 자체 안 함 (hardStopLoss 갱신만). 산출물: `_workspace/audit-pr-a3/findings.md` |
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
| C7 | 0149/0150 Phase 1 DART 마무리 | `src/services/stock/enrichment.ts` | DECIDED_NOT_WIRING | P0 | **PR-Phase1-DartFinalize (2026-05-01) 완료** — `performanceReality` (#15) ← `epsGrowth > 0` + `economicMoatVerified` (#8) ← `debtRatio < 50% AND netProfitMargin > 5%` 합성 main + aiFallback 두 경로 격상 + `buildConditionSourceTiers` 5 키 'API' 격상. ADR-0150 발행. 27 조건 격상 진행도 44% → 52% (12 → 14개). |
| C8 | 0149/0151 Phase 2 KIS supply audit | `src/services/stock/enrichment.ts` | DECIDED_NOT_WIRING | P1 | **PR-Phase2-KisSupplyAudit (2026-05-01) 완료** — audit findings §B 권고가 부정확 함을 확정. ADR-0011 PR-25-C 정책 (KIS 호출 금지 + AI 위임) 후 main path 의 0 박제가 silent degradation 결함이었음. 정정: AI 추정 stock.checklist 보존 + buildConditionSourceTiers 'API' 라벨 폐기. ADR-0151 발행. 진정한 #4/#12 격상은 ADR-0011 정책 변경 (옵션 A) 또는 ADR-0140 endpoint 신설 (C15 옵션 B) 후 별도 ADR. |
| C15 | 0151/0152 Naver 외인 추세 endpoint 신설 | `server/routes/foreignerRatioRouter.ts` | DECIDED_NOT_WIRING | P2 | **PR-Phase2-Real-Phase3 (2026-05-01) 완료** — `GET /api/foreigner-ratio/trend?code=...` HTTP endpoint + 클라 SDK + main path enrichment wiring + #4 supplyInflow 격상 (changePct5d ≥ +1.0%p AND sampleSize ≥ 6 임계). ADR-0152 발행. ADR-0011 정책 무영향. 27 조건 격상 진행도 52% → 56% (14 → 15개). |
| C9 | 0149/0153 Phase 3 globalIntel 합성 | `src/services/quant/globalIntelSynthesis.ts` | DECIDED_NOT_WIRING | P1 | **PR-Phase2-Real-Phase3 (2026-05-01) 완료** — synthesizeRiskOnEnvironment / synthesizeCycleVerified / synthesizePolicyAlignment 3 합성 헬퍼 SSOT + main + aiFallback 두 경로 wiring + 'API' tier 격상 (3 키). ADR-0153 발행. 27 조건 격상 진행도 56% → 67% (15 → 18개). |
| C10 | 0149/0154 Phase 4 외부 컨센서스 | (외부 source 신규 client) | BLOCKED | P2 | **ADR-0154 영구 정책 명문화** — `consensusTarget` (#13) + `earningsSurprise` (#14) — 옵션 A (FnGuide/WiseFn API 인증 키 + 비용 정책) / 옵션 B (사용자 수동 입력 schema) / 옵션 C (Naver scraping) 중 1 진입 트리거 시 별도 ADR. 진행 트리거 없을 시 영구 22% AI 추정 잔존. |
| C11 | 0149/0154 #9 notPreviousLeader | (정성 — 격상 불가) | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (직전 사이클 주도주 회피, 시점 의존 + 정성 평가) — AI 추정 영구 잔존 |
| C12 | 0149/0154 #17 psychologicalObjectivity | (정성 — 격상 불가) | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (사용자 메타 인지, 정량 대리 지표 없음) — AI 추정 영구 잔존 |
| C13 | 0149/0154 #20 elliottWaveVerified | (정성 — 격상 불가) | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (엘리엇 파동 카운팅) — AI 추정 영구 잔존 |
| C14 | 0149/0154 #26 divergenceCheck | (정성 — 격상 불가) | DECIDED_NOT_WIRING | P3 | **ADR-0154 영구 정책** — 정성 항목 (역전 판단) — AI 추정 영구 잔존 |

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
| C. 시그널 입력 | 15 | 1 | 3 | 7 | 4 |
| D. UI Phase | 7 | 0 | 3 | 4 | 0 |
| E. 영속/진단 | 6 | 0 | 0 | 3 | 3 |
| **합계** | **42** | **3** | **12** | **21** | **7** |

> 주: C7 (Phase 1) PR-Phase1-DartFinalize / C8 (Phase 2 audit) PR-Phase2-KisSupplyAudit / C9 (Phase 3 globalIntel) + C15 (Naver 외인 추세) PR-Phase2-Real-Phase3 모두 *DECIDED_NOT_WIRING* 격상 완료. 카운트는 *결정 완료* 도 포함한 백로그 영속화 (drift 추적). C 카테고리 *진행 중* P0/P1 잔여 = 0건. 잔여 격상 후속 — #12 institutionalBuying (ADR-0011 정책 변경 후 별도 ADR), Phase 4 외부 컨센서스 #14/#13 (BLOCKED, 외부 source 부재).

## P0 즉시 wiring 권장 (자기학습 freeze 진원지)

1. **A3 emitFullCloseAttribution** — ✅ **완료** (PR-A3-Audit 2026-04-30).
2. **B1 TwoBar Confirmation BEP_PROTECTION** — ✅ **SHADOW only 활성** (PR-B1-1 2026-05-01, ADR-0085).
3. **C7 Phase 1 DART 마무리** — ✅ **완료** (PR-Phase1-DartFinalize 2026-05-01, ADR-0150). 27 조건 격상 52%.
4. **C8 Phase 2 KIS supply audit** — ✅ **완료** (PR-Phase2-KisSupplyAudit 2026-05-01, ADR-0151).
5. **C15 Naver 외인 추세 endpoint** — ✅ **완료** (PR-Phase2-Real-Phase3 2026-05-01, ADR-0152). #4 supplyInflow 격상. 27 조건 격상 56%.
6. **C9 Phase 3 globalIntel 합성** — ✅ **완료** (PR-Phase2-Real-Phase3 2026-05-01, ADR-0153). #5/#1/#16 격상. 27 조건 격상 67%.

## 진행 중 잔여

- **#12 institutionalBuying 격상** — ADR-0154 권장 옵션 C (KRX OpenAPI 기관 순매수 — 공개 통계 + ADR-0011 정책 무영향 + foreignerRatioRepo 패턴 차용) 후 별도 ADR. 옵션 A (ADR-0011 변경) 는 KIS quota 영향 평가 필요.
- **C10 Phase 4 외부 컨센서스 #14/#13** — ADR-0154 영구 정책 BLOCKED. 옵션 A (FnGuide/WiseFn API 인증 키) / 옵션 B (사용자 수동 입력) / 옵션 C (Naver scraping) 중 1 진입 트리거 시 별도 ADR.
- **driftGuard 근본 해결** — `evaluateFeedbackLoop` 옵셔널 `now?: Date` 인자 추가 (LIVE 매매 영향 평가 후 별도 PR). PR-Phase4-Closeout 에서 `vi.useFakeTimers` 격리만 적용.

## 후속 PR — 자동 audit 정적 스크립트

본 백로그 갱신 누락 차단을 위해 후속 PR 에서 `scripts/check_pending_wiring.js` 신규 — CLAUDE.md "후속 PR" / "wiring 후속" / "scope 밖" 표현 grep 결과 vs 본 파일 §"후속 PR 백로그" 표 정합 검증 + `validate:all` 통합. 본 PR 은 인프라 수동 작성만, 자동 검사는 별도 PR 분리 (회귀 위험 격리).

## 변경 이력

| 날짜 | PR | 내용 |
|------|----|------|
| 2026-05-01 | PR-Governance-1 | 초기 백로그 작성 — 5 카테고리 32 항목 + 4 상태 / 3 우선순위 SSOT |
| 2026-05-01 | PR-Phase0-MappingFix | C7~C14 신규 8 항목 — 27 조건 격상 후속 (Phase 1~4 INFRASTRUCTURE_ONLY/BLOCKED 4 + DECIDED_NOT_WIRING 정성 4). 합계 33→41 / P0 2→3 / P1 9→12 / P2 19→20 / P3 3→7 |
| 2026-05-01 | PR-Phase1-DartFinalize | C7 → DECIDED_NOT_WIRING (Phase 1 완료). performanceReality (#15) + economicMoatVerified (#8) DART 격상 main + aiFallback 두 경로. 27 조건 격상 진행도 44% → 52% (12 → 14개). ADR-0150 발행. 카테고리 카운트 동일 (C 14 / 합계 41). |
| 2026-05-01 | PR-Phase2-KisSupplyAudit | C8 → DECIDED_NOT_WIRING (Phase 2 audit + silent degradation 차단 완료). audit findings §B 권고 정정 (KIS supply 격상 wired 표기는 부정확). ADR-0011 정책 정합 + AI 추정 보존. C15 (Naver 외인 추세 endpoint) 신규 P2 등재. ADR-0151 발행. 27 조건 격상 진행도 52% 그대로 (격상 0, 결함 1건 차단). 카운트 변경 — C 14→15 / P2 6→7 / 합계 41→42. |
| 2026-05-01 | PR-Phase2-Real-Phase3 | C9 (Phase 3 globalIntel 합성) + C15 (Naver 외인 추세 endpoint) 동시 → DECIDED_NOT_WIRING. ADR-0152 + ADR-0153 발행. #4 supplyInflow + #5 riskOnEnvironment + #1 cycleVerified + #16 policyAlignment 4 키 격상. 27 조건 격상 진행도 52% → 67% (14 → 18개). 카테고리 카운트 동일 (C 15 / 합계 42). |
| 2026-05-01 | PR-Phase4-Closeout | ADR-0154 발행 — Phase 4 BLOCKED 영구 정책 + 정성 4 항목 영구 DECIDED_NOT_WIRING + #12 옵션 C 권장 + driftGuard 시간 의존 결함 차단. C10 + C11~C14 정책 SSOT 명문화. 진행 통계 무변경 (정책 ADR 만). 27 조건 격상 시리즈 마무리. |
