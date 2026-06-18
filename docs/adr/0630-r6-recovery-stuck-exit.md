# ADR-0630 — 매수 게이트 단일화(정본 raw regime) + R6 복구 상태기계 무한-latch Exit

@responsibility 매수/shadow 게이트 정본 raw 단일화(D1·shadow 전용·#8 byte-identical) + R6 복구 R5_STABILIZING 무한 latch exit(D2·execution-adjacent) 설계·flag·연쇄·불변식 SSOT.

- **Status**: Proposed (Phase 0 — 경계·타입·ADR·flag/상수/게이트 계약 pin. 양 flag default OFF byte-identical. 구현 engine-dev.)
- **Date**: 2026-06-18
- **Domain**: regime layer (D1: `signalScanner/preflight.ts` learningRegime 파생 + shadow lane 게이트 / D2: `regimeBridge.base.ts` exit 함수)
- **Scope 확장(broad)**: 본 ADR 은 좁은 stuck 수리(이전 D2 단일)에서 **2개 Decision** 으로 확장된다.
  운영자가 **근본 진단(매수 게이트 단일화)** 을 명시 선택했다 — stuck 수리(D2)는 보존하되 **위상 강등**한다.
- **Execution adjacency**: D1 = **shadow 전용**(라이브 regime/Kelly/권한 byte-identical, #8 엄밀 논증). D2 = ⚠️ **execution-adjacent**(riskOverride·Kelly·display).
- **계보**: 0531 / 0561 / 0157 / 0146 / 0530 / 0592 / 0522 / 0539 / 0426 / 0430 / 0593

---

## 0. 운영자 근본 진단 (수용)

> "수많은 레짐 조건(rawRegime / effectiveRegime / learningRegime / riskOverride / displayRegime /
> live regime / r6StateMachineState 7개)이 매수를 게이트해서, 하나만 어긋나도 매수가 0이 된다."

**원칙(채택):** 매수/shadow 게이트는 **정본 하나(raw 시장분류)** 만 읽고, 오버레이(R6-복구·risk·display)는
**사이징(Kelly)·화면에만** 쓰며 **매수를 게이트하지 않는다.**

이 원칙을 코드 경계로 옮기면 두 결정으로 갈라진다:

- **D1 (주 결정)** — 매수/shadow 게이트를 정본 raw 로 단일화(오버레이 우회). shadow 전용이라 라이브 불변(#8) → **가장 먼저·안전하게** 켤 수 있다.
- **D2 (부 결정)** — D1 이 매수 경로를 raw 로 분리하면 stuck 은 더 이상 매수를 죽이지 못하고 **Kelly/display 만** 오염시킨다. D2 는 그 Kelly/display 정상화용(execution-adjacent).

---

## 1. Context — 코드 검증된 오염 메커니즘

코스피 상승장(+2.25%, rawRegime=R3_EARLY)인데 shadow 매수 0. 원인은 신호/Gate 채점 결함이 아니라
**R6-복구 상태기계가 `R5_STABILIZING` 에 영구 latch** 되어 오버레이가 매수 게이트까지 침범한 것이다.

### 1.1 정본은 R3_EARLY 인데 게이트 입력은 R5_CAUTION 으로 오염

- `preflight.ts:379` 현재:
  `learningRegime = toCanonicalRegimeLevel(regimeSnapshot.effectiveRegime) ?? regime`.
- `regimeSnapshot.effectiveRegime` = `sanitizeEffectiveRegime(marketState.effectiveRegime, diagnostics.rawRegime)`
  (regimeResolver.ts:83). **`sanitizeEffectiveRegime` 은 R6_* 만 강등**하고 (regimeResolver.ts:53-56)
  **R5_STABILIZING 은 통과**시킨다.
- R6-복구 latch 시 `marketStateResolver.base.ts:319` 가 `r6StateMachineState==='R5_STABILIZING'` 면
  transitionState.effectiveRegime(=R3_EARLY)을 무시하고 **R5_STABILIZING override** →
  `marketState.effectiveRegime = R5_STABILIZING` → snapshot.effectiveRegime = R5_STABILIZING.
- ⇒ `toCanonicalRegimeLevel(R5_STABILIZING) = R5_CAUTION` (R5 prefix, regimeEngine.ts:199) →
  **learningRegime = R5_CAUTION** (정본 raw 는 R3_EARLY 인데).
- 반면 **`regimeSnapshot.detectedRegime` = `diagnostics.rawRegime`**(regimeResolver.ts:93, 이미 snapshot 에 노출) = **R3_EARLY** — R5 오버레이 미경유.

### 1.2 shadow lane 영구 차단

- carry: `preflight.ts:837` `learningRegime` → BuyListLoopContext → buyListLoop:460/467/474 ·
  perSymbol/steps/provisionalShadowLane.ts:22 · perSymbol/steps/counterfactualShadowLane.ts:20/27/40.
- 두 lane 의 게이트는 `(ctx.learningRegime ?? ctx.regime) === 'R3_EARLY'` 이고, SSOT 차단은
  `provisionalShadowLane.ts:141` (`if (input.regime !== 'R3_EARLY') return null;`) ·
  `counterfactualShadowLearningLane.ts:231` (동일).
- learningRegime=R5_CAUTION → 두 lane 관문 영구 차단 → **shadow 매수 0.**

### 1.3 stuck latch 메커니즘 (D2 — 이전 조사 그대로 보존)

`resolveRecoveredStateMachine`(regimeBridge.base.ts:576-581)의 exit 가 **mhs 단일 입력**이다:

```
mhs ≥ 70 & raw ∈ {R1_TURBO,R2_BULL,R3_EARLY} → R3_NORMAL
mhs ≥ 65                                      → R4_CAUTION
else                                          → R5_STABILIZING
```

- 시간/연속 정상일(tick) 입력 없음. raw R3_EARLY 자격은 mhs≥40(regimeEngine.ts:252)이라
  **mhs 40~64 + raw R3_EARLY = "raw 강세인데 상태기계 R5_STABILIZING" 모순 지대** 영구 latch.
- 호출부(:845) `recovered & prev===R5_STABILIZING → resolveRecoveredStateMachine 재산출` → R5 재latch ·
  status(:847) R5 유지 · inRecoveryFlow(:804)가 `r6RecoveryStatus==='R5_STABILIZING'` 포함 → 매 tick 재진입 ·
  완전탈출 status='NONE'(:901-903)은 inRecoveryFlow=false 라야 도달인데 도달 불가(mhs≥70 만 사실상 탈출구).

### 1.4 오염 연쇄 (downstream)

R5_STABILIZING latch →
1. marketStateResolver:319 override → marketState.effectiveRegime = R5_STABILIZING.
2. regimeResolver.ts:38 `resolveRiskOverride` isR5Regime → **riskOverride=R5_STABILIZING (Kelly ×0.50).**
3. regimeResolver.ts:48 `resolveDisplayRegime` → **displayRegime=R5_STABILIZING.**
4. carry preflight.ts:379 learningRegime=R5_CAUTION → 두 shadow lane 차단(§1.2).

**D1 과 D2 의 분리점:** §1.4 의 (4)(shadow 게이트 차단)는 **D1 이 정본 raw 로 우회**해 끊는다(shadow 전용·라이브 불변).
(2)·(3)(Kelly·display 오염)은 **D2 가 stuck latch 자체를 풀어** 정상화한다(execution-adjacent).
**두 경로를 분리**했기에 운영자는 D1(shadow)만 먼저 켜고 D2(라이브 Kelly/display)는 보수 유지할 수 있다.

---

## 2. Decision D1 (주 — 매수 게이트 단일화, SHADOW 전용·안전)

### 2.1 D1.1 — learningRegime 정본 raw 파생 (채택)

`preflight.ts:379` learningRegime 입력을 **정본 raw** 로 전환한다(오버레이 우회):

```
// flag ON (BUY_GATE_CANONICAL_REGIME_ENABLED)
learningRegime = toCanonicalRegimeLevel(regimeSnapshot.detectedRegime)   // detectedRegime === diagnostics.rawRegime
  ?? toCanonicalRegimeLevel(regimeSnapshot.effectiveRegime)              // raw 결손 시 현행 경로 폴백
  ?? regime
// flag OFF — 현행 byte-identical
learningRegime = toCanonicalRegimeLevel(regimeSnapshot.effectiveRegime) ?? regime
```

- `regimeSnapshot.detectedRegime` 은 이미 snapshot 에 노출(`RegimeSnapshot.detectedRegime`, effectiveRegimeSnapshot.ts:32) —
  신규 carry 배선 0. R5_STABILIZING override(marketStateResolver:319)를 경유하지 않는 raw 분류.
- 효과: snapshot.effectiveRegime 이 R5_STABILIZING 으로 오염돼도 learningRegime = **R3_EARLY**(raw)로 산출.

### 2.2 D1.2 — shadow lane 게이트 밴드 확대 판정 ⇒ **기각 (D1.1 정본 regime 만 채택)**

shadow lane 게이트(`provisionalShadowLane.ts:141`·`counterfactualShadowLearningLane.ts:231`)의
`=== 'R3_EARLY'` 를 risk-on 밴드 멤버십(R1_TURBO/R2_BULL/R3_EARLY)으로 확대할지 평가했다.

**판정(pin): 확대 기각. D1.1(정본 regime) 만으로 충분.** 근거(코드 확인):

- **R1_TURBO/R2_BULL 는 이미 별도 매수 경로 보유** — 라이브/사이징 경로가 `ctx.regime ∈ {R1_TURBO,R2_BULL,R3_EARLY}`
  를 `isNormalRegime` 으로 동등 취급(buyListLoop.ts:690 · intradayLoop.ts:217 · preBreakoutEntry.ts:340 ·
  preBreakoutFollowthroughBudget.ts:119)하고, R1/R2 정상 국면은 **일반 shadow buy** 가 이미 표본을 생성한다.
- 따라서 provisional/counterfactual lane 을 R1/R2 로 확대하면 일반 shadow 표본과 **중복**(counterfactual 이중 기록).
  ADR-0426/0430 이 두 lane 을 `R3_EARLY` 한정으로 명시 설계한 이유(학습 표본 R3_EARLY-bound, "추가 regime 은 후속 PR scope")와 충돌.
- 본 인시던트의 정본 raw 는 **R3_EARLY** 이므로, D1.1 이 learningRegime=R3_EARLY 를 회복시키면
  현 `=== 'R3_EARLY'` 게이트가 **그대로 발화**한다. 밴드 확대는 불필요.
- risk-on 밴드 SSOT 는 이미 존재(`pipelineHelpers.ts:677` · `reversalMomentumCredit.ts:20`
  `RISK_ON_REGIMES=['R1_TURBO','R2_BULL','R3_EARLY']`, ADR-0593) — 추후 R1/R2 shadow lane 이 정당해지면
  이 SSOT 재사용으로 별도 ADR 처리. **본 ADR 에서는 미채택.**
- ⇒ shadow lane 게이트 코드 **0줄 변경**. D1 은 learningRegime 파생식(preflight.ts:379) 1지점만 손댄다.

### 2.3 D1 진단 문자열 정합 (display-only, flag 무관)

`persistScanResults.ts:603 / :649` noEligibleReason 가 `routerInput.regime`(= `macroGate?.regime`,
**LIVE-clamp 된 R4_NEUTRAL**)을 표시 → 실제 lane 게이트 값은 `learningRegime` 인데 운영자가 매번
"regime=R4_NEUTRAL" 헛다리(오진의 원인). 표시 문자열을 **learningRegime 병기**로 정합한다
(예: `regime=R4_NEUTRAL/learning=R3_EARLY`). **게이트 로직 무접촉 · 라인 순증 0**(문자열 교체).

⚠️ **복잡도 hard 제약**: persistScanResults.ts = **1489줄 / 한계 1500 (여유 11줄)**. :603/:649 는
**문자열 in-place 교체(라인 순증 금지)**. 신규 helper 가 필요하면 별 모듈로 분리(persistScanResults 본체 라인 증가 금지).

### 2.4 D1 flag 계약 (default-OFF byte-identical)

| flag | 기본값 | 비교 | SSOT |
|---|---|---|---|
| `BUY_GATE_CANONICAL_REGIME_ENABLED` | `false` | `=== 'true'` (ADR-0157) | `isBuyGateCanonicalRegimeEnabled()` — preflight.ts co-locate (또는 entryPolicySemantics.ts) |

- OFF → learningRegime 파생식이 현행 `toCanonicalRegimeLevel(regimeSnapshot.effectiveRegime)` 그대로 → **byte-identical.**
- ON → 정본 raw 우선 파생. **라이브 `regime`(preflight.ts:364-368 clamp), Kelly, 권한은 불변**(§3 #8).
- ENV 1줄 롤백: `BUY_GATE_CANONICAL_REGIME_ENABLED=false`.

---

## 3. D1 불변식 #8 — 라이브 byte-identical 엄밀 논증 (D1 을 D2 보다 먼저·안전하게 켜는 근거)

learningRegime 은 **shadow/counterfactual lane 전용 carry** 다. 라이브 매수 경로는 **`regime`**(preflight.ts:364-368)을
쓰며 이는 `observedRegime = regimeSnapshot.effectiveRegime` 에서 파생되고 REGIME_CONFIGS 키 부재 시 R4_NEUTRAL clamp 된다.

- `regime` ← `regimeSnapshot.effectiveRegime` (D1 미변경).
- `learningRegime` ← `regimeSnapshot.detectedRegime`(raw) (D1 변경, shadow 전용).
- 라이브 소비처는 **전부 `regime`/`regimeConfig`**: `buyWeightPct=regimeConfig.kellyMultiplier`(:502) ·
  `computeEffectiveKelly({macroRegime: normalizeMacroRegime(regime)...})`(:519) · `effectiveMaxPositions`(:544) ·
  `buildMacroGateState({regime, regimeKelly: regimeConfig.kellyMultiplier...})`(:653-654). **learningRegime 소비 0건.**
- `learningRegime` 소비처는 **전부 shadow**: buyListLoop provisional/counterfactual lane 게이트 + Router 입력(buyListLoop:460/467/474, perSymbol/steps/*).
- ⇒ D1 flag ON 이라도 **라이브 regime/Kelly/maxPositions/권한 byte-identical**. 바뀌는 것은 두 shadow lane 발화 여부뿐.

**결론**: D1 은 shadow 전용이라 라이브 0변화 → **D2(execution-adjacent)보다 안전**. 운영자가 D1 을 먼저 단독 ON 가능.
(기존 회귀 `preflightLearningRegimeCarry.test.ts` 가 `result.context.regime` 불변을 이미 가드 — D1 ON 케이스 추가.)

---

## 4. Decision D2 (부 — R6 복구 stuck-exit, execution-adjacent·Kelly/display)

이전 architect 설계(옵션 3 consecutive-healthy-tick)를 **그대로 보존**하되 **위상 강등**한다:
D1 이 매수 경로를 raw 로 분리하므로, stuck 은 더 이상 매수(shadow)를 죽이지 않고 **riskOverride(Kelly ×0.50)·display 만**
오염시킨다. D2 는 그 Kelly/display 정상화용이다.

### 4.1 채택 — 옵션 (3): 시간/연속 강세 tick 기반 강제 완료

`resolveRecoveredStateMachine` 의 mhs 단일 exit 에 **"raw 강세가 N tick 지속되면 R5 latch 강제 종료"** 2차 탈출 경로 추가.
mhs≥70 기존 탈출 보존, 모순 지대(mhs 40~64 + raw 강세)에서만 tick 기반 탈출. 첫 tick 은 R5 유지(falling-knife 보호).

### 4.2 exit 조건 계약 (engine-dev pin — 이전 설계 유지)

- **SSOT 함수**: `resolveRecoveredStateMachine(rawRegime, macroState, latchContext)` — 시그니처 확장. exit 판정은
  이 함수 단일 지점에서만. 호출부(:845) 외 분기 신설 금지.
- **신규 입력 `latchContext`**(계산은 호출부 주입, 함수 순수):
  `consecutiveHealthyRecoveryTicks: number`(raw 강세 연속 복구 tick) · `now: Date`(보조).
- **exit 로직(flag ON)**:
  ```
  if (mhs ≥ 70 & raw 강세) → R3_NORMAL          // 기존 (flag 무관 byte-identical)
  if (mhs ≥ 65)           → R4_CAUTION          // 기존
  if (R6_RECOVERY_STUCK_EXIT_ENABLED
      & raw ∈ {R1,R2,R3_EARLY}
      & consecutiveHealthyRecoveryTicks ≥ R6_RECOVERY_STUCK_EXIT_MIN_HEALTHY_TICKS)
      → R3_NORMAL                                // 모순 지대 latch 강제 종료
  else → R5_STABILIZING                          // 첫 tick~임계 미달: 초기 보호
  ```
- **첫 tick 보호 불변**: `consecutiveHealthyRecoveryTicks < 임계` → R5_STABILIZING 반환.

### 4.3 D2 flag 계약 (default-OFF byte-identical · D1 과 독립)

| flag / 상수 | 기본값 | 비교 | SSOT |
|---|---|---|---|
| `R6_RECOVERY_STUCK_EXIT_ENABLED` | `false` | `=== 'true'` | `isR6RecoveryStuckExitEnabled()` — regimeBridge.base.ts co-locate |
| `R6_RECOVERY_STUCK_EXIT_MIN_HEALTHY_TICKS` | `2` | `envInt`, 하한 clamp `≥1` | 동일 모듈 SSOT |

- OFF → exit 함수 신규 분기 미평가, 기존 mhs 단일 분기만 → **현 stuck byte-identical.**
- **D1 과 독립**: 운영자가 shadow 게이트(D1)만 ON 하고 라이브 Kelly/display(D2)는 보수 유지 가능.
- ENV 1줄 롤백: `R6_RECOVERY_STUCK_EXIT_ENABLED=false`.

### 4.4 영속 상태(regime-transition-state.json) — 하위호환 (이전 설계 유지)

- `RegimeTransitionState` 에 additive optional `consecutiveHealthyRecoveryTicks?: number`(regimeTransitionStateRepo.ts).
- `sanitizeState` sanitizer: finite → `Math.max(0, …)`, 아니면 `0`. `defaultRegimeTransitionState` 0.
- legacy json 부재 → 0(flag OFF 면 미사용 / ON 이면 0 부터 카운트 = 초기 보호 일치).
- 카운트 갱신은 호출부(:845 인근): raw 강세 & R5 latch 유지 → `prev+1`, raw 약세 이탈/latch 탈출 → `0` 리셋.
  flag OFF 면 OFF 분기에서 필드 미기입(byte-identical 보장).

---

## 5. Downstream 연쇄 (정상화 후 기대)

- **D1 ON**: snapshot.effectiveRegime 이 R5_STABILIZING 으로 오염돼도 learningRegime = R3_EARLY(raw) →
  두 shadow lane 발화 → shadow 매수 회복. **라이브 regime/Kelly/권한 불변(#8).** stuck 자체는 미해소(Kelly ×0.50·display=R5 유지).
- **D2 ON**(D1 무관): r6StateMachineState 가 N tick 후 R3_NORMAL 탈출 → marketState.effectiveRegime 정상화 →
  riskOverride NONE(Kelly ×1.0 회복) · displayRegime 정상. (D2 단독이면 learningRegime 도 effectiveRegime 정규화로 R3_EARLY 회복 — 단 D1 이 더 직접·안전.)
- **D1+D2 ON**: shadow 발화(D1) + Kelly/display 정상화(D2) 동시.

---

## 6. 9대 불변식 보존 논증

- **#1 (Trading Engine 무중단)**: D1 은 파생식 1줄 교체(throw 0). D2 는 순수 분기 추가 + 호출부 try/catch 무변경 ·
  latchContext 실패 시 fallback(tick=0)으로 R5 유지(안전측).
- **#2 (Shadow 정지 금지)**: D1·D2 모두 shadow lane 을 **여는 방향**(차단 해제)이지 정지 아님.
- **#3 / #9 (SourceSnapshot / regime 단일 통로)**: SourceSnapshot 불변. D1 은 이미 snapshot 에 노출된
  `detectedRegime` 재선택(신규 provider 조회 0). D2 는 regime 단일 통로 내부 exit 만 수정. Gate 내부 provider 직접 조회 0.
- **#4 / #5 (R6·SELL_ONLY 등은 SourceSnapshot 불변, Policy/Confidence/Permission/Label 만 변경)**: 정합.
- **#6 (provider 장애 ≠ market signal)**: D2 exit 는 raw 강세 tick 만 카운트. provider stale 은 기존 freshness 가드가 별도 차단.
- **#7 (L4 직접 매매 금지)**: AI_ESTIMATED 무관. regime 분류만.
- **#8 (실거래 ↔ shadow 분리)**: **D1 = shadow 전용 → 라이브 byte-identical(§3 엄밀 논증).** D2 = LIVE 사이징/권한
  건드림 → byte-equivalent + flag-gated 가 핵심(OFF=byte-identical, ON=ENV 1줄 롤백). 현 SHADOW_ONLY 라 LIVE 신규 매수 NONE.

---

## 7. Patch Scope Guard (ADR-530)

- **targetDomain**: regime layer (1 도메인. D1=preflight learningRegime 파생 + 진단 / D2=regimeBridge exit).
- **expectedBehaviorChange**:
  - D1 OFF=NONE byte-identical / ON=learningRegime 이 정본 raw 파생(R5 오버레이 우회) → snapshot R5 오염 상태에서도
    R3_EARLY → shadow lane 발화. 라이브 regime/Kelly/권한 불변.
  - D2 OFF=NONE byte-identical / ON=모순 지대 R5 latch N tick 후 R3_NORMAL 탈출 → riskOverride/Kelly/display 정상화.
- **allowedFiles**:
  - `server/trading/signalScanner/preflight.ts` — D1: learningRegime 파생식(:379) flag 분기 + `isBuyGateCanonicalRegimeEnabled()` SSOT.
  - `server/trading/signalScanner/scanDiagnostics/persistScanResults.ts` — D1: :603/:649 진단 문자열 learningRegime 병기(**라인 순증 0**, display-only, flag 무관).
  - `server/trading/regimeBridge.base.ts` — D2: `resolveRecoveredStateMachine` 시그니처+분기, 호출부(:845) latchContext+tick 카운트, flag/상수 SSOT.
  - `server/persistence/regimeTransitionStateRepo.ts` — D2: `consecutiveHealthyRecoveryTicks?` additive + sanitizer + default.
  - `.env.example` — flag 3종(D1 1 + D2 2) 문서화.
  - `*.test.ts` — 회귀(§8).
- **forbiddenFiles**: SourceSnapshot 본체 · autoTradeEngine · kisClient raw · Gate0~3 채점 · requiredScore=70 SSOT ·
  `classifyRegime` 자격 임계(regimeEngine.ts:252) · `toCanonicalRegimeLevel` 매핑 · `marketStateResolver.base.ts:319` override 로직 ·
  `resolveRiskOverride`/`resolveDisplayRegime` 본체 · **shadow lane 게이트(`=== 'R3_EARLY'`) — D1.2 기각으로 0줄** ·
  라이브 `regime` 파생(preflight.ts:364-368 clamp) · `computeEffectiveKelly`/`buildMacroGateState` 본체 · src/** UI · aiUniverseService.
- **sourceSnapshotImpact**: NONE.
- **executionImpact**: D1 OFF/ON 공히 라이브 byte-identical(shadow 전용) / D2 OFF=NONE · ON=execution-adjacent(riskOverride·Kelly·display·현 SHADOW_ONLY 안전).
- **shadowLearningImpact**: D1 ON 시 shadow lane 차단 해제(의도, #2 강화).
- **telegramImpact**: D1 진단 문자열 learningRegime 병기. D2 ON 시 displayRegime 정규화로 regime status 표시 변경. dedup 키 무변경.
- **providerImpact**: 없음(신규 fetch 0 — snapshot/macroState 재사용. KIS/KRX/Yahoo quota 0).
- **testsRequired**: §8.
- **rollbackPlan**: D1 `BUY_GATE_CANONICAL_REGIME_ENABLED=false` · D2 `R6_RECOVERY_STUCK_EXIT_ENABLED=false` (각 ENV 1줄·독립).

---

## 8. 회귀 테스트 설계 (quality-guard 검토 → engine-dev 구현)

### 8.1 D1 (매수 게이트 단일화)

- **(a) flag OFF byte-identical**: BUY_GATE_CANONICAL_REGIME_ENABLED 미설정 → learningRegime 이 현행
  `toCanonicalRegimeLevel(effectiveRegime)` 그대로(기존 preflightLearningRegimeCarry 5케이스 무회귀).
- **(b) flag ON + snapshot R5 오염**: effectiveRegime=R5_STABILIZING(or R5_CAUTION) **& detectedRegime=R3_EARLY** →
  `learningRegime === 'R3_EARLY'`(raw 우회). (현 #3 케이스가 R5_CAUTION 을 산출하던 것을 ON 에서 R3_EARLY 로 뒤집음.)
- **(c) shadow lane 발화**: (b) 상태 + Gate1 survivor → provisional/counterfactual lane `regime==='R3_EARLY'` 관문 통과(eligible≥1).
- **(d) 라이브 regime/Kelly 불변(#8)**: flag ON/OFF 무관 `result.context.regime` · kellyMultiplier · effectiveMaxPositions 동일값.
- **(e) 밴드 확대 기각 가드**: snapshot 정본 raw=R1_TURBO/R2_BULL → learningRegime=R1_TURBO/R2_BULL,
  두 shadow lane(`=== 'R3_EARLY'`)은 **여전히 미발화**(eligible=0) — D1.2 미채택 확정(중복 회피).
- **(f) raw 결손 폴백**: detectedRegime undefined/비문자열 → effectiveRegime 경로 폴백(현행 동작 유지).
- **(g) 진단 문자열**: provisional/counterfactual noEligibleReason 에 `learning=<learningRegime>` 병기(clamp R4_NEUTRAL 단독 오표시 제거).

### 8.2 D2 (stuck-exit — 이전 8케이스 유지)

- **(a) OFF stuck byte-identical**: mhs 40~64 + raw R3_EARLY 장기 → R5_STABILIZING latch 보존.
- **(b) ON 모순 지대 탈출**: mhs 40~64 + raw R3_EARLY + ticks≥임계 → R3_NORMAL.
- **(c) ON 첫 tick 초기 보호**: ticks<임계 → R5_STABILIZING(falling-knife 보호).
- **(d) effectiveRegime 정상화 연쇄**: (b)에서 effectiveRegime=R3_NORMAL → riskOverride=NONE(Kelly 정상).
- **(e) mhs≥70 정상 탈출 무회귀**: flag 무관 → R3_NORMAL.
- **(f) raw 약세 이탈 tick 리셋**: 강세 누적 중 raw 약세 → ticks=0.
- **(g) legacy json 하위호환**: `consecutiveHealthyRecoveryTicks` 부재 json → 0, 미충돌.
- **(h) D1·D2 독립**: D2 OFF + D1 ON → shadow 발화(D1) but Kelly ×0.50 유지(D2 미발동) — 위상 분리 검증.

---

## 9. Alternatives Considered

- **D1.1 정본 raw 파생** — **채택**. snapshot 에 이미 노출된 detectedRegime 재선택, shadow 전용, 라이브 불변, 신규 carry 0.
- **D1.2 shadow lane 밴드 확대(R1/R2/R3)** — **기각**(§2.2). R1/R2 는 이미 별도 라이브 매수 경로 + 일반 shadow 표본 보유 →
  provisional/counterfactual 확대는 중복. ADR-0426/0430 R3_EARLY-bound 설계와 충돌. 본 인시던트 정본 raw 가 R3_EARLY 라 D1.1 만으로 해소.
- **(D1-대안) effectiveRegime 오버레이 자체를 raw 로 교체** — 기각. effectiveRegime 은 라이브 regime/Kelly/권한의 입력이라 #8 byte-identical 깨짐 → 게이트 입력(learningRegime)만 raw 로 분기.
- **(D2 옵션 1) mhs 임계를 자격 40 정합** — 기각(점진 의미 약화·초기 보호 제거).
- **(D2 옵션 2) raw 강세면 mhs 무관 즉시 R3** — 기각(dead-cat bounce 보호 상실).
- **(D2 옵션 3) tick 기반 강제 완료** — **채택**(§4).
- **(공통) marketStateResolver:319 override 제거** — 기각(정본 우회·광범위·exit 단일 지점 + D1 게이트 분리로 충분).
- **(공통) default ON** — 기각(opt-in·#8).
- **D1·D2 단일 flag 통합** — 기각. D1(shadow 안전) ↔ D2(execution-adjacent) 위험도가 달라 **독립 flag** 로 분리(운영자 단계적 활성).

---

## References

- preflight.ts:364-368 (라이브 `regime` clamp), :379 (learningRegime 파생 — D1), :502/:519/:544/:653 (라이브 Kelly/maxPositions 소비), :837 (learningRegime carry)
- regimeResolver.ts:53-56 (`sanitizeEffectiveRegime` R6 만 강등·R5 통과), :83 (effectiveRegime), :93 (detectedRegime=rawRegime), :38/:48 (riskOverride/displayRegime)
- effectiveRegimeSnapshot.ts:32-33 (`detectedRegime`/`effectiveRegime` 타입)
- regimeEngine.ts:187-204 (`toCanonicalRegimeLevel` R5*→R5_CAUTION / R3*→R3_EARLY), :219-252 (`classifyRegime` R3_EARLY mhs≥40)
- provisionalShadowLane.ts:141 · counterfactualShadowLearningLane.ts:231 (shadow lane `=== 'R3_EARLY'` 게이트 — D1.2 기각으로 미변경)
- perSymbol/steps/provisionalShadowLane.ts:22 · counterfactualShadowLane.ts:20/27/40 · buyListLoop.ts:460/467/474 (learningRegime carry 소비)
- persistScanResults.ts:603/:649 (noEligibleReason `routerInput.regime` 표시 → learningRegime 병기, D1 진단)
- buyListLoop.ts:690 · intradayLoop.ts:217 · preBreakoutEntry.ts:340 (R1/R2/R3 isNormalRegime 라이브 경로 — D1.2 중복 근거)
- pipelineHelpers.ts:677 · reversalMomentumCredit.ts:20 (`RISK_ON_REGIMES` 밴드 SSOT, ADR-0593)
- regimeBridge.base.ts:576-581 (`resolveRecoveredStateMachine`), :804 (`inRecoveryFlow`), :845 (exit 호출부), :901-903 (status NONE) — D2
- marketStateResolver.base.ts:319 (R5_STABILIZING override)
- regimeTransitionStateRepo.ts (`RegimeTransitionState` / `sanitizeState`) — D2
- ADR-0531 (canonical Gate0 regime SSOT), 0561 (KIS Primary), 0157 (flag === 'true'), 0530 (Patch Scope Guard), 0146 (PR 자가 review), 0426/0430 (R3_EARLY shadow lane SSOT), 0593 (RISK_ON_REGIMES)
