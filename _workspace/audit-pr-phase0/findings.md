# PR-Phase0-Audit findings (read-only audit, 27조건 격상 사전 검증)

날짜: 2026-05-01 / KIS·KRX quota 0 침범 / LIVE 매매 본체 0줄 변경 / 코드 수정 0건

## 요약

| 외부 지침서 권장사항 | 검증 결과 |
|---|---|
| #1 Phase 1 펀더멘털 4개 격상 ~150 LoC | 🟡 부분 일치 — 3/4 이미 완료, 실제 ~30~50 LoC |
| #2 4-Tier hierarchy 강등 | ❌ 불일치 — 현재 3-Tier (COMPUTED/API/AI_INFERRED) 사용 중 |
| #3 AI fallback 비용 감소 (`if (allHigherTiersAvailable) skipAi()`) | ❌ 패턴 부재 (already optimized, 다른 방식) |
| #4 27조건 격상 후 78% 실데이터 | 🟡 부분 일치 — Phase 4 누적 후만 가능 (Phase 1 만으로는 52%) |

**결론**: 후속 PR 진입 *조건부 권장*. 외부 지침서 *부분 outdated*. 권장 변경 — Phase 1 scope 를 *마무리 작업 (~50 LoC)* 으로 재책정 + **Phase 1 진입 전 *Phase 0 (mapping fix)* 의무 선결** (학습 baseline 오염 위험 차단).

---

## A. `buildConditionSourceTiers()` 매핑 정확도

`src/services/stock/enrichment.ts:61-86` 분석 결과 27 키 분류:

| Tier | 개수 | ChecklistKey |
|---|---|---|
| COMPUTED | 1 | `vcpPattern` (#25) |
| API | 5 | `roeType3` (#3), `ocfQuality` (#21), `interestCoverage` (#23), `institutionalBuying` (#12), `supplyInflow` (#4) |
| AI_INFERRED | 21 | 나머지 (default fallback) |

### ⚠️ SSOT drift 검출

- **클라이언트 `evolutionEngine.ts:56-69`** `REAL_DATA_CONDITIONS = [2, 6, 7, 10, 11, 18, 19, 24, 25]` (9개 COMPUTED)
- **클라이언트 `enrichment.ts:61-86`** COMPUTED = #25 만 (1개)

→ 두 SSOT 가 *의도적으로 다른 의미* (학습 가중치 정책 vs 실제 출처 정직 분류). 동일 변수명 `'COMPUTED'` 사용으로 혼동 위험 — 결함 아님이지만 ADR 명문화 권장.

### 외부 지침서 #2 4-Tier 검증
- 현재 3-Tier (COMPUTED/API/AI_INFERRED, `src/types/ui.ts:34`)
- UI 측은 PR-Z8 ADR-0095 5-Tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL)
- *명시적 매핑 layer 부재* — 4-Tier 격상 시 `VERIFIED ← COMPUTED / EXTERNAL ← API / DELAYED ← (신규) / ESTIMATED ← AI_INFERRED` 매핑 필요

---

## B. DART wiring 현황

### DART 산출 데이터 (`src/services/stock/dartDataFetcher.ts:31-98`)
6개: `roe / debtRatio / interestCoverageRatio / netProfitMargin / epsGrowth / ocfGreaterThanNetIncome`

### DART → 27조건 매핑 현황

| ChecklistKey | DART 격상 상태 | 코드 위치 |
|---|---|---|
| `roeType3` (#3) | ✅ **이미 완료** | `enrichment.ts:459, 337` (main + aiFallback) |
| `ocfQuality` (#21) | ✅ **이미 완료** | `enrichment.ts:460, 338` |
| `interestCoverage` (#23) | ✅ **이미 완료** | `enrichment.ts:461, 339` |
| `debtRatio` | ✅ valuation 객체에 저장 | `enrichment.ts:469` (단, checklist 미매핑) |
| `epsGrowth` | ✅ valuation 객체에 저장 | `enrichment.ts:470` (단, `performanceReality` #15 checklist 미매핑) |

### 외부 지침서 #1 검증

**🟡 결과**: 3/4 이미 격상 완료. 외부 지침서가 가정한 ~150 LoC 는 **잘못된 추정** (이미 wired). 실제 추가 작업:
- `performanceReality` (#15) ← `epsGrowth > 0` 매핑 (~4 줄)
- `economicMoatVerified` (#8) ← `debtRatio < 50% AND netProfitMargin > X` 조합 (~10 줄)
- `buildConditionSourceTiers` 의 'API' 분류 갱신 (~3 줄)
- 회귀 테스트 ~20 줄

→ **추정 ~30~50 LoC 만 필요**.

---

## C. conditionScores baseline 누락률 (🚨 P0 결함 검출)

### Schema (`server/persistence/shadowTradeRepo.ts:498`)
```typescript
entryConditionScores?: Record<number, number>;  // ADR-0006 PR-19 baseline
```

### Wiring 호출자 (5 site, `signalScanner/perSymbol/{buyListLoop,intradayLoop}.ts`)
- 4 site `buyListLoop.ts:382, 548, 1071` + dynamic conditionKeys 2개 (`812, 937`)
- 1 site `intradayLoop.ts:138` (hardcoded 'INTRADAY_STRONG')

### 🚨 결정적 결함 #1 — `buildEntryConditionScores` 가 6 키만 인지

`server/learning/entryConditionScores.ts:22-31` + `server/learning/attributionAnalyzer.ts:62-69`:

```typescript
const CONDITION_TO_SERVER_KEY: Record<number, ConditionKey | null> = {
  9:  'ma_alignment',      // 6개만 — 나머지 21개 모두 NEUTRAL=5 박제
  10: 'volume_breakout',
  17: 'relative_strength',
  18: 'momentum',
  20: 'turtle_high',
  25: 'vcp',
};
```

**의미 누락률 ~78%** — 27조건 중 21개가 *영원히 NEUTRAL=5* baseline. attribution 학습 가중치 입력으로서 *조건별 차별화 0*.

### 🚨 결정적 결함 #2 — Server 매핑이 *클라이언트 ChecklistKey 의미와 mismatch*

audit agent 가 처음 발견한 6 키 mismatch 외에, **본 PR 진입 시 추가 검증**으로 *27 ID 모두* 의 의미 정합 확인:

| 서버 ID 의미 (`attributionAnalyzer.CONDITION_NAMES`) | 클라 ID 의미 (`evolutionEngine.ALL_CONDITIONS` + `CHECKLIST_TO_CONDITION_ID`) | 일치 |
|---|---|---|
| 1: 주도주 사이클 | 1: cycleVerified — 주도주 사이클 | ✅ |
| 2: ROE 유형 3 | 2: momentumRanking — 모멘텀 | ❌ |
| 3: 시장 환경 (Risk-On) | 3: roeType3 — ROE 유형 3 | ❌ |
| 4: 기계적 손절 (-30%) | 4: supplyInflow — 수급 질 | ❌ |
| 5: 신규 주도주 | 5: riskOnEnvironment — Risk-On | ❌ |
| 6: 수급 질 개선 | 6: ichimokuBreakout — 일목균형표 | ❌ |
| 7: 일목균형표 | 7: mechanicalStop — 기계적 손절 | ❌ |
| 8: 경제적 해자 | 8: economicMoatVerified — 경제적 해자 | ✅ |
| 9: 기술적 정배열 | 9: notPreviousLeader — 신규 주도주 | ❌ |
| 10: 거래량 실체 | 10: technicalGoldenCross — 정배열 | ❌ |
| 11: 기관/외인 수급 | 11: volumeSurgeVerified — 거래량 | ❌ |
| 12: 목표가 여력 | 12: institutionalBuying — 기관/외인 | ❌ |
| 13: 실적 서프라이즈 | 13: consensusTarget — 목표가 여력 | ❌ |
| 14: 실체적 펀더멘털 | 14: earningsSurprise — 실적 서프라이즈 | ❌ |
| 15: 정책/매크로 | 15: performanceReality — 실체적 펀더멘털 | ❌ |
| 16: 이익의 질 (OCF) | 16: policyAlignment — 정책/매크로 | ❌ |
| 17: 상대 강도 | 17: psychologicalObjectivity — 심리 | ❌ |
| 18: 모멘텀 순위 | 18: turtleBreakout — 터틀 돌파 | ❌ |
| 19: 심리적 객관성 | 19: fibonacciLevel — 피보나치 | ❌ |
| 20: 터틀 돌파 | 20: elliottWaveVerified — 엘리엇 | ❌ |
| 21: 피보나치 | 21: ocfQuality — OCF | ❌ |
| 22: 엘리엇 | 22: marginAcceleration — 마진 가속도 | ❌ |
| 23: 마진 가속도 | 23: interestCoverage — ICR | ❌ |
| 24: 재무 방어력 (ICR) | 24: relativeStrength — 상대강도 | ❌ |
| 25: 변동성 축소 (VCP) | 25: vcpPattern — VCP | ✅ |
| 26: 다이버전스 | 26: divergenceCheck — 다이버전스 | ✅ |
| 27: 촉매제 | 27: catalystAnalysis — 촉매제 | ✅ |

**🚨 27 ID 중 5개만 일치 (1/8/25/26/27), 22개 mismatch**. audit agent 가 보고한 6 키 mismatch 보다 광범위한 결함. 

→ `evolutionEngine.ALL_CONDITIONS` ↔ `CHECKLIST_TO_CONDITION_ID` 는 27/27 완벽 일치. **클라이언트가 진실의 출처**. 서버 `attributionAnalyzer.CONDITION_NAMES` 가 drift 누적된 SSOT.

**📌 27조건 격상 작업의 *전제 조건***: 서버 SSOT 정정 없이 격상 진행 시 *학습 가중치 입력이 잘못된 ID 로 매핑*. 사용자 4/30 보고 후 attribution wiring 단절 결함 (`_workspace/2026-04-30_diagnose-attribution-wiring/findings.md`) 의 *연장선*.

---

## D. Gemini 호출 빈도 + 비용 baseline

### 호출 site
- **서버 14 unique 파일** (`server/clients/geminiClient.ts` 외): aiProvider, dartPoller, globalScanAgent, qualityScorecard, reportGenerator, supplyChainAgent, weeklyDeepAnalysis, weeklyQuantInsight, macroIndexEngine, conditionAuditor, reflectionGemini, personaIdentity, sectorSources, entryEngine
- **클라이언트 12 파일** (`src/services/stock/aiClient.ts` 통로)

### 추천 1회당 호출 수
`useStockSearch.fetchStocks` → `momentumRecommendations.ts:602` `getCachedAIResponse(cacheKey, async () => getAI().models.generateContent(...))`
→ **1건/추천** (캐시 miss 시), 4시간 LS + 메모리 + 서버 Volume 3층 캐시로 *대부분 hit*.
→ enrichment 단계 추가 호출 **0건** (확인).

### 외부 지침서 #3 검증
```bash
$ grep -rn "if.*allHigherTiersAvailable\|skipAi\|tiersAvailable" src/ server/ --include="*.ts"
# 결과 0건
```

❌ 패턴 부재. 그러나 **이미 다른 방식으로 동일 효과 달성**:
- ADR-0064 (PR-α) prefill overlay — Yahoo/ECOS prefilled 로 AI 가격 hallucination 차단
- ADR-0066 (PR-β) SWR 캐시 — 60s fresh + 5min stale
- ADR-0114 DataTrustLayer — TIER 1 (KIS/KRX/DART) → TIER 3 (Gemini narrative_only) 정책

→ Gemini 는 *서술 + 27조건 분류 점수* 에만 사용. 가격 hallucination 자체가 정책 차단됨. 외부 지침서 권장 패턴 *추가 도입 불필요*.

### Budget SSOT
- `server/clients/geminiClient.ts:95` `MONTHLY_BUDGET_USD = 10000` (default)
- `aiCallBudgetRepo` 80/95/100% 임계 경보 (3 bucket: googleSearch / naverFinance / krxStockMasterRefresh)

---

## E. 18 AI_ESTIMATE 항목 4 카테고리 분류

`AI_ESTIMATE_CONDITIONS = [1, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27]`

### 1. ✅ DART 격상 가능 (5~6개)
- **이미 완료 3개**: #3 `roeType3`, #21 `ocfQuality`, #23 `interestCoverage`
- **추가 가능 2~3개**: #15 `performanceReality` (epsGrowth), #8 `economicMoatVerified` (debtRatio+netProfitMargin), #22 `marginAcceleration` (다년 추이, 다회 호출 필요)

### 2. 🟡 다른 데이터 출처 격상 가능 (3~5개)
- #4 `supplyInflow` ← KIS 외인 (PR-Diag-2/3 ADR-0137/0138 인프라 wired, checklist 매핑 미완)
- #12 `institutionalBuying` ← KIS 기관 (동일 — Naver stub 만)
- #14 `earningsSurprise` ← 외부 컨센서스 source 필요 (DART 만으로는 불가)
- #27 `catalystAnalysis` ← DART 공시 (`dartPoller.ts` Telegram alert 만, checklist 점수 wiring 부재)

### 3. 🟡 globalIntel 12 레이어 부분 격상 (2~3개, ~50~80 LoC each)
- #5 `riskOnEnvironment` ← `macroEnv.regime` ('RISK_ON'/'RISK_OFF') + `bearRegimeResult` + `vkospi < 25`
- #1 `cycleVerified` ← `marketRegimeClassifierResult` + `sectorEnergyResult`
- #16 `policyAlignment` ← `bokRateDirection` + `nominalGdpGrowth` + `oeciCliKorea`

### 4. ❌ 격상 불가능 정성 항목 (5개 — 22% 정성 영구 잔존)
- #9 `notPreviousLeader` (정성 — 직전 사이클 주도주)
- #13 `consensusTarget` (외부 컨센서스 source 부재, P3)
- #17 `psychologicalObjectivity` (정성 — 사용자 메타)
- #20 `elliottWaveVerified` (정성 — 엘리엇 파동)
- #26 `divergenceCheck` (정성 — 역전 판단)

### 정확한 격상 가능 비율 (Phase 별 누적)

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| 현재 (이미) | 44% (12개) | REAL_DATA 9 + DART 3 |
| Phase 1 (DART 마무리) | 52% (14개) | + #15, #8 |
| Phase 2 (KIS supply) | 59% (16개) | + #4, #12 wiring |
| Phase 3 (globalIntel 합성) | 70% (19개) | + #5, #1, #16 |
| Phase 4 (외부 컨센서스) | 78% (21개) | + #14, #27 |
| 격상 불가능 (정성) | 100% | 22% (5개) — #9/13/17/20/26 |

✅ **외부 지침서 #4 78% 검증**: *Phase 4 까지 누적 시 정확히 78%*. 단 *Phase 1 만으로는 52%* — 외부 지침서가 *Phase 1 단독으로 78% 가정* 했다면 outdated.

---

## 외부 지침서 4가지 권장사항 검증 결과 종합

1. **#1 Phase 1 ~150 LoC** → 🟡 *3/4 이미 완료*. 실제 ~30~50 LoC 만 필요.
2. **#2 4-Tier hierarchy** → ❌ *현재 3-Tier*. 5-Tier UI 와 정합 위해 매핑 layer 신설 필요.
3. **#3 AI fallback 비용 감소** → ❌ 패턴 부재. *이미 다른 방식으로 동일 효과 달성* (prefill overlay + DataTrustLayer + 캐시 3층).
4. **#4 78% 실데이터** → 🟡 *Phase 4 누적 시* 정확히 78%. Phase 1 단독은 52%.

## 권장 다음 PR (우선순위 변경)

### 🚨 PR-Phase0-MappingFix (P0 — Critical, 진입 의무 선결)

**🚨 결정적 결함 차단** (Audit C-2): 27 ID 중 22개 의미 mismatch + `CONDITION_TO_SERVER_KEY` 6 키 매핑 모두 정정. 27조건 격상의 *전제 조건* — 본 PR 없이 진행 시 학습 baseline 영구 오염.

작업: `server/learning/attributionAnalyzer.ts:25-69` 정정 + ADR-0149 발행 + 회귀 테스트.

### 🥇 PR-Phase1-DartFinalize (P0)

진입 조건: PR-Phase0-MappingFix 머지 후.
작업: `performanceReality` (#15) DART epsGrowth 매핑 + `economicMoatVerified` (#8) debtRatio+netProfitMargin 합성 + sourceTier 'API' 분류 갱신 + 회귀 테스트.
추정: ~50 LoC.

### 🥈 PR-Phase2-KisSupplyWiring (P1)

PR-Diag-2/3 ADR-0137/0138 페치 인프라 위에 `supplyInflow` (#4) + `institutionalBuying` (#12) checklist 매핑 wiring.
추정: ~80 LoC.

### 🥉 PR-Phase3-GlobalIntelSynthesis (P1)

신규 `synthesizeRiskOnEnvironment / synthesizeCycleVerified / synthesizePolicyAlignment` 합성 헬퍼 (#5/#1/#16).
추정: ~150~200 LoC.

### Phase 4 (P2): 외부 컨센서스 source 도입

#13 `consensusTarget`, #14 `earningsSurprise` — 별도 ADR 발행 후 진행. 78% 목표는 본 단계까지 누적.

## PENDING_WIRING.md 등재 권장

- **DECIDED_NOT_WIRING (4건)**: #9 `notPreviousLeader`, #17 `psychologicalObjectivity`, #20 `elliottWaveVerified`, #26 `divergenceCheck` — 정성 항목, 격상 불가능
- **C 카테고리 P3 (1건)**: #13 `consensusTarget` — 외부 컨센서스 source 도입 필요

## 핵심 발견 정리 (key file paths)

- `/home/user/quantmaster-pro/src/services/stock/enrichment.ts:61-86` — `buildConditionSourceTiers` 정의
- `/home/user/quantmaster-pro/src/services/quant/evolutionEngine.ts:7-35` — `ALL_CONDITIONS` (클라이언트 SSOT 진실)
- `/home/user/quantmaster-pro/src/services/quant/evolutionEngine.ts:56-69` — `REAL_DATA_CONDITIONS` SSOT
- `/home/user/quantmaster-pro/src/services/quant/checklistToConditionScores.ts:20-48` — `CHECKLIST_TO_CONDITION_ID` 클라 매핑 (✅ evolutionEngine 과 27/27 일치)
- `/home/user/quantmaster-pro/server/learning/attributionAnalyzer.ts:25-53` — 🚨 `CONDITION_NAMES` 22 ID drift
- `/home/user/quantmaster-pro/server/learning/attributionAnalyzer.ts:62-69` — 🚨 `CONDITION_TO_SERVER_KEY` 6 키 mismatch
- `/home/user/quantmaster-pro/server/learning/entryConditionScores.ts:22-31` — `buildEntryConditionScores` (NEUTRAL=5 fallback, `conditionIdFromServerKey` 위임)
- `/home/user/quantmaster-pro/server/persistence/shadowTradeRepo.ts:498` — `entryConditionScores?` schema
- `/home/user/quantmaster-pro/server/trading/buyPipeline.ts:189, 237-239` — wiring conditional 영속
- `/home/user/quantmaster-pro/src/services/stock/dartDataFetcher.ts:31-98` — DART 6개 데이터 산출
- `/home/user/quantmaster-pro/src/services/stock/aiClient.ts:8-32` — 클라이언트 Gemini 진입점
- `/home/user/quantmaster-pro/server/clients/geminiClient.ts:95` — `MONTHLY_BUDGET_USD` SSOT

## 호출자 매트릭스 (PR-Phase0-MappingFix 영향 분석)

`serverConditionKey` (클라 ID → 서버 키) 호출자 8개:
1. `server/learning/incrementalCalibrator.ts:62, 115`
2. `server/learning/signalCalibrator.ts:56`
3. `server/learning/phaseMapCalibrator.ts:94`
4. `server/learning/weeklySharpeMonitor.ts:46`
5. `server/learning/conditionBoostHints.ts:30`
6. `server/learning/failureToWeight.ts:227`
7. `server/routes/systemRouter.ts:384`
8. `server/trading/signalScanner/__tests__/conditionScoresWiring.test.ts:34`

`conditionIdFromServerKey` (서버 키 → 클라 ID) 호출자 1개:
1. `server/learning/entryConditionScores.ts:27` (buildEntryConditionScores 핵심)

`CONDITION_NAMES` 호출자:
1. `server/routes/systemRouter.ts:350`
2. `server/learning/conditionBoostHints.ts:13`
3. `server/learning/failureToWeight.ts:28`
4. `attributionAnalyzer.ts` 본체

→ 모든 호출자가 *추상화 conditionId* 만 사용. 매핑 정정 자체가 자동 정합 효과. 호출자 코드 변경 불필요.

## 영속 데이터 마이그레이션 정책

- 사용자 명시 정책: *"강제 마이그레이션 금지"* (4/30 보고)
- 본 PR 정책: 영속 데이터 *그대로 보존* + 정정 후 신규 데이터부터 정확. 30일 누적 후 자연 정합.
- 운영자 안내 메시지 후속 PR 검토.
- 깊은 분석/마이그레이션 도구는 후속 PR 분리 (회귀 위험 격리).
