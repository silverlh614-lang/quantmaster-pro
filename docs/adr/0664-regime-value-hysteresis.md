# ADR-0664 (구 0641 재발급) — 레짐 값 히스테리시스: effectiveRegime 디바운스(확정 dwell)

@responsibility effectiveRegime flapping(R3↔R4) 디바운스 — 새 레짐이 dwell 확정 전이면 confirmed 유지. R6 진입/이탈·복구는 즉시 예외. flag/dwell/영속 pending SSOT.

- **Status**: Accepted (구현 완료 — flag `REGIME_HYSTERESIS_ENABLED` default OFF byte-identical. 운영자 활성화 후 LIVE 동작 변경.)
- **Date**: 2026-06-19
- **Domain**: regime layer (`server/trading/regime/regimeHysteresis.ts` 신규 순수 SSOT · `regimeBridge.base.ts:getRegimeDiagnostics` wiring · `regimeTransitionStateRepo.ts` 영속 pending)
- **Execution adjacency**: ⚠️ **execution-adjacent** — effectiveRegime 은 라이브 Kelly·maxPositions·노출 예산에 영향. 따라서 flag default OFF(opt-in), ON 시 LIVE 동작 변경(thrash 감소 방향).
- **계보**: 0640 / 0593 / 0630 / 0531 / 0157 / 0530

---

## 0. 운영자 보고 (수용)

> "레짐이 너무 왔다갔다함." (ADR-0640 알림 수정 후속 — 알림이 아니라 **레짐 값 자체**의 진동 지적.)

ADR-0640 은 **알림 계층**(전환 알림 진동 억제·장외 게이트)을 고쳤다. 그러나 `effectiveRegime` **값 자체**가
3분 TTL refresh 마다 R3↔R4 로 재계산되어 토글되는 근본은 남아 있었다(장중이면 Kelly/한도가 실제로 떨림).

## 1. Context — 값 flapping 메커니즘

`getRegimeDiagnostics`(regimeBridge.base.ts) 정상 경로(R6 외)는
`effectiveRegime = applyForcedDowngrade(rawRegime, prev)` 로 **rawRegime 을 즉시 추종**한다(regimeBridge.base.ts:981).
`rawRegime` 은 `classifyRegime(buildRegimeVars(macroState, now))` 인데, `riskOnFastUpgradeEligible`(ADR-0593)이
`isFetchFresh(kospiIntradayFetchedAt, now, ttl)` 의 TTL 경계를 넘나들며 매 refresh 토글되면 R3 fast-upgrade
분기(regimeEngine.ts:295)가 켜졌다 꺼졌다 → rawRegime R3↔R4 → effectiveRegime 즉시 진동. (forced-upgrade·
earlySignals 등 다른 입력이 임계 근처에서 jitter 해도 동일 증상.)

## 2. Decision

신규 순수 SSOT `server/trading/regime/regimeHysteresis.ts` — `applyRegimeHysteresis` 디바운스:
새 effective 후보가 **연속 같은 값으로 minDwellMs 이상 + minConfirmations 회 이상** 관측돼야 실제 채택,
그 전엔 confirmed(직전 확정값) 유지(`held`). 교차 flap(R3↔R4)은 매 tick 후보가 confirmed 로 복귀하거나
바뀌어 pending 이 리셋 → **확정값에 머무름(안정)**. 진짜 추세 전환만 dwell 후 1회 깔끔히 채택.

`getRegimeDiagnostics` 가 `evaluateR6RecoveryTransition` 직후 `applyRegimeHysteresisToState` 로 후처리:
- **즉시 예외(디바운스 미적용)** — `r6RecoveryStatus≠'NONE'`(R6 복구 flow) · computed/confirmed 중 R6_DEFENSE
  (진입/이탈). 블랙스완·복구의 즉시성은 자체 머신이 관리하므로 지연 절대 금지(불변식 #1 안전).
- **디바운스 적용** — 정상 밴드(R1~R5) 전환만. held 면 effective 를 confirmed 로 되돌리고
  `transitionReason='REGIME_HYSTERESIS_HOLD:<후보>'` + 영속 pending(`pendingEffectiveRegime/Since/Count`).

영속 additive optional 3필드(regimeTransitionStateRepo sanitizer default undefined·0, legacy json 하위호환).

ENV(전부 SSOT co-locate): `REGIME_HYSTERESIS_ENABLED`(default OFF·`=== 'true'` ADR-0157) ·
`REGIME_HYSTERESIS_MIN_DWELL_MIN`(기본 15분·상한 120·음수/NaN→기본) ·
`REGIME_HYSTERESIS_MIN_CONFIRMATIONS`(기본 2·하한 1·상한 20).

**flag OFF → `getRegimeDiagnostics` computedState 그대로 반환 = byte-identical**(pending 미기록·effective 즉시 추종).

## 3. 9대 불변식 정합

- **#1 Trading Engine liveness** — 순수 디바운스(throw 0). R6 진입/이탈·복구는 즉시 예외 → 방어 지연 0.
- **#2 Shadow 정지 금지** — Shadow 표본/라벨 무접촉.
- **#3/#9 SourceSnapshot 단일 통로** — rawRegime 은 기존 파생 재사용. provider 직접조회 0·신규 fetch 0.
- **#4/#5 상태 ≠ 데이터** — SourceSnapshot 불변. effectiveRegime(Policy/Confidence/사이징 입력)만 안정화.
- **#6 providerIssue ≠ bearish** — freshness flap 을 디바운스로 흡수(stale 를 신호로 변환하지 않음·오히려 노이즈 제거).
- **#7 L4→LIVE 금지** — 무관.
- **#8 실거래/Shadow 분리** — autoTradeEngine·kisClient·order **0줄**. flag OFF LIVE byte-identical · ON 은 effective 안정화(thrash 감소).

## 4. Patch Scope Guard (ADR-530)

- **targetDomain**: regime(1).
- **allowedFiles**: `regimeHysteresis.ts`(신규) · `regimeBridge.base.ts`(import + `applyRegimeHysteresisToState`/`clearRegimeHysteresisPending` + `getRegimeDiagnostics` 후처리) · `regimeTransitionStateRepo.ts`(additive 3필드 + sanitizer) · `regimeHysteresis.test.ts` · `regimeBridgeHysteresisAdr0664.test.ts` · 본 ADR · `INDEX.md`(0664→0665) · `10-patch-history-index.md` · `.env.example`(3 ENV).
- **forbiddenFiles**: SourceSnapshot 생성기 · autoTradeEngine · kisClient · Gate0~3 채점 · requiredScore=70 · `classifyRegime`/`buildRegimeVars` 본체 · `evaluateR6RecoveryTransition` R6 분기 · `applyForcedDowngrade`/`capRecoveryRegime` · marketStateResolver · src/**.
- **executionImpact**: flag OFF=NONE(byte-identical) / ON=effective 안정화(라이브 Kelly·maxPositions thrash 감소·진짜 추세만 채택).
- **sourceSnapshotImpact / shadowLearningImpact / telegramImpact / providerImpact**: NONE(알림은 안정화된 effective 를 그대로 소비).
- **testsRequired**: 디바운스(변화없음/첫관측 hold/dwell 채택/dwell 미충족/교차 flap 안정/손상 since) · ENV clamp · wiring(raw R3·flag OFF 즉시·ON hold·dwell 후 채택).
- **rollbackPlan**: `REGIME_HYSTERESIS_ENABLED=false`(또는 미설정) ENV 1줄 → byte-identical 복귀.

## 5. Alternatives (기각)

- **알림 계층만(ADR-0640)으로 종결** 기각 — 값 자체가 떨려 장중 사이징 thrash 잔존(운영자가 값 진동 명시 지적).
- **rawRegime/classifyRegime 에 히스테리시스** 기각 — raw 는 정본 시장분류(검증·shadow 정합 기준), 디바운스는 effective(소비) 측이 정당.
- **fast-upgrade freshness 만 latch** 기각 — flapping 원인이 fast-upgrade 단일이라는 보장 없음(forced-upgrade/earlySignals jitter 도 동형). effective 디바운스가 모든 입력 jitter 를 일괄 흡수.
- **default ON** 기각 — execution-adjacent(라이브 사이징). ADR-0157 opt-in + 운영자 활성화.
- **downgrade 도 디바운스 지연** 우려 → R6 즉시 예외로 해소(R6 하방은 즉시, 정상 밴드 R3↔R5 만 디바운스).
