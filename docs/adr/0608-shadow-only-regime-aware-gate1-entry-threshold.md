# ADR-0608: Shadow-only regime-aware Gate1 entry threshold (ENV 게이트, default OFF byte-equivalent)

@responsibility policy — SHADOW(paper) 진입 게이트에만 regime-aware Gate1 임계(getEffectiveGateThreshold(regime))를 적용해 [regime,70) 후보를 paper fill 시키고, LIVE 진입은 legacy 임계로 byte-equivalent 보존하는 진입 임계 분기 정책 (default OFF).

## Status

Proposed (Phase 0 — 경계·타입·ADR. 구현은 engine-dev Phase 1 인계. default OFF byte-equivalent.)

> SHADOW 표본 확대 단독 — engine-dev. 진입 임계 도메인.
> ENV `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED` default OFF → 현재 LIVE/SHADOW 진입 동작 영향 0.

## Context

### 사용자 결정 (확정 — 변경 금지)

1. **SHADOW 진입 게이트에만 regime-aware 임계 적용** — R3 상승장 등에서 [regime, legacy) 구간(R3_EARLY 의 경우 ×1 [4,7), ×10 [40,70)) 종목이 SHADOW paper fill 되어 익절/손절/forward 성과가 실거래처럼 누적·검증되게 한다.
2. **LIVE 진입 임계는 기존 무변경** — byte-equivalent 절대 보존.
3. 관측 원장(provisionalShadowLedger/counterfactual)이 아니라 **실제 SHADOW paper-fill 라이프사이클**(buildBuyTrade → 익절/손절/trailing/forward PnL)로 진입시키는 것이 목표.

### 확정된 진입 게이트 사실 (코드 추적 완료 — 신뢰)

진입 임계가 실제로 매수/paper-fill 을 차단하는 단일 지점은 **하나**다:

- **`evaluateEntryRevalidation`(`server/trading/entryEngine.ts:313`)** 의 line 370:
  `if (input.quoteSignalType === 'SKIP' || (input.quoteGateScore ?? minGate) < minGate)` → fail reason push → `ok:false`.
- `minGate` 은 호출자가 **주입**한다(`input.minGateScore ?? ENTRY_MIN_GATE_SCORE(=5)`). 함수 본체는 임계값을
  하드코딩하지 않는다 — **임계 결정은 전부 호출 site 에 있다**(= seam).
- 이 임계 검사는 `liveEntryAllowed`/`shadowLearningAllowed` 와 **무관하게 동일 실행**된다.
  즉 현재 LIVE 와 SHADOW(paper) 가 **같은 임계를 공유**한다.

실제 production 진입 경로(`buyListLoop`)의 임계 주입 site:

- **`entryRevalidationStep`(`server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts:67`)**:
  `const minGateBase = getMinGateScore(input.regime)` (×1 scale = `getEffectiveGateThreshold(regime)`).
  → `evaluateEntryRevalidation({ minGateScore: minGate, ... })`.
- 호출 체인: `buyListLoop.ts:446 handleEntryRevalidationGate` → `entryRevalidationStep` → `evaluateEntryRevalidation`.
  `handleEntryRevalidationGate` 가 `!proceed` 시 `'SKIP'` 반환 → `buyListLoop.ts:457 if (entryRevalidationResult === 'SKIP') continue;`
  → 루프 iteration 전체 중단 → **하류 `buildBuyTrade`(buyListLoop.ts:716, shadowMode 무관) 도달 불가**.
- 결론: **SHADOW paper fill 은 LIVE 와 동일한 `getMinGateScore(regime)` 임계를 통과해야만 한다.**
  LIVE/SHADOW 분기는 `stockShadowMode`(buildBuyTrade 의 `mode: SHADOW|LIVE`)이고, 임계 게이트는 공유다.

진입 게이트 vs gate1Passed 의 관계 (오해 방지):

- `summary.gate1.passed`(`server/quantFilter.ts:788`)는 **점수 임계가 아니라** 조건별 status 집계다:
  `passed = unavailable.length===0 && providerDegraded.length===0 && thresholdNotMet.length===0 && fired.length>0`.
  `isGate1Survivor = ge2?.gate1Passed === true`(buyListLoop.ts:382)는 *survivor 자격*일 뿐,
  진입 수치 임계는 별도(`evaluateEntryRevalidation`/`getMinGateScore`)다. 두 개념을 혼동하면 안 된다.

진입과 무관한 `resolveGate1RequiredScore`(×10) 소비처 3곳(전부 비진입, 변경 0):

- `server/learning/gateThresholdRecommendation.ts:65` (학습 추천 표시).
- `server/trading/signalScanner/gate1RegimeAwareWindowAdr0546.ts` / `...SurvivorAdr0546` (forward observation).
- `gate1ScoreAccounting`(표시). → 본 ADR 은 이들을 건드리지 않는다.

별도 SHADOW 진입 경로 (본 ADR scope 와 직교 — 변경 없음):

- `provisionalShadowLaneDerive`(buyListLoop.ts:429) / `counterfactualShadowLearning`(buyListLoop.ts:435) /
  `gateEligibilitySplit`(buyListLoop.ts:400) = **관측·ledger 전용**(counter/json 영속). paper-fill 라이프사이클 아님.
  이들은 `handleEntryRevalidationGate` 보다 *앞*(line 400/429/435 < 446)에서 실행 → 이미 minGate 무관.
- `preBreakoutEntry.ts`(buyListLoop.ts:302 preBreakoutEntry)는 별도 paper-fill(`buildBuyTrade({shadowMode:true})`,
  line 205/419, `gate1Passed: undefined`)이지만 **진입 트리거가 점수 임계가 아니라 entryPrice 근접(nearEntry/breakout)**
  이라 본 ADR 의 임계 변경과 직교 — **무접촉**.

### 문제 — regime-aware 임계가 진입 게이트에 wiring 안 됨

R3 상승장에서 regime-aware ×1 임계는 R3_EARLY=4(`src/constants/gateConfig.ts:127` normal:4), legacy 진입 임계는
`getMinGateScore` 가 `getEffectiveGateThreshold` 를 그대로 쓰므로 이미 4를 반환한다 — *그러나* 실측상
[40,70)(×10) 구간 34개 종목이 paper fill 0인 이유는 score scale·legacy 70 컷이 **관측 layer**(×10)에만 적용되고,
진입 layer 는 `getMinGateScore`(×1) 인데 이 ×1 경로가 이미 regime-aware 값을 반환함에도 SHADOW fill 이 0이라는
관찰은, 진입 차단이 `evaluateEntryRevalidation` 의 *다른* fail 사유(돌파 이탈 과열/거래량 급감/signalType SKIP)
또는 상류 survivor 미달에서 발생함을 시사한다. 본 ADR 의 **핵심 안전 설계**는 다음이다:

> 진입 임계를 SHADOW 에서만 명시적으로 regime-aware 로 **고정**하고, LIVE 는 별도 legacy 상수로 **분리**한다.
> 그래야 이후 legacy 진입 임계를 (운영자 판단으로) 변경하더라도 SHADOW 표본 확대가 LIVE 와 독립적으로
> 보존되고, 반대로 LIVE 임계 튜닝이 SHADOW 표본을 오염시키지 않는다.

현재는 LIVE/SHADOW 가 `getMinGateScore` 단일 함수를 공유 → **임계 분리 자체가 불가능**. 본 ADR 은 이 분리를 만든다.

## Decision

### D1. SHADOW vs LIVE 진입 임계 분기 (단일 seam)

`evaluateEntryRevalidation` 본체(entryEngine.ts:313~)는 **무변경**. 임계 결정 site(`entryRevalidationStep.ts:67`)에서만 분기한다:

- **SHADOW 경로**(`stockShadowMode === true`) + ENV ON → `minGateBase = getEffectiveGateThreshold(regime)` (regime-aware ×1).
- **LIVE 경로**(`stockShadowMode === false`) 또는 ENV OFF → `minGateBase = getMinGateScore(regime)` (현행 = 기존 byte-equivalent).

신규 순수 SSOT `server/trading/gate1ShadowEntryThreshold.ts`:

```text
isGate1RegimeAwareShadowEntryEnabled(): process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED === 'true'  // default OFF
resolveEntryMinGateScore({ regime, isShadow }): number
  // ENV ON && isShadow → getEffectiveGateThreshold(regime)   (regime-aware)
  // 그 외(LIVE 또는 ENV OFF)        → getMinGateScore(regime) (현행 SSOT, byte-equivalent)
```

`getMinGateScore` 가 이미 `getEffectiveGateThreshold` 를 반환하므로(entryEngine.ts:51) 현 시점 두 값은 수치상
동일할 수 있으나, **분리 자체가 목적**이다: 향후 LEGACY 진입 임계가 변경(예: 운영자 강화)되어도 SHADOW 는
regime-aware 로 독립 보존되고, regime-aware 가 별도 LIVE/SHADOW 정책으로 갈라질 수 있는 seam 을 확보한다.
또한 본 함수가 `entryThresholdMode` 라벨(D3)의 SSOT 가 된다.

### D2. ENV 게이트 — `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED`

- 정확 비교(`=== 'true'`). default OFF.
- **OFF**: `resolveEntryMinGateScore` 가 LIVE/SHADOW 모두 `getMinGateScore(regime)` → 현행 진입 100% byte-equivalent.
- **ON**: SHADOW 경로만 `getEffectiveGateThreshold(regime)` 로 전환. LIVE 경로는 ENV 와 무관하게 항상 `getMinGateScore`.
- ENV 헬퍼 SSOT = 신규 `gate1ShadowEntryThreshold.ts`(riskOnFastUpgrade.ts 분리 선례). `.env.example` 1줄.
- 롤백 = ENV 1줄 OFF.

### D3. SHADOW 표본 라벨 — `entryThresholdMode`

regime-aware 임계로 **추가 진입**한 SHADOW 표본을 기존 표본과 구분한다(학습 표본 오염 방지). `ServerShadowTrade`
(server)에 additive optional `entryThresholdMode?: 'LEGACY' | 'REGIME_AWARE_SHADOW'` 추가:

- `'REGIME_AWARE_SHADOW'`: ENV ON && shadow && regime-aware 임계가 legacy 보다 낮아 통과한 진입(즉 legacy 였다면
  탈락했을 표본). `buildBuyTrade` 가 진입 시점 스탬프. 미설정/`'LEGACY'`(default 후방호환) = 기존 표본.
- 효과: nightlyReflection/attribution/walkForward 가 `entryThresholdMode` 로 표본을 필터·층화 가능 → regime-aware
  진입의 성과를 legacy 표본과 격리 검증. 라벨은 **학습 분리용**일 뿐 청산 규칙·사이징·LIVE 판정에 영향 0.

### D4. LIVE byte-equivalent 보장 메커니즘 (절대 안 바뀌는 코드)

1. **`evaluateEntryRevalidation`(entryEngine.ts:313~464) 본체 0줄 변경** — 임계는 여전히 주입값(`input.minGateScore`).
   line 370 비교식·fail 사유·반환 shape 무변경.
2. **`getMinGateScore`(entryEngine.ts:50) / `getEffectiveGateThreshold`(gateConfig.ts:61) 0줄 변경** —
   LIVE 가 소비하는 SSOT 무접촉.
3. **`resolveEntryMinGateScore` 의 LIVE 분기 = `getMinGateScore(regime)` 1:1** — LIVE 는 ENV 와 무관하게
   기존 함수를 그대로 호출(우회 경로·새 산식 0). ENV OFF 시 SHADOW 도 동일 → 전 경로 byte-equivalent.
4. **`dryRunScanner.ts:269`(getMinGateScore 소비) 무변경** — dry-run(시뮬레이션, `dryRun:true`)은 진입 아님.
5. **autoTradeEngine / KIS 주문 / preOrderGuard 무접촉** — 임계 라벨만 변경, 주문 본체 0줄.
6. **회귀 가드**: ENV OFF byte-equivalent 테스트 + LIVE 경로(`stockShadowMode=false`) requiredGateScore 불변 테스트.

### 9대 불변식 보존 근거

- **#1 Trading Engine liveness**: SHADOW 임계 완화는 진입 *확대*만 — LIVE 차단·엔진 정지 유발 0.
  분기 헬퍼는 순수 함수(provider/store/now 0), 실패 시 LIVE 경로 fallback(`getMinGateScore`).
- **#7 AI_ESTIMATED(L4) live 금지**: 임계 수치는 KIS L1 점수 기반(`getEffectiveGateThreshold`), L4 미사용.
  SHADOW 표본 확대는 paper-fill 학습 전용 — LIVE 매매 결정에 L4 유입 0.
- **#8 실거래/SHADOW 차단 분리**: 본 ADR 의 정수. LIVE 임계(legacy)와 SHADOW 임계(regime-aware)를
  **명시적으로 분리** — SHADOW 진입 확대가 LIVE 진입 판정을 변경하지 못함(`stockShadowMode` 분기 + LIVE 분기
  byte-equivalent). `entryThresholdMode` 라벨로 표본 무결성까지 격리.
- **#6 providerIssue ≠ marketSignal**: 임계 분기는 provider 상태 미참조 — 결손→bearish 변환 0.

### executionImpact 분류

- ENV OFF: **NONE** (byte-equivalent).
- ENV ON: **execution-adjacent (SHADOW only)** — paper-fill 진입 표본 확대. LIVE 매매 본체 0줄·KIS quota 0·실주문 0.

## Consequences

### 긍정

- R3 상승장 [regime, legacy) 구간(예 ×10 [40,70))이 SHADOW paper fill → 익절/손절/forward 성과 누적·검증.
- LIVE/SHADOW 진입 임계 **분리 seam** 확보 → 향후 정책 독립 진화(LIVE 강화 ↛ SHADOW 표본 손실, 역도 성립).
- `entryThresholdMode` 라벨로 학습 표본 층화 → regime-aware 진입 성과를 통계적으로 격리 검증 후 LIVE 승급 판단 근거.

### 부정 / 위험

- SHADOW 표본 분포 변화 → nightlyReflection/attribution 가 `entryThresholdMode` 미필터 시 혼합 통계 산출 가능.
  완화: D3 라벨 + engine-dev 인계 §표본 라벨 회귀 테스트.
- ENV ON 시 SHADOW 진입 빈도 증가 → SHADOW 슬롯/장부 크기 증가. LIVE 슬롯·실자본 무관(SHADOW paper).

## Alternatives Considered

1. **`evaluateEntryRevalidation` 본체에 isShadow 분기 추가** — 기각. 본체 변경 = LIVE byte-equivalent 보장 약화.
   임계 주입 site(entryRevalidationStep) 분기가 본체 무변경으로 동일 목적 달성(최소 변경).
2. **`GATE1_REGIME_AWARE_REQUIRED`(ADR-0546, ×10 관측 flag) 재사용** — 기각. 그 flag 는 관측 layer(×10) 전용이고
   LIVE/SHADOW 공통 적용이라 LIVE 진입까지 바꾼다 → 사용자 "LIVE 무변경" 위반. 본 ADR 은 SHADOW 전용 신규 flag.
3. **provisionalShadowLedger 를 paper-fill 라이프사이클로 승격** — 기각. 별도 ledger(관측/forward obs)는 익절/손절
   라이프사이클이 없고, 승격 시 대규모 신규 인프라(최소 골격 위반). 기존 `buildBuyTrade` 경로 재사용이 최소.
4. **진입 임계를 전역 완화(LEGACY 70→regime)** — 기각. LIVE 진입까지 완화 → byte-equivalent 위반·실자본 리스크.

## References

- 확정 진입 게이트 사실: `server/trading/entryEngine.ts:313`(evaluateEntryRevalidation) · `:50`(getMinGateScore) ·
  `server/trading/signalScanner/revalidationSteps/entryRevalidationStep.ts:67` ·
  `server/trading/signalScanner/perSymbol/buyListLoop.ts:382,446,457,716` ·
  `server/trading/signalScanner/perSymbol/steps/entryRevalidationGate.ts:64` ·
  `server/trading/gateConfig.ts:61,181` · `server/quantFilter.ts:788`.
- 표본 라벨: `server/persistence/shadowTradeRepo.ts:430`(ServerShadowTrade) · `server/trading/buyPipeline.ts:170`(buildBuyTrade) ·
  `src/api/autoTradeClient.ts`(client mirror).
- 직교 경로: `server/trading/signalScanner/perSymbol/steps/preBreakoutEntry.ts` · `provisionalShadowLane.ts` ·
  `gateEligibilitySplit.ts` · `counterfactualShadowLane.ts`.
- 계보: ADR-0546(Gate1 required-score SSOT) · ADR-0436(eligibility split) · ADR-0426/0427(provisional shadow lane) ·
  ADR-0393/0395(execution mode SSOT) · ADR-0146(byte-equivalent) · ADR-0607(default OFF shadow isolation 선례).
- 9대 불변식: CLAUDE.md §2.1 (#1/#6/#7/#8).
