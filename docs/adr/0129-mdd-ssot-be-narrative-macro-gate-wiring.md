# ADR-0129 — MDD SSOT 통합 + BE narrative 정합 + macroGateState propagate wiring

## Status

Accepted (2026-04-30). 사용자 4/30 운영 보고 P0 3종 단일 PR 통합.

## Context

사용자 4/30 첨부 이미지 2장 + 운영자 보고 분석 결과 P0 3 결함 식별:

### 결함 1 — MDD 수치 불일치 (사용자 보고)

```
📊 [실거래 전환 진행률] 2/6 조건 충족
승률: 40.0%/55% ❌
PF: 2.01 ✅
MDD: -17.80%/-10% ❌
```

PF 2.01 + 승률 40% + MDD -17.80% 는 *수치적으로 모순* 가능. 추적 결과 시스템에
**서로 다른 수학을 쓰는 2개의 MDD 계산 SSOT** 가 drift:

- `server/learning/recommendationTracker.ts:255-260`: **additive sum** 으로 음수 반환
  ```ts
  let peak = 0, mdd = 0, cumReturn = 0;
  for (const r of shadowReturns) {
    cumReturn += r;                // % 단순 가산 (복리 X)
    peak = Math.max(peak, cumReturn);
    mdd = Math.min(mdd, cumReturn - peak); // 음수 반환
  }
  ```
- `server/learning/walkForwardFramework.ts:96-112`: **compound equity** 로 양수 반환
  ```ts
  let equity = 1, peak = 1, maxDd = 0;
  for (const r of returnsPct) {
    equity *= 1 + safe / 100;      // 복리 자본 시계열
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd * 100; // 양수 반환
  ```

같은 입력에 다른 MDD 산출 — 운영자 의사결정 신뢰 손상 + walkForwardFramework /
shadowWalkForwardFramework / recommendationTracker 가 다른 임계 비교 가능.

### 결함 2 — Image 1 trade vs fill 단위 혼용 (Shadow 진행률)

```
✅ WIN: 2건 (승률 20.0%)        ← trade 단위 (HIT_TARGET status)
❌ LOSS: 8건                    ← trade 단위 (HIT_STOP status, BE 포함)
🎯 실현 fill: 11익 / 2손 +4.79% ← fill 단위 (BE 자동 격리, ADR-0124)
```

trade 단위 (HIT_STOP 상태) 는 ADR-0112 BE 분류를 *반영 안 함* — 본절 청산이
LOSS 로 카운트되어 운영자 인지 왜곡. Image 1 의 LOSS=8 중 일부는 실제 BE.

### 결함 3 — Image 2 자기반성 narrative BE 분류 누락

```
🌙 [자기반성] 2026-04-30
⚖️ 2026-04-30 MIXED. 오늘의 교훈:
  에코프로에이치엔은 '전량손절'로 분류되었음에도 불구하고 3.35%의 수익을 실현하여
  전체 일일 P&L을 긍정적으로 마감했습니다.
```

`server/learning/nightlyReflectionEngine.ts:276`:
```ts
const kind = t.status === 'HIT_TARGET' ? '전량익절' : '전량손절';
```

`status` 만 보고 'HIT_STOP → 전량손절' 라벨링 — pnl 양수인데 손절 표기. ADR-0112
BE 분류 (`exitOutcome` 또는 fill-pct 기반) 가 narrative 입력에 미반영. Gemini
프롬프트 자체가 '전량손절 +3.35%' 모순 메시지를 받아 narrative 로 그대로 출력.

### 결함 4 (보너스) — `/scan_blockers` macroGateState 미전달

ADR-0118 `MacroGateState` SSOT 도입 시 *호출자 wiring 후속 PR* 명시. 현재
`server/trading/signalScanner.ts:639` `persistScanResults` 호출이 `macroGateState`
인자를 전달하지 않음 → ScanSummary.macroGateState 항상 undefined →
`/scan_blockers` 텔레그램 메시지의 거시 게이트 섹션이 항상 누락 → 운영자가
"왜 매수가 안 되는지" 1차 원인 (emergencyStop / regime / FOMC / VIX 등) 즉시 인지 불가.

## Decision

P0 3 결함 + 보너스 1 결함을 단일 PR 로 차단. 모든 변경은 *옵셔널 + 후방호환*
패턴으로 회귀 위험 격리.

### 1. MDD SSOT 통합 — `server/learning/mddCalculator.ts` 신설

**단일 SSOT 정의**:
```ts
export type MddMode = 'compound' | 'additive';

/**
 * Maximum Drawdown 계산 SSOT.
 * @returns NEGATIVE 백분율 (예: -9.12 = peak 대비 9.12% 하락).
 *          빈 배열/단일 원소 → 0 반환.
 */
export function computeMaxDrawdown(
  returnsPct: number[],
  mode: MddMode = 'compound',
): number;
```

**규약 SSOT**:
- 부호: **NEGATIVE 반환** (ex: -9.12 = peak 대비 9.12% 하락). 운영자 친화적
  표시 + Math.min 누적 자연 정합 + 사용자 메시지 `MDD: -17.80%` 부호 일관.
- 기본 모드: **`compound`** (재무적으로 정확). additive 는 후방호환용.
- NaN/Infinity 입력은 자동 0 으로 치환 후 계산 (안전).
- 빈 배열/단일 원소 → 0 (drawdown 측정 불가).
- ENV `MDD_SSOT_MODE` 로 default mode 오버라이드 가능 (기본 'compound').

**호출자 통합**:
- `walkForwardFramework.computeMaxDrawdown` → `mddCalculator.computeMaxDrawdown`
  re-export (양수→음수 부호 정합 + 회귀 테스트 단언 동시 갱신).
- `shadowWalkForwardFramework.ts:170` → 동일 re-export 사용.
- `recommendationTracker.ts:255-260` → 인라인 additive 계산 제거,
  `computeMaxDrawdown(returns, 'compound')` 호출. 메시지 `MDD: -17.80%` →
  실제 복리 MDD 로 자동 전환.

**부호 정합 마이그레이션**:
- walkForwardFramework 가 *POSITIVE* 반환하던 기존 동작 → ADR-0129 후
  *NEGATIVE* 반환. 호출자 (텔레그램 메시지 / 영속 schema) 단언 정정.
- recommendationTracker 는 이미 NEGATIVE 반환 → 동작 변경 없음 (수학만 격상).
- ENV `MDD_SSOT_LEGACY_SIGN_DISABLED=false` (default true 정책 적용 / false 시
  walkForwardFramework 는 양수 반환 — 회귀 안전망).

### 2. Shadow 진행률 BE 분리 — trade-unit BE 카운터 신설

`server/alerts/shadowProgressBriefing.ts`:

`computeShadowProgress` 가 trade 단위 카운트 산출 시 ADR-0112 BE 분류 반영:
```ts
const beCount = shadows.filter(s =>
  (s.status === 'HIT_TARGET' || s.status === 'HIT_STOP') &&
  s.exitOutcome === 'BE'
).length;

const winCount = shadows.filter(s =>
  s.status === 'HIT_TARGET' && s.exitOutcome !== 'BE'
).length;

const lossCount = shadows.filter(s =>
  s.status === 'HIT_STOP' && s.exitOutcome !== 'BE'
).length;
```

`ShadowProgress.beCount?: number` 옵셔널 필드 추가 (후방호환). totalClosed 분모는
WIN+LOSS 만 (BE 제외) — 승률 통계에서 BE 격리 보장 (ADR-0123 정합).

`formatShadowProgress` 메시지 BE 라인 추가:
```
✅ WIN: 2건 (승률 20.0%)
❌ LOSS: 6건
⚪ BE: 2건            ← 신규
⏳ ACTIVE: 2건
```

`(p.beCount ?? 0) > 0` 시에만 라인 노출 (BE=0 시 미노출, ENV 자연 호환).

### 3. nightlyReflection narrative BE 라벨 — `summarizeTodaysRealizationsForLearning` SSOT 활용

`server/learning/nightlyReflectionEngine.ts:276`:
```ts
// ADR-0129: status 단독 분기는 BE 분류 누락 — fills pnlPct 비율 기반 분기 우선.
// fills 의 가중평균 pct 가 ADR-0112 임계 (-0.5~+0.5 BE) 안이면 본절 라벨.
const isWeightedBe = pct >= -0.5 && pct <= 0.5;
const isWeightedWin = pct >= 1.0;
const kind =
  isWeightedBe        ? '전량본절' :
  isWeightedWin       ? '전량익절' :
  pct < -0.5          ? '전량손절' :
  // pct > 0.5 && pct < 1.0 (회색 영역) → BE 보수적 라벨
                        '전량본절';
```

이미 `summarizeTodaysRealizationsForLearning` 가 fills 의 가중평균 pct 를
계산 (line 275: `pct = ... / totalQty`). 본 PR 은 그 pct 를 라벨링에도 활용.

추가: ENV `BE_CLASSIFICATION_DISABLED=true` (ADR-0112 정합) 시 기존 동작 복원
(`status === 'HIT_TARGET' ? '전량익절' : '전량손절'`). default OFF (정책 적용).

### 4. macroGateState propagate wiring — `signalScanner.ts:639`

`persistScanResults` 호출 직전에 `buildMacroGateState` 로 합성:
```ts
const macroGateStateForDiagnostics = buildMacroGateState({
  emergencyStop: getEmergencyStop(),
  autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
  regime: regime ?? 'UNKNOWN',
  regimeKelly: regimeConfig.kellyMultiplier,
  fomcPhase: fomcProximity.phase,
  fomcKelly: fomcProximity.kellyMultiplier,
  finalKelly: kellyMultiplier,                 // 결합 + capping 후
  vixGatingActive: vixGating.noNewEntry,
  bearDefenseMode: regime === 'R6_DEFENSE',
  mhsBelow30: (macroState?.mhs ?? 100) < 30,
  watchlistEmpty: watchlist.length === 0,
  sellOnlyMode: options?.sellOnly === true,
});

await persistScanResults(_counters, {
  // ... 기존 인자
  macroGateState: macroGateStateForDiagnostics,
});
```

`buildMacroGateState` SSOT 는 ADR-0118 에 이미 export 되어 있음 — wiring 만 추가.

## Consequences

### 즉시 효과
- **MDD 일관성**: 모든 텔레그램 메시지/리포트의 MDD 가 단일 수학 (compound) 결과.
  `recommendationTracker` 의 `MDD: -17.80%` 가 실제 복리 MDD 로 정확화.
- **Shadow 진행률 BE 분리**: WIN/LOSS/BE 3-way 표시. 본절 청산이 LOSS 로 잘못
  카운트되던 운영자 인지 왜곡 영구 차단.
- **자기반성 narrative 정합**: '에코프로에이치엔 전량손절 +3.35%' 같은 모순
  메시지 영구 차단 — Gemini 프롬프트 입력이 '전량본절' 로 정확화되어 narrative
  자체가 자연스러워짐.
- **`/scan_blockers` 거시 게이트 노출**: 운영자가 "왜 매수가 안 되는지" 1차 원인
  (emergencyStop / regime / FOMC / VIX) 즉시 인지 가능.

### ENV 우회 (회귀 안전망)
- `MDD_SSOT_LEGACY_SIGN_DISABLED=true` — walkForwardFramework 가 양수 반환 (기존 동작 복원).
- `BE_CLASSIFICATION_DISABLED=true` (ADR-0112 정합) — narrative 라벨이 status 단독 분기 (기존 동작 복원).

### 후속 PR (scope 외)
- P1 잔여 (사용자 4/30 보고 #2/#5/#6): 오답노트 SSOT / 다음날 진입 큐 / Capital
  Deployment 메트릭 — 별도 세션 (인프라 신설 회귀 위험 격리).
- P2 (#3-2/#3-5/#4): 운영 검증 / 통합 시뮬레이션 / 추천 메시지 이유 노출.
- `recommendationTracker.winRate` fill 단위 격상 (현재 trade 단위 WIN/LOSS, fill
  수준 BE 분류 미반영) — 학습 SSOT 변경이라 후속 PR 분리.

## Alternatives Considered

1. **MDD 부호를 양수로 통일** — 사용자 보고 메시지 `-17.80%` 부호 일관성 깨짐.
   → 거부.
2. **walkForwardFramework 만 SSOT 로 격상** — recommendationTracker 의 additive
   수학을 *그대로 둘* 위험. drift 재발 가능. → 거부.
3. **Shadow 진행률 trade 단위 카운터 자체 폐기 (fill 단위만)** — 학습 분기가
   trade status 단위로 작동 중 (HIT_TARGET vs HIT_STOP) 이라 호환성 깨짐. → 거부.

## References

- 사용자 4/30 첨부 이미지 (Shadow 진행률 + nightlyReflection narrative)
- ADR-0112 BREAKEVEN classification & circuit isolation
- ADR-0118 scan_blockers diagnostic infrastructure
- ADR-0123 BE 학습 격리
- ADR-0124 텔레그램 리포트 BE 가시화 (3 포맷 함수 — Phase 1)
- ADR-0083 Walk-Forward Framework Extension
