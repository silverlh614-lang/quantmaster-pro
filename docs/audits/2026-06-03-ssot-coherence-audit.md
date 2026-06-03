# SSOT Coherence Audit — "Ledger Re-Architecture" 제안 vs 실제 구현

> **Type:** patch (소스 코드 0줄 변경 · ADR 미발급 · INDEX.md 미갱신)
> **Date:** 2026-06-03
> **Scope:** 분석/감사 전용. 본 문서는 향후 작업의 *판단 근거*이지 구현물이 아니다.
> **목적:** "QMP Ledger SSOT Re-Architecture" 제안을 기존 ADR 체인과 코드 현실에 대조하여,
> **두 번째 SSOT를 신설하는 재설계 사고(anti-pattern)** 를 차단하고, 실제 작업 대상을
> *"강제(enforce) + 미완성 배선 완성(complete)"* 으로 재정의한다.

---

## 0. 한 줄 결론

> **문제의 본질은 "SSOT 부재"가 아니라 "SSOT가 설계·ADR·타입까지 다 있는데 구현이
> 우회하고 절반만 배선된 드리프트(drift)"다.** 따라서 처방은 *재설계*가 아니라
> *정적 가드로 드리프트를 컴파일 타임에 막고 + Snapshot factory를 완성*하는 것이다.

이 차이는 단어 장난이 아니라 위험도를 바꾼다:
- "재설계" 경로 → 불변식 1·2(Trading Engine/Shadow 정지 금지) 정면 위협, 수개월, LIVE 리스크.
- "강제+완성" 경로 → LIVE 매매 본체 0줄 변경, 점진적 이행, byte-equivalent 가능.

---

## 1. 이미 존재하는 SSOT 원장 체인 (재설계 금지 영역 🟢)

제안서가 "새로 만들자"고 한 항목 대부분이 **이미 ADR·타입·코드로 존재**한다.
아래를 새로 만들면 *두 번째 SSOT* 가 생겨 오히려 단일성을 파괴한다.

```
SourceSnapshot (ADR-0519)
  → CandidateGateEvaluationView (ADR-0526)
  → UnifiedExecutionPermissionResolution + unifiedExecutionContract.ts (ADR-0527)
  → PositionPolicyDecision (ADR-0527)
  → DecisionLogCorrelation: sourceSnapshotId 필수 12필드 (ADR-0528)
```

| 제안서 신규 아이디어 | 이미 존재하는 자산 | 상태 |
|---|---|---|
| sourceSnapshotId로 전 단계 연결 | `server/observability/decisionLogCorrelation.ts:54` (필수 필드) | **100% 존재** |
| Telegram을 projection으로 강등 | ADR-0525/0526/0527 "Formatter는 정본 읽기만, 렌더 시점 재계산 금지" | **문서 존재, 구현 일부 위반** |
| ExecutionLedger로 Shadow/Mock/Live 통합 | `server/trading/orderPipelineSsot.ts` `OrderIntent` 13-stage, `mode:'LIVE'\|'SHADOW'` | **60% 존재** |
| LearningLedger | `counterfactualShadowLearningRepo` / `provisionalShadowLedger` / `personaBalanceLedger` (3분리) | **100% 존재** |
| Policy는 판단값 아니라 permission만 바꾼다 | 불변식 5 + `server/runtime/executionPermissionResolver.ts:208` 격리 구현 | **헌법으로 존재** |
| Provider ≠ marketSignal | 불변식 6 + 동 파일 `providerIssueIsolated` 격리 | **헌법으로 존재** |

> **결론:** 제안서의 70~80%는 시스템 헌법(불변식)·ADR의 *재발견*이다. 신규 ADR로 중복
> 정의하지 말 것. 단, "재발견했다"는 사실 자체가 **구현이 설계를 안 따른다**는 강한 신호다.

---

## 2. 실제 위반 — 제안자가 옳았던 부분 (enforcement 필요 🟡)

증상 진단은 대부분 코드로 입증된다. 단 원인은 "원장 부재"가 아니라 "우회/미배선"이다.

| # | 증상(제안서) | 코드 증거 | 위반 불변식 | 성격 |
|---|---|---|---|---|
| V1 | Gate가 provider 직접 조회 | `server/screener/universeScanner.ts:260,335,378,452,517` — Stage1/2가 `kisClient` 직접 호출, SourceSnapshot 우회 | **#9** | 미배선 |
| V2 | provider 장애가 bearish로 섞임 | `server/dart/dartProviderSignalSplit.ts:29` — `mixed: providerIssue && marketSignal` 명시 허용 | **#6** | 국소 버그 |
| V3 | signalScanner가 provider fallback 자체 관리 | `server/trading/signalScanner/marketProgramFlowProvider.ts:78,184` | #3/#9 | 미배선 |
| V4 | Shadow 보유가 `/pos`에 안 보임 | `server/telegram/commands/positions/pos.cmd.ts:64` — 1순위 `ShadowPositionRegistry`가 **메모리뿐, 파일 영속 0** | — | 절반 버그/절반 의도 |
| V5 | Telegram 직접 조회/혼합 표시 | `dartProviderHealth.cmd.ts:8`, `renderers/snapshotBundle.ts:273` | #3 | enforcement |

**V4 주의:** `/pos` 미표시의 일부는 *의도된 가드*다 —
`shadowPositionLedger.ts` 가드3(`watchlistSource==='SHADOW_NEAR_BREAKOUT'` 학습 entry 숨김, ADR-0452),
가드7(BUY fill 없는 orphan 숨김). 따라서 "전부 버그"가 아니라
**"Registry 미영속(버그) + 학습 entry 숨김(의도)"** 으로 분리해 다뤄야 한다.

---

## 3. 진짜 뿌리 원인 — Snapshot Factory 미구현 (complete 필요 🟡 최우선)

위 V1·V3·V5가 *왜* 생기는지의 공통 뿌리:

- `src/services/autoTrading/ssotPipeline.ts:44` — `UnifiedSourceSnapshot` **타입(청사진)만 존재**.
- 동 파일의 `evaluateCommonGate()` 등 통합 게이트 함수는 **`ssotPipeline.test.ts`에서만 호출**,
  프로덕션 미사용.
- 실제 프로덕션 데이터 흐름은 별도 경로:
  `StockRecommendation → buildCandidateDecisionCardModel() → UI` (`candidateDecisionModel.ts:380`).
- 제안서가 나열한 snapshot 필드 중 **약 85% 미구현** (universe / supply / fundamentals / macro /
  sectorEnergy / providerHealth / dataConfidence 부재. quotes·technicals·freshness만 부분).

> **즉 원장(타입)은 정의됐는데 아무도 채우는 factory가 없다.** 그래서 각 모듈이
> 어쩔 수 없이 provider/store를 직접 본다. **이것이 제안자가 느낀 고통의 단일 뿌리다.**
> Factory를 완성하면 §2의 V1·V3·V5와 §4 증상 1·2·5가 연쇄 해소된다.

---

## 4. 제안서 "5개 증상" → 코드 기반 재해석

| 제안서 증상 | 표면 진단(제안서) | 코드 기반 실제 원인 | 분류 |
|---|---|---|---|
| R6인데 NOW=GREEN | 참조 원천 다중화 | factory 미완성으로 regime/display가 `useGlobalIntelStore.macroEnv` 직접 읽음 | 미배선 |
| SELL_ONLY에서 0/50 | 평가 생략 | 불변식 5가 이미 "평가 생략 금지" 못박음 → 진단 표시 경로 위반 | enforcement |
| Shadow 보유 미표시 | live 중심 원장 | `ShadowPositionRegistry` 미영속 + 가드3/7(의도) | 버그+의도 |
| provider 장애=bearish | 경로 혼합 | `dartProviderSignalSplit:29` mixed 허용 | 국소 버그 |
| Telegram 중복 | 이벤트 원장 부재 | 이벤트 원장(13-stage)·dedup 키 이미 존재, 누락 지점만 패치 | enforcement |

**5개 중 "원장이 없어서"인 것: 0개. "원장이 안 채워졌거나 우회당해서": 5개.**

---

## 5. 6-ID 제안 평가 (진짜 신규 🔴 — 대부분 보류 권고)

제안: `sourceSnapshotId / decisionId / orderIntentId / executionId / positionId / learningCaseId`.

현황: **3개만 명시적** (`sourceSnapshotId` + `orderIntentId` + `scanId`).
상류(Gate 평가)는 완벽 추적, 하류(Execution/Learning) 1:N 인과가 모호.

| 제안 ID | 현재 대체물 | 실익 | 난이도 | 권고 |
|---|---|---|---|---|
| sourceSnapshotId | snapshotId | — | — | **이미 있음** |
| decisionId | (없음) | 하류 1:N 추적 명확화 — **유일하게 실익 큼** | 중 | **채택 후보(ADR 별건)** |
| orderIntentId | orderIntentId | — | — | 이미 있음 |
| executionId | orderIntentId 부분커버 | 낮음 (KIS 통합 필요) | 고 | **보류** |
| positionId | trade.id 부분커버 | 낮음 | 중 | **보류** |
| learningCaseId | scanId+dedup | 낮음 (dedup 키로 충분) | 중 | **보류** |

> over-engineering 경고: 6-ID 전면 도입은 빈 원장에 ID만 다는 결과가 되기 쉽다.
> **Factory 완성(§3)이 선행되지 않으면 ID부터 붙이는 것은 무의미하다.**

---

## 6. 재정의된 이행 순서 (제안서 5단계 대비 교정)

| 우선 | 작업 | 근거 | 산출 type |
|---|---|---|---|
| **0** | **본 감사 문서** (현재) | 두 번째 SSOT 신설 방지 | patch(문서) |
| **1** | `UnifiedSourceSnapshot` factory 실제 구현 + 프로덕션 배선(`ssotPipeline` 승격) | §3 뿌리 원인 | **ADR-0555** |
| **2** | provider 직접 호출 정적 가드: `universeScanner`·`marketProgramFlowProvider`를 snapshot 입력화 + `scripts/check_*.js`에 우회 탐지 | 불변식 9 회귀 방지 | patch+가드 |
| **3** | `dartProviderSignalSplit` mixed 제거 + 회귀 테스트 1개 | 불변식 6 | patch |
| **4** | `ShadowPositionRegistry` 영속화 + `/pos` 가드3/7을 "숨김"→"라벨 표시" | Shadow 가시성 | patch |
| **5** | (선택) `decisionId` 1종만 `DecisionLogCorrelation`에 추가 (나머지 3 ID 보류) | 하류 1:N | ADR 별건 |

**제안서 5단계 대비 핵심 교정 2가지**
1. 제안서는 "원장 ID 6개 강제"를 1단계로 뒀으나 — **factory 부재 상태의 ID 강제는 빈 원장에 라벨 다는 꼴.** Factory(1단계)가 선행.
2. 제안서 제목 *"Re-Architecture Patch"* 는 본인이 쓴 "갈아엎지 말라"와 모순. 명칭을
   **"SSOT Enforcement & Snapshot Factory Completion"** 으로 변경 권고. 이름이 범위를 결정한다.

---

## 7. 메타 결론 (운영 원칙)

- 이 시스템의 병은 **설계 부재가 아니라 설계-구현 드리프트**다.
- 따라서 진짜 해법은 새 코드가 아니라 **정적 가드(`scripts/check_*.js`)로 드리프트를 매 커밋 강제**하는 것.
- 원장은 한 번 세우는 게 아니라 *컴파일 타임에 매번 강제*되어야 유지된다.
- 제안자가 "이미 있는 SSOT를 못 보고 새로 만들려 했다"는 사실 자체가, 시스템 규모가
  *설계자의 인지 한계*를 넘었다는 신호 → 문서(본 감사)와 정적 가드로 인지 부하를 외부화해야 한다.

---

## 부록 A. 근거 파일 인덱스

- SourceSnapshot 타입(미구현): `src/services/autoTrading/ssotPipeline.ts:44`
- 프로덕션 우회 경로: `src/candidate-decision/candidateDecisionModel.ts:380`
- Gate provider 직접 호출: `server/screener/universeScanner.ts:260,335,378,452,517`
- provider/marketSignal mixed: `server/dart/dartProviderSignalSplit.ts:29`
- providerIssue 격리(정상): `server/runtime/executionPermissionResolver.ts:208`
- Decision 상관 원장: `server/observability/decisionLogCorrelation.ts:54`
- Order intent 원장: `server/trading/orderPipelineSsot.ts:38`
- Shadow position 원장: `server/persistence/shadowPositionLedger.ts`
- `/pos` 우선순위: `server/telegram/commands/positions/pos.cmd.ts:64`
- Learning 3원장: `server/persistence/counterfactualShadowLearningRepo.ts`,
  `provisionalShadowLedger.ts`, `server/learning/personaBalanceLedger.ts`

## 부록 B. 관련 기존 ADR

ADR-0519(unified-source-snapshot) · ADR-0525/0526/0527(Canonical Data SSOT 체인) ·
ADR-0528(Railway decision-log correlation) · ADR-0529(DART financials canonical inclusion) ·
ADR-0504(Shadow position ledger 5-guard) · ADR-0452(학습 entry 숨김) ·
ADR-0011(aiUniverseService 단일 통로).
