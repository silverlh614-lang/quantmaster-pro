# ADR 0032 — 자기학습 시리즈 통합 SSOT (PR-A~O 종합)

- 상태: Accepted
- 일자: 2026-04-26
- 통합 대상: ADR-0018 ~ ADR-0031 (14건)
- 시리즈: PR-A → PR-O (15 PR)

## 목적

자기학습 시리즈 PR-A~O (15 PR / 14 ADR) 의 누적 결과물을 **단일 진입점 문서**
로 통합. 향후 wiring PR (signalScanner Phase B 완주 후) 진입 시 컨텍스트 비용
최소화 + 신규 개발자 onboarding 진입점.

## 시리즈 5계층 + 3축 구조

```
사후 측정 축          사전 신호 축          변환률 축
(페어 A)              (페어 D)              (#8)
────────────────     ────────────────     ────────────────
거짓 부정 측정         매집/돌파 leading      슬리피지 학습
(놓친 알파)           (variance contract)   (IOC/LIMIT/AGGR)

5계층 누적 인프라:
1. 데이터 신뢰도   PR-A (무결성) PR-C (source 차등)
2. 거래 기록 무결성 PR-A (schema v2) PR-D (lossReason)
3. 조건별 성과    PR-F (Profit Factor) PR-G (regime 분리) PR-I (귀인)
4. 가중치 조정     PR-E (lossReason 가중치) PR-J (Shadow Model)
5. 실행 정책      PR-O (Order Optimizer) — entryEngine wiring 후속
```

## PR-A~O 모듈 인덱스

| PR | ADR | 모듈 / 영역 | 핵심 기능 |
|---|---|---|---|
| **PR-A** | 0018 | `src/services/quant/checklistToConditionScores.ts` + TradeRecord schema v2 | 27조건 점수 무손실 변환 + conditionSources/evaluationSnapshot 영속 |
| **PR-B** | 0019 | `src/services/quant/recommendationSnapshotRepo.ts` + zustand store | 추천 lifecycle (PENDING→OPEN→CLOSED/EXPIRED) SSOT |
| **PR-C** | 0020 | `src/services/quant/sourceWeighting.ts` | AI 0.4 / COMPUTED 1.0 차등 학습 multiplier |
| **PR-D** | 0021 | `src/services/quant/lossReasonClassifier.ts` | 손실 원인 8 분류 자동 추론 (4 자동 + 4 수동) |
| **PR-E** | 0022 | `src/services/quant/lossReasonWeighting.ts` | trade-level Confidence-Weighted Learning |
| **PR-F** | 0023 | `src/services/quant/conditionEdgeScore.ts` | Profit Factor / avgReturnPosi/Neg / Edge Score |
| **PR-G** | 0024 | `src/services/quant/regimeMemoryBank.ts` | 레짐별 가중치 분리 (7 RegimeKey) |
| **PR-H** | 0025 | `useTradeStore.setLossReason` | 사용자 수동 lossReason override API |
| **PR-I** | 0026 | `src/services/quant/conditionAttribution.ts` | 4 분류 (ALPHA_DRIVER / RISK_PROTECTOR / NOISE / FALSE_COMFORT) |
| **PR-J** | 0027 | `src/services/quant/learningShadowModel.ts` | Shadow Model 검증 + isPromotable |
| **PR-K** | — | `src/services/quant/selfLearning.ts` (barrel) + `__test-utils__` | PR-A~J 통합 진입점 + drift 차단 |
| **PR-L** | 0028 | `server/learning/rejectionShadowTracker.ts` | Gate 14~17 거절 5영업일 추적 (거짓 부정) |
| **PR-M** | 0029 | `server/learning/counterfactualTwinPortfolio.ts` | 3 Twin (AGGR/DISC/EQUAL) 평행 포트폴리오 |
| **PR-N** | 0030 | `server/screener/latentSignalScorer.ts` | VCP Score + Latent Catalyst Score 통합 |
| **PR-O** | 0031 | `server/persistence/slippageHistoryRepo.ts` + `server/trading/orderTypeOptimizer.ts` | 슬리피지 학습 + IOC/LIMIT/AGGRESSIVE 동적 선택 |

## 진입점 (Entry Points)

### 클라이언트 (PR-A~K)

```ts
import {
  checklistToConditionScores,
  buildSnapshotFromRecommendation,
  classifyLossReason,
  classifyConditionAttribution,
  evaluateFeedbackLoop,
  compareShadowVsLive,
} from '../services/quant/selfLearning';
```

### 서버 (PR-L~O)

```ts
import {
  recordRejection,
  refreshRejectionShadow,
  recordTwinEntries,
  refreshTwinPortfolio,
  computeVcpScore,
  computeLatentCatalystScore,
  decideOrderType,
  recordSlippageEntry,
} from './selfLearningServer';  // 신규 PR-P barrel
```

## 환경변수 롤백 스위치 (긴급 비활성화)

모든 학습 로직은 즉시 LIVE 동작 복원 가능한 escape hatch 보유:

| ENV | 효과 |
|---|---|
| `LEARNING_SOURCE_WEIGHTING_DISABLED=true` | PR-C AI 차등 학습 비활성 |
| `LEARNING_LOSS_REASON_WEIGHTING_DISABLED=true` | PR-E lossReason 가중치 비활성 |
| `LEARNING_REGIME_BANK_DISABLED=true` | PR-G 레짐별 가중치 비활성 (글로벌 fallback) |

## 영속 파일 인덱스

| 경로 | 모듈 | 한도 |
|---|---|---|
| `data/rejection-shadow.json` | PR-L | 500 FIFO |
| `data/twin-portfolio.json` | PR-M | 1500 FIFO |
| `data/slippage-history.json` | PR-O | 1000 FIFO |
| (클라이언트 zustand) `k-stock-trade-store` | PR-A schema v2 | 무제한 |
| (클라이언트 zustand) `k-stock-recommendation-snapshots-store` | PR-B | 1000 FIFO |
| (클라이언트 localStorage) `k-stock-evolution-weights` + `-by-regime` | PR-G | 무제한 |

## LIVE 자동매매 무영향 보장

**시리즈 15 PR 전체에 걸쳐 다음 모듈은 무수정**:
- `server/clients/kisClient.ts` (절대 규칙 #2)
- `server/services/aiUniverseService.ts` (절대 규칙 #3, ADR-0011)
- `server/orchestrator/*`
- `server/trading/signalScanner.ts` 본체 (Phase B 분해 진행 중)
- `server/trading/autoTradeEngine.ts` (절대 규칙 #4)
- `server/trading/entryEngine.ts` (PR-O wiring 후속 PR 까지)
- `server/trading/exitEngine.ts` (P2 분해 진행 중)

따라서 시리즈 도입 후 LIVE 매매 회귀 위험 = 0. 신규 학습 모듈은 모두 환경변수
롤백 + LIVE wiring 부재 (분리된 후속 PR) 로 영향 격리.

## wiring 후속 PR 매트릭스

본 시리즈가 마련한 데이터 인프라를 LIVE 매매에 결합하는 wiring PR 은 본 시리즈
범위 밖. 회귀 위험 관리를 위해 별도 PR 로 진행:

| wiring | 의존성 | 영향 모듈 |
|---|---|---|
| Rejection wiring (PR-L) | signalScanner Phase B 완주 | signalScanner 거절 시점 `recordRejection` 호출 |
| Twin wiring (PR-M) | signalScanner Phase B 완주 | candidate 평가 시 `recordTwinEntries` 호출 |
| Latent/VCP wiring (PR-N) | watchlistManager 확장 | 신규 VCP_HUNTER 섹션 + tag |
| Slippage wiring (PR-O) | entryEngine + fillMonitor 변경 | `decideOrderType` + `recordSlippageEntry` 호출 |
| Pyramid (페어 C #5) | exitEngine P2 분해 + ADR-0006 composite key | 신규 모듈 |
| Re-entry (페어 C #3) | regretAsymmetryFilter 확장 | cooldown 우회 정책 |
| Confluence (페어 B #2) | signalScanner Phase B entryGates | timeframe 합치 게이트 |
| Dynamic RRR (페어 B #7) | riskManager 확장 | 레짐별 RRR_MIN 행렬 |

## 페어 진행 상황 (사용자 10 결합 아이디어)

```
✅ 완성 (4/5 페어)               ⏳ 후속 (1 페어 + wiring)
─────────────────────           ─────────────────────────────
페어 A: PR-L + PR-M             페어 B: #2 + #7 + #4 (Phase B 후)
페어 D: PR-N                    페어 C: #5 + #3 (P2 후)
독립 #8: PR-O                   wiring 통합 PR
```

## 검증 누적

- vitest 누적: 클라이언트 705 + 서버 1488 = **2193 tests pass** (무회귀)
- ADR 14건: 0018 ~ 0031
- 신규 LoC: ~3700줄 (모듈 + 테스트)
- 절대 규칙 #2/#3/#4 준수율: 100%
- KIS/KRX quota 침범: 0
