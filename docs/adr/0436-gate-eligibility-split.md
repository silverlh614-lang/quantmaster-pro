# ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE)

**Status**: Accepted (2026-05-07)
**Branch**: `claude/adr-0436-gate-eligibility-split`
**Stack on**: ADR-0416 (Phase 1 evaluator status DATA_UNAVAILABLE) + ADR-0417 (Phase 2 postmortem action taxonomy split) + ADR-0418 (Phase 3 metadata automation) + ADR-0420 (fresh scan blocker attribution) + ADR-0421 (investor-flow semantic availability) + ADR-0435 (investor-flow provider recovery)

## 1. Context

ADR-0416~0418 시리즈가 evaluator status semantics 를 5분류(FIRED / THRESHOLD_NOT_MET / DATA_UNAVAILABLE / PROVIDER_DEGRADED / ERROR)로 정착했고, ADR-0421 / ADR-0435 가 supply provider 자체의 unavailable 분기까지 표면화했지만 *후보 종목 단위* 의 eligibility 의사결정은 여전히 *binary live-pass / live-fail* 이었다.

운영자 보고:

> "DATA_UNAVAILABLE 이 우세한 날에도 Gate 가 너무 엄격해서 Gate threshold 를 완화해야 하는 것처럼 보이는 잘못된 진단이 누적되고 있다. 학습/관측 후보는 분명히 존재하는데 'Gate1 통과 0' 만 보이니까 R3 Sanity 가 hard latch 를 누적하고, 운영자는 매번 `/r3_unblock` 을 누른다."

핵심 문제: **실매수 후보 0** 과 **학습/관측 후보 0** 이 같은 카운터(`gate1Pass`)에 합쳐져 있어서 두 가지 의미를 구분 못 한다.

## 2. Decision

`server/trading/signalScanner/gateEligibilityClassifier.ts` SSOT 모듈을 신설해 **두 종류의 pass** 를 분리한다:

- `LIVE_ELIGIBLE_PASS` — 실매수 자격 (BUY/STRONG_BUY 진입 가능)
- `SHADOW_OBSERVABLE_PASS` — 학습/관측 자격 (counterfactual ledger, 자동 매수 절대 금지)

`classifyGateEligibility(input): GateEligibility` 결정 트리 SSOT 가 12-value `GateEligibilityReason` union 으로 차단 사유를 분류하고, 호출자(buyListLoop)는 결과를 `ScanCounters` 6 신규 카운터에 누적만 한다. 실제 매수 흐름 변경 0 (분류 layer).

## 3. 사용자 핵심 원칙 (절대 변경 금지)

1. **"실매수 후보가 0개인 것과, 학습/관측 후보가 0개인 것은 다르다"**
2. DATA_UNAVAILABLE 은 failed 가 아니다 + DATA_UNAVAILABLE 은 PASS 도 아니다
3. DATA_UNAVAILABLE 상태에서는 STRONG_BUY 금지 + LIVE_ELIGIBLE_PASS=false
4. SHADOW_OBSERVABLE_PASS 는 절대 실매수로 이어지면 안 된다 (paper/live 자동 승격 금지)
5. LIVE_ELIGIBLE_PASS 만 실제 BUY/STRONG_BUY eligibility
6. R3 Sanity 는 liveGatePass=0 만 보지 말고 shadowObservablePass 존재 여부를 함께 봐야 함
7. EmptyScan 은 "실매수 후보 0" 과 "관측 후보 존재" 를 분리해서 표시
8. LIVE 주문/체결/청산 본체 절대 수정 금지
9. KIS/KRX/NAVER/Yahoo 외부 호출 추가 금지
10. Gate threshold + condition weight 완화 금지

## 4. 12-value GateEligibilityReason union

```ts
export type GateEligibilityReason =
  // DATA_UNAVAILABLE 분기 (ADR-0416/0421/0435 정합)
  | 'SUPPLY_DATA_UNAVAILABLE'
  | 'INVESTOR_FLOW_PROVIDER_UNAVAILABLE'
  | 'EARNINGS_DATA_UNAVAILABLE'
  // PROVIDER_DEGRADED 분기 (ADR-0125/0396/0411/0414/0423 정합)
  | 'SECTOR_DATA_STALE'
  | 'SECTOR_DATA_DEGRADED'
  | 'PRICE_DATA_DEGRADED'
  // 하드 차단 분기 (학습 표본 오염 차단 — shadowObservable=false)
  | 'MACRO_BLOCK'
  | 'RISK_BLOCK'
  | 'TRUE_GATE_FAIL'
  | 'INSUFFICIENT_SCORE'
  | 'DATA_STARVED'
  | 'UNKNOWN';
```

## 5. 결정 트리 SSOT (절대 변경 금지)

1. **ENV gate** — `GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'` 시 legacy 동작 (shadowObservable 항상 false)
2. **fatal 검증** — 가격 ≤0/NaN/Infinity OR code !`/^[0-9]{6}$/` OR `hasFatalDefect=true` → 양쪽 모두 false
3. **차단 사유 누적** — 모든 분기 OR (다중 사유 동시 가능)
4. **liveEligible** — 차단 사유 0 + 치명 결함 0
5. **shadowObservable** — 다음 모든 조건 충족:
   - `!liveEligible`
   - `!fatal`
   - `hasCandidacy` (technical/momentum/catalyst signal 또는 BUY/STRONG_BUY 등급)
   - `shadowObservationReasons.length > 0` (DATA_UNAVAILABLE 또는 PROVIDER_DEGRADED 사유 ≥1)
   - `!hardBlockOnly` (MACRO/RISK/TRUE_GATE_FAIL/INSUFFICIENT_SCORE/DATA_STARVED 만 있으면 false — 학습 표본 오염 차단)

## 6. ScanCounters 6 신규 카운터

```ts
liveEligibleCount: number;              // 실매수 후보
shadowObservableCount: number;           // 학습/관측 후보
dataUnavailableBlockedCount: number;     // SUPPLY/INVESTOR_FLOW/EARNINGS DATA_UNAVAILABLE
providerDegradedObservableCount: number; // SECTOR_STALE/DEGRADED + PRICE_DEGRADED
trueGateFailCount: number;               // TRUE_GATE_FAIL + INSUFFICIENT_SCORE
hardRiskBlockedCount: number;            // RISK_BLOCK + MACRO_BLOCK
```

`createScanCounters()` 가 6 필드 0 초기화. `accumulateGateEligibility()` SSOT 헬퍼가 `classifyGateEligibility` 결과를 자동 누적. `persistScanResults()` 가 `ScanSummary` 옵셔널 필드로 propagate.

## 7. R3 Sanity wiring 격상

`scanDiagnostics.ts persistScanResults` 의 R3 Sanity 평가 분기에서 `dataUnavailableDominant` 가드 추가:

```ts
const isGate1Zero =
  _lastScanSummary.gatePassDistribution !== undefined &&
  _lastScanSummary.gatePassDistribution.gate1Pass < 1 &&
  _lastScanSummary.candidates >= 1;
const shadowObservablePresent = (_lastScanSummary.shadowObservableCount ?? 0) > 0;
const dataUnavailableDominant = isGate1Zero && shadowObservablePresent;
if (sanity.violation !== 'NONE' && !skipStreak && !dataUnavailableDominant) {
  // ... 기존 state machine 평가 ...
}
```

`sanity.violation` 직접 분기 회피 (state machine 캡슐화 보존, ADR-0401 절대 원칙 #8). `gatePassDistribution.gate1Pass < 1 + candidates ≥ 1` 합집합으로 GATE1_PASS_ZERO 동등 조건 도출.

## 8. EmptyScanPostmortem 신규 액션 2종

`PostmortemAction` union 에 추가:

- `KEEP_COUNTERFACTUAL_LEARNING` — shadowObservable > 0 + dataUnavailable 우세 시 학습 후보 보존
- `PATCH_PROVIDER` — providerDegraded > 30% 우세 시 sector/price provider 점검 우선

`deriveGateEligibilityActions(input)` SSOT 결정 트리:

1. `shadowObservableCount > 0 + dataUnavailableBlockedCount > 0` → `KEEP_COUNTERFACTUAL_LEARNING + CHECK_DATA_SOURCE`
2. `providerDegradedObservableCount / total > 0.3` → `PATCH_PROVIDER` (+`KEEP_COUNTERFACTUAL_LEARNING` if shadow>0)

`runPostmortem()` 가 `getLastScanSummary()` 에서 6 카운터 read 후 `deriveGateEligibilityActions` 호출, 결과를 `recommendedActions` 배열에 우선 추가 (try/catch 격리).

## 9. /scan_blockers 신규 섹션

`formatGateEligibilitySplitSection(summary)` SSOT 가 `shadowObservableCount !== undefined` 시점에만 노출 (후방호환):

```
🎯 [Gate Eligibility Split (ADR-0436)]
  • Live eligible: N건
  • Shadow observable: M건 (학습/관측 후보 — 자동 매수 차단)
  • Data unavailable: K건 (SUPPLY/INVESTOR_FLOW/EARNINGS)
  • Provider degraded: P건 (SECTOR_STALE/PRICE_DEGRADED)
  • True gate fail: L건 (진짜 임계 미달)
  • Hard risk blocked: H건 (MACRO/RISK)
  • R3 streak skip 사유: <none | shadowObservablePresent | r3StreakSkipped>
```

`shadow > 0 && live === 0` 시 운영자 가이드 메시지 추가:

> 실매수 후보 0 ≠ 학습/관측 후보 0 — DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세 시 학습 ledger 보존, 자동 매수 승격 0.

## 10. ENV gate

```ts
process.env.GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'  // 비활성 (legacy)
default                                                  // 활성
```

ADR-0157 정확 비교 의무 — `'1'` / `'TRUE'` / `'yes'` 모두 거부. 호출자 측 inline ENV 검사 0건 — `isGateEligibilitySplitDisabled()` SSOT 헬퍼 위임.

## 11. 13 invariants (회귀 테스트 정적 grep 가드)

1. SHADOW_OBSERVABLE_PASS 가 KIS 주문 함수 5종 호출 0건
2. LIVE_ELIGIBLE_PASS=false 상태 trade 가 KIS 주문 함수 호출 0건
3. DATA_UNAVAILABLE 상태에서 STRONG_BUY 산출 0건
4. R3 Sanity GATE1_PASS_ZERO 트리거 시 shadowObservablePass>0 이면 streak 증가 0
5. 12-value GateEligibilityReason union 정확
6. classifyGateEligibility 시그니처에 shadowObservable: boolean (옵셔널 0)
7. ENV `GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'` 정확 비교
8. ENV default OFF (정확 비교 통과 시에만 비활성)
9. supply DATA_UNAVAILABLE / investor-flow PROVIDER_DEGRADED → liveEligible=false + shadowObservable=true
10. counterfactual learning 후보 영속 시 literal markers TypeScript 강제 (별도 ledger SSOT)
11. EmptyScanPostmortem `LOOSEN_GATE` / "Gate threshold 완화" 메시지 영구 차단
12. classifyGateEligibility 호출자 측 inline ENV 검사 0건 (SSOT 위임)
13. fake symbol record 절대 금지 (counterfactual 후보 lightweight summary 만)

## 12. 잘못된 해결 방법 영구 차단

- `Action` union 에 `PROMOTE_TO_LIVE` / `PROMOTE_TO_PAPER` / `EXECUTE` 추가 (자동 매수 승격 위반)
- `shadowObservable` 옵셔널 필드화 (필수 보장 위반)
- `classifyGateEligibility` 본체에서 KIS 주문 함수 import (분류 layer 원칙 위반)
- 호출자 측 inline ENV 검사 (SSOT 위임 위반)
- `Gate threshold 완화` / `LOOSEN_GATE` 권고 메시지 (위험 권고 영구 차단)
- counterfactual ledger 자동 영속을 본 PR 에 통합 (회귀 위험 격리 — 후속 PR scope)

## 13. 잔여 후속 PR

- **counterfactual ledger 자동 영속 wiring** — `shadowObservable=true` 시점에 ADR-0430 `counterfactualShadowLearningRepo` 자동 record (현재는 카운터만 누적)
- **GateEligibility 결정 트리 입력 정밀화** — 현재 `macroBlocked/riskBlocked/trueGateFail` 등 hard 차단 입력은 buyListLoop wiring scope 에서 항상 false (preflight 통과 의미). 진정한 trueGateFail 분류는 evaluator 단계 wiring 후속 PR
- **Gate eligibility 7-tier 격상** — Router severity (ADR-0425) 와 통합 7-tier 매핑 검토

## 14. 운영 효과

- DATA_UNAVAILABLE 우세 날 R3 Sanity GATE1_PASS_ZERO streak 누적 영구 차단
- `/scan_blockers` 진단에서 *학습 후보 N건 / 실매수 후보 0건* 분리 즉시 인지
- EmptyScanPostmortem 이 *Gate threshold 완화* 가 아니라 *데이터 소스 점검* 권고 발화
- Counterfactual learning 후보 영속의 의사결정 입력 마련 (후속 PR)
