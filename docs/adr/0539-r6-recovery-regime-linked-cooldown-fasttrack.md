# ADR-0539: R6 Recovery Regime-Linked Cooldown Fast-Track

@responsibility trading-engine — R6 recovery cooldown 시간벽을 raw 레짐 회복에 연동해 조기해제(내부 TradingSettings 토글, 기본 ON; evidence/confirmations 유지, #3 시간벽만 우회).

## Status

Accepted.

## Context

`server/trading/regimeBridge.base.ts` 의 R6 recovery state machine 은
`recovered` 플래그를 3중 AND 로 산출한다:

```
recovered = evidenceComplete(evidence)                      // #1
         && nextConfirmations >= requiredConfirmations      // #2
         && Date.parse(cooldownUntil) <= now.getTime();     // #3 (240분 고정 시간벽)
```

`cooldownUntil` 은 최초 R6 진입 시점부터 `R6_RECOVERY_COOLDOWN_MINUTES`(기본 **240분/4h**)
절대시각으로 set 되고 이후 사이클마다 `?? previousState.cooldownUntil` 로 그대로 carry-forward
된다(`regimeBridge.base.ts:638`). 문제는 #3 시간벽이 **raw 레짐 회복에 미연동**이라는 점이다 —
raw 가 R6_DEFENSE → R3_EARLY 로 회복(코스피 +2%)돼도 cooldownUntil 이 미경과면 `recovered=false`
가 되어 effectiveRegime 은 `capRecoveryRegime` 로 R5_CAUTION 에 capping 되고
`recoveryBlockedReason=R6_COOLDOWN_ACTIVE` 로 live 매수가 차단된다. **조기 해제 경로가 코드에
존재하지 않는다** (latch decay·shock-latch 해제는 별개이며 `recovered` 의 cooldown 항을 우회하지 않음).

이 동작은 회귀 테스트 `server/trading/regimeBridgeR6Recovery.test.ts:246`
("caps an immediate R6 exit to R5 during cooldown even if raw regime is R3")로 의도된 보수성으로
고정돼 있었다. 근본원인 조사는
`_workspace/2026-05-29_gate1-zero-rootcause/CONSOLIDATED-FINDINGS.md`(원인 #1) 및
`engine-dev/macro-r6-findings.md`(Q3 가설 확정) 참조.

추가로 현재 live 차단은 cooldown 단독이 아니라 4중 중첩(R6 cooldown + engine baseMode OFF/SHADOW_ONLY
+ FSS/수급 36h+ stale + R3 sanity latch)이라, cooldown 만 풀어도 live 가 자동 허용되지는 않는다.
본 ADR 은 그중 **cooldown 시간벽 1개만** 다룬다.

## Decision

`regimeBridge.base.ts` line 640(recovered 산출)에 **내부설정-gated regime-linked cooldown fast-track**
를 도입한다. 토글은 앱 내부 설정 `TradingSettings.r6RecoveryFastTrack.enabled`(loadTradingSettings,
**기본 ON**)에서 읽는다 — Railway 외부 ENV 가 아니다. 핵심: **#1 evidenceComplete·#2 confirmations 는
절대 우회하지 않고, #3 cooldown 시간벽만 조건부로 우회**한다.

```
const cooldownElapsed = Date.parse(cooldownUntil) <= now.getTime();
const fastTrackEnabled = loadTradingSettings().r6RecoveryFastTrack?.enabled === true;  // 내부 설정(기본 ON)
const rawRecoveredToHealthy = REGIME_ORDER.indexOf(rawRegime) >= REGIME_ORDER.indexOf('R3_EARLY');
const shockLatchStillActive = previousState.r6ShockLatch === true && !isLatchExpired(previousState, now);
const cooldownFastTrack =
  fastTrackEnabled &&
  rawRecoveredToHealthy &&                                        // raw 가 R3_EARLY 이상(healthy)
  !isHardStaleForRecovery(triggerBreakdown.triggerFreshness) &&   // 불변식 #6: stale ≠ tradable
  !shockLatchStillActive;                                         // VKOSPI/intraday-low latch 비활성
const recovered = evidenceComplete(evidence)
               && nextConfirmations >= requiredConfirmations
               && (cooldownElapsed || cooldownFastTrack);
```

**가드레일 4종** (fast-track 발동 전제):

1. `fastTrackEnabled` — 내부 `TradingSettings.r6RecoveryFastTrack.enabled`(loadTradingSettings). **기본 ON**
   (운영자 결정). Railway 외부 ENV 아님 — 설정 API/UI 에서 `enabled=false` 로 토글/롤백.
2. `rawRecoveredToHealthy` — `REGIME_ORDER` 상 raw 가 R3_EARLY 이상(R3_EARLY/R2_BULL/R1_TURBO).
   R4_NEUTRAL/R5_CAUTION/R6_DEFENSE 는 제외. `capRecoveryRegime`/`applyForcedDowngrade` 와 동일 literal 체계.
3. `!isHardStaleForRecovery(triggerFreshness)` — HARD_STALE/STALE/MISSING 이면 차단(불변식 #6).
4. `!shockLatchStillActive` — `previousState.r6ShockLatch && !isLatchExpired(...)` 직접 판정.
   (`latchStillActive` 는 `!recovered && ...` 라 순환 → previousState 에서 직접 판정해 회피.)

**진단 가시화** (fast-track 가 *유일하게* recovered 를 끌어올린 cooldown 미경과 케이스에서만):
- `console.info('[R6_REGIME_FASTTRACK_RELEASED] ...')` — rawRegime/cooldownUntil/confirmations/
  freshness/shockLatchActive=false/evidenceComplete=true/executionImpact=COOLDOWN_TIMEWALL_BYPASSED.
- `transitionReason = 'R6_REGIME_FASTTRACK_RELEASED; cooldown time-wall bypassed by raw regime recovery
  (evidence+confirmations held)'`.
- `status`/`r6StateMachineState`/`effectiveRegime` 산출은 **기존 recovered=true 경로를 그대로** 탄다
  (별도 분기 신설 없음 — recovered 값만 조건부로 끌어올림).

## Consequences

- **변동성 직후 재진입 위험**: 장초반 KOSPI 급변 후 반등 국면에서 cooldown 을 조기 해제하면 변동성
  잔존 구간 재진입 위험이 있다. → evidence·confirmations·not-stale·no-shock-latch **4중 가드**로 완화하며,
  필요 시 설정에서 즉시 OFF. (운영자 결정으로 기본 ON — 위 위험을 인지하고 활성화.)
- **불변식 #6 정합**: `!isHardStaleForRecovery` 가드로 provider stale 은 tradable 로 승격되지 않는다.
  fast-track 은 healthy raw + fresh trigger 일 때만 발동.
- **불변식 #4/#5 정합**: SourceSnapshot(MacroState)은 불변. fast-track 은 `transitionState`(파생)의
  recovered/effectiveRegime/Policy 만 바꾼다.
- **FSS/engine 차단은 별도**: fast-track 은 *cooldown 시간벽만* 푼다. FSS-stale live gate
  (`SNAPSHOT_STALE_NOT_LIVE_TRADABLE`)·engine SHADOW_ONLY(baseMode OFF)·R3 sanity latch 는 이 파일 밖
  이라 무관하며 그대로 유지된다. cooldown 해제 ≠ live 자동 허용.
- **기본 ON — 의도적 활성화 (NOT byte-equivalent)**: 운영자 결정으로 default ON 이다. 머지 즉시 fast-track
  가드가 활성화되어, raw 가 R3↑로 회복 + evidence + confirmations + not-stale + no-latch 충족 시 cooldown
  시간벽이 조기해제된다. 비활성화는 설정 API/UI 에서 `r6RecoveryFastTrack.enabled=false`(코드/배포/Railway
  무변경, 즉시 롤백). 회귀 테스트의 disabled 케이스가 이 OFF 경로(기존 240분 hold)를 고정한다.
- **executionImpact**: regime/policy 한정 — recovered/effectiveRegime/cooldown 만 바꾼다. FSS-stale live gate
  (`SNAPSHOT_STALE_NOT_LIVE_TRADABLE`)·engine SHADOW_ONLY 등 다른 차단이 남아 cooldown 해제만으로 live 주문이
  자동 발생하지는 않는다.

## Guardrails

- No live trading path change unless explicitly stated. (autoTradeEngine/kisClient 주문 경로 무변경.)
- No KIS/order import or invocation. (regimeBridge.base.ts 외 로직 변경 0줄.)
- No Gate/Kelly/STRONG_BUY behavior change. (#1 evidence·#2 confirmations 게이트 무변경.)
- No Shadow policy change. (shadowLearningAllowed 무변경 — 모든 경로 shadow 유지.)
- No provider fetch behavior change. (SourceSnapshot/MacroState 불변, 불변식 #6 보존.)
- No data promotion behavior change. (L1~L4 등급 무변경.)

## Alternatives Considered

- **`R6_RECOVERY_COOLDOWN_MINUTES` 하향 (240→90)**: 코드 0줄. 단 모든 R6 회복에 일률 적용 — 레짐 회복
  여부와 무관하게 단축되어 보수성이 약화된다. fast-track 은 healthy raw + not-stale + no-latch 일 때만
  조건부 단축이라 더 정밀하다.
- **`recovered` 에서 cooldown 항 제거**: 확인 2회만으로 해제. 시간벽 안전장치 영구 제거 — 비권장.
- **shadow-only 관찰 후 영구 단축**: 현 ADR 이 그 1단계(ENV-gated). shadow 검증 후 default 전환 여부는
  후속 ADR 로 분리.

## Rollback

설정 API/UI(또는 `data/tradingSettings.json`)에서 `r6RecoveryFastTrack.enabled=false` → 즉시 OFF 경로
(기존 240분 hold) 복귀. 코드/배포/Railway ENV 무변경. 회귀 테스트 `regimeBridgeR6Recovery.test.ts` 의
disabled 케이스가 이 롤백 안전성을 고정한다.
