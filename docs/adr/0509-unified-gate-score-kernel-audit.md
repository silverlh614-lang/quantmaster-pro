# ADR-0509 — Unified Gate Score Kernel Audit (Patch-UNIFIED-GATE-SCORE-KERNEL-AUDIT-001)

**Status**: Accepted
**Date**: 2026-05-13
**Issue / Context**:
사용자 직접 명시 — *"Shadow와 Live가 완전히 다르게 가져갈 필요는 없다. 공통 Score Kernel을 만들고, Live와 Shadow는 같은 점수를 서로 다른 정책으로 해석해야 한다."*

ADR-0505 (Gate1 Minimum Signal Forensic Audit) + Patch-SHADOW-GATE-AUDIT-001 (shadowGateAuditStore) 두 진단 SSOT 가
별도 영속 / 별도 호출자 / 별도 hydration path 로 작동 → 운영자가 *Shadow rawGate vs Live minSignal* 동시 비교
불가능 + Shadow 가 approval 통과한 종목의 *Live minSignal failure 원인 분해* 가 분리되어 발산 원인 추적
어려움. ADR-0505 가 Live minSignal 100-scale forensic 을 노출했지만 Shadow rawGate 와의 *통합 시각*
부재 → 운영자가 두 SSOT 를 별도 조회 후 수동 정합 의무.

## Decision

**`server/trading/signalScanner/unifiedGateScoreKernelAdr0509.ts` 신규 SSOT** — Shadow rawGate
record + Live minSignal forensic record 결합 `UnifiedGateScoreSnapshot` schema 도입. 12 component
(priceMomentum / volumeLiquidity / technicalTrend / relativeStrength / breakoutStructure /
watchlistUpstream / supplyConfluence / investorFlow / sectorEnergy / earningsQuality / per /
trendAcceleration) + 7 dataQuality boolean (watchlistScoreAvailable /
relativeStrengthAvailable / breakoutScoreAvailable / supplySymbolMatched /
supplySemanticAvailable / sectorEnergyAvailable / candidateTraceComplete) + 8 divergence reason
union (NO_DIVERGENCE / LIVE_MIN_SIGNAL_FEATURE_MISSING / SHADOW_GATE_USES_RAW_SCORE /
WATCHLIST_NOT_IMPORTED / RS_NOT_USABLE / BREAKOUT_NOT_USABLE / SUPPLY_SEMANTIC_UNAVAILABLE /
POLICY_DIFFERENCE_ONLY).

### 본 ADR 의 책임 분리

- **ADR-0505** = Live minSignal 100-scale forensic SSOT (per-symbol forensic detail trace 영속).
- **Patch-SHADOW-GATE-AUDIT-001** = Shadow rawGate record 영속 (in-memory, `shadowGateAuditStore`).
- **ADR-0509** (본 ADR) = 두 SSOT 의 *read-only consumer*. 별도 영속 0건. 두 store 본체 무수정.

### `/scan_blockers` 통합 진단

- **runtime mode** — `🧪 Shadow/Live Gate Comparison [PATCH-RUNTIME] (ADR-0509)` 섹션 (latest
  snapshot symbol/name + Shadow rawGate/MTAS/RRR + Live minSignal/required/Gate1 pass + scoreGap +
  data availability 5 axis + divergence reason + secondary reasons + `liveOrderPlaced=false` +
  `executionImpact=NONE` invariants 노출 + `LIVE_FORENSIC_NOT_FOUND` warning).
- **gate compact mode** — `🧪 Unified Gate (ADR-0509): shadowSignals=N · shadowAllowedButLiveFailed=M`
  + latest divergence reason 1줄 (있을 때만).

## 안전 Invariants (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` /
   `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` /
   `buyPipeline.ts` / `perSymbol/**` 모두 `git diff --stat origin/main` 0줄.
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드 — placeKisMarketOrder / placeKisSellOrder /
   placeKisStopLossOrder / placeKisTakeProfitOrder / cancelKisOrder).
3. **`autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건**.
4. **외부 API (fetch / axios / node-fetch) 호출 0건** — 본 SSOT 는 read-only consumer.
5. **Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore + UNKNOWN penalty 변경 0**.
6. **virtual account holdings/cash 무수정**.
7. **자동 paper/live promotion 0** — diagnostic snapshot 만, executionImpact='NONE' literal 강제.
8. **`UnifiedGateScoreSnapshot.executionImpact: 'NONE'` literal type 강제** (TypeScript 컴파일 타임).
9. **`liveOrderPlaced: false` literal type 강제**.
10. **`liveExecutionAllowed: false` literal type 강제**.
11. **`policyPromotionMode: 'SHADOW_ONLY'` literal type 강제**.
12. **ENV `=== 'true'` 정확 비교 의무** (ADR-0157 정합) — `'1'` / `'TRUE'` / `'yes'` 모두 거부.
13. **호출자 측 inline ENV 검사 0건** — `isUnifiedGateScoreKernelDisabled()` SSOT 위임 의무.
14. **ADR-0505 SSOT 본체 무수정** (read-only consumer).
15. **`shadowGateAuditStore.ts` 본체 무수정** (read-only consumer).
16. **ScanSummary schema 변경 0** — snapshots 는 호출 시점 store 상태에서 on-demand 합성 (영속 0).
17. **try/catch 격리 의무** — kernel throw / loadGate1ForensicTrace throw 가 `/scan_blockers`
    base 메시지 절대 차단 금지.

## 검증 (회귀 48 신규 + 사용자 명시 8 케이스)

- **Group A — ENV gate 4** (default OFF / `=== 'true'` 정확 비교 / `'1'`·`'TRUE'`·`'yes'` 거부 / `'false'`).
- **Group B — SSOT 상수 정합 2** (12 component frozen / 매핑 정확).
- **Group C — Case 1: Shadow + Live unified record 3** (동일 symbol 에 rawGate + minSignal 함께 기록).
- **Group D — Case 2: shadowAllowedButLiveFailed flag 3**.
- **Group E — Case 3: divergence reason 분류 5** (WATCHLIST_NOT_IMPORTED / RS_NOT_USABLE /
  BREAKOUT_NOT_USABLE / SUPPLY_SEMANTIC_UNAVAILABLE / POLICY_DIFFERENCE_ONLY).
- **Group F — Case 4: SHADOW_GATE_USES_RAW_SCORE 3** (rawGate ≥ band + minSignal < required).
- **Group G — Case 5: runtime format 5** (Shadow/Live Comparison 섹션 + 모든 필수 라인).
- **Group H — compact line 3** (gate compact 1줄 요약 + latest divergence).
- **Group I — summary aggregator 3** (counters + latest 추출 + 빈 입력 안전).
- **Group J — literal type invariant 6** (executionImpact / liveOrderPlaced / liveExecutionAllowed /
  policyPromotionMode 컴파일 타임 강제).
- **Group K — 정적 grep 가드 6** (KIS 주문 함수 import 0 / autoTradeEngine import 0 / fetch /
  threshold / ADR-0509 추적 주석 / ADR-0157 정확 비교).
- **Group L — Wiring helper (`buildUnifiedSnapshotsFromCurrentState`) 5** (빈 / ENV DISABLED /
  matched / unmatched warning / multi-symbol latest 매칭).

**Total: 48/48 PASS.**

## ENV 우회

- **`UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED=true`** (default OFF, ADR-0157 정확 비교) — 1줄 즉시
  ADR-0505 + Patch-SHADOW-GATE-AUDIT-001 단독 동작 100% 복원. `/scan_blockers` runtime/gate
  compact 출력에서 Unified Gate 섹션 미노출.

## 잘못된 해결 방법 영구 차단

1. ADR-0505 SSOT 본체 변경 (read-only consumer 유지 의무).
2. `shadowGateAuditStore.ts` 본체 변경 (read-only consumer 유지 의무).
3. Gate threshold / requiredScore / STRONG_BUY 조건 / UNKNOWN penalty 변경 (절대 invariant).
4. Live 점수 산정 변경 (Shadow rawGate 가 Live 결정에 영향 0).
5. ScanSummary 영속 schema 에 `unifiedGateScoreSnapshots` 추가 (on-demand 합성 정책 보존).
6. KIS 주문 함수 직접 호출 / fetch / 외부 API (read-only consumer 정책 위반).
7. 호출자 측 inline ENV 검사 (`isUnifiedGateScoreKernelDisabled()` SSOT 위임 의무).
8. `LIVE_FORENSIC_NOT_FOUND` warning 무시 (운영자가 forensic 적재 결손 즉시 인지 의무).

## 잔여 후속 PR (scope 외)

- ADR-0505 forensic detail trace 7-day TTL 확장 (운영 1~2주 누적 후 데이터 기반 재조정).
- `/scan_blockers gate full` 모드에 Unified Gate 풀 detail 추가 (현재 runtime 모드만).
- Shadow rawGate / Live minSignal divergence trend chart (Telegram → Dashboard 후속).
- Per-component confidence calibration (운영 데이터 기반).

## 운영 효과

- 운영자가 `/scan_blockers` 단일 명령으로 Shadow rawGate + Live minSignal 동시 비교 가능.
- `shadowAllowedButLiveFailed=N` 카운터로 *Shadow 통과 + Live 실패* 패턴 빈도 즉시 파악.
- divergence reason (8 union) 으로 *왜 발산했는지* 운영자 분류 가능 — Live 의 점수 산식 / 데이터
  가용성 / Shadow rawGate threshold 중 어느 정책 차이가 원인인지 즉시 식별.

## 참조

- ADR-0505 — Gate1 Minimum Signal Forensic Audit (per-symbol Live forensic detail).
- ADR-0506 — `/scan_blockers` Compact Output Policy + Section Priority Registry.
- ADR-0507 — Gate1 Forensic Collector Wiring + Gate Compact Split.
- ADR-0157 — ENV exact comparison policy.
- Patch-SHADOW-GATE-AUDIT-001 — shadowGateAuditStore SSOT (read-only consumer).
