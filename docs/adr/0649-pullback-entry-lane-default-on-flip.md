# ADR-0649 — Pullback Entry Lane default-ON flip — `isPullbackEntryLaneEnabled` `=== 'true'` → `!== 'false'`

@responsibility ADR-0648 눌림목 진입 레인(레인 B + 과열 가드 + RRR-우선)을 운영자 승인으로 default OFF→ON 승격(ENV 계약 `=== 'true'`→`!== 'false'`, flag-lifecycle status SHADOW_OFF→ON)하는 정책 ADR. 본체 로직·임계 0줄 변경, explicit `=false` kill-switch byte-identical.

- **Status:** Accepted (운영자 silverlh614 "default on 해줘" 승인).
- **Date:** 2026-06-22
- **Branch:** `claude/scan-blockers-diagnostic-wp93a3`
- **Patch vs ADR:** ADR (default OFF→ON flip = ENV 계약 변경 + flag-lifecycle status 전환). INDEX.md 0649→0650 갱신 의무.
- **Supersedes / Extends:** ADR-0648(눌림목 레인 배선 — 본 ADR 이 그 "shadow 검증 후 flip" 단계를 운영자 승인으로 충족·supersede)·ADR-0647(VOLUME_LIQUIDITY default-ON flip — 동일 `=== 'true'`→`!== 'false'` 패턴 직전 선례)·ADR-0645(SECTOR_RS default-ON flip)·ADR-0644(safe-lever 3종 default-ON flip — opt-OUT 패턴 원형)·ADR-0641(flag-lifecycle governance — 본 ADR 이 status SHADOW_OFF→ON flip)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0157(ENV 정확 비교 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`)·ADR-0146(byte-equivalent·ENV 1줄 롤백)·ADR-0530(Patch Scope Guard).

---

## Context

ADR-0648 이 눌림목 진입 레인(레인 B: 20일 고점 직하 되돌림 + MA20 추세 유지 + 거래량 마름)·과열 가드(레인 C `price/high5d > 1.06` 추격 거부)·RRR-우선(눌림목 후보 `effectiveMinRrr = max(1.8, 2.0)`)을 `GATE_PULLBACK_ENTRY_LANE_ENABLED` default OFF 로 도입했다. 배선 ADR 의 결론은 "entry-selection behavior change 라 forward-return shadow 검증 후 운영자 flip" 이었다.

운영자(silverlh614)가 직후 **"default on 해줘"** 로 명시 승인했다. 이는 ADR-0644(safe-lever)·0645(SECTOR_RS)·0647(VOLUME_LIQUIDITY)에서 운영자가 동일하게 default-OFF 누적 안티패턴을 끊어 온 결정 흐름과 일치한다.

### 안전성 근거 (절대)

- **현 `engineMode = SHADOW_ONLY`** → `liveEntryAllowed = false`. flag ON 이어도 **live 주문 0** (9대 불변식 #8: 실거래 차단 ≠ Shadow 차단). 따라서 flip 은 live 주문 분포를 즉시 바꾸지 않는다.
- ON 의 효과는 **실 레인 점화로 shadow/paper forward-return 을 수집**하는 것 — hypothetical stamp 보다 강한 실측 증거를 SHADOW_ONLY 안전창에서 축적한다. engineMode live 승격 전 운영자가 이 증거로 재확인한다.
- explicit `=false` kill-switch 1줄 → 단일 강/약 돌파 레인 **byte-identical** 즉시 복귀.

---

## Decision

1. **flag flip** — `isPullbackEntryLaneEnabled()` (`server/trading/gateConfig.ts`) ENV 비교 `=== 'true'`(default OFF) → `!== 'false'`(default ON·미설정/임의값 = 활성·정확히 `'false'` 만 kill-switch OFF, ADR-0157 opt-IN 거울). 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용.
2. **본체 무접촉** — `breakoutMomentumEvaluator` 레인 B/과열 가드 임계·`rrrGate` `effectiveMinRrr`·shadow stamp 로직 **0줄 변경**. flip 은 default 해석만 바꾼다.
3. **flag-lifecycle status SHADOW_OFF → ON** (`scripts/gate_flag_lifecycle.json`, ADR-0641 거버넌스 flip). reviewBy 유지.
4. **테스트** — 기존 "flag OFF = byte-identical" 단언은 explicit `=false` setEnv 로 의도 보존(단언 약화 0). default-ON 케이스(미설정 = 눌림목 활성) 신규 추가.

### 채택 안 함 (명시 기각)

- requiredScore 70 완화·ADR-0471 weighted curve 변경·과열 가드/눌림목 임계 변경 — 전부 무접촉.
- 하드코딩 ON(kill-switch 상실) 기각 — `!== 'false'` 로 `=false` 롤백 보존.
- ENV 수동설정 유지 기각 — 운영자 명시 flip 요청, default-OFF 무덤 안티패턴 미해소.

---

## Consequences

- **default(미설정):** 눌림목 레인 + 과열 가드 + 눌림목 RRR≥2.0 활성. 현 SHADOW_ONLY 라 live 주문 0 — shadow/paper entry-selection 에 반영되어 실 forward-return 수집.
- **`=false`:** 단일 강/약 돌파 레인 byte-identical 복귀(레인 B·과열 가드·RRR 하한 미적용). ENV 1줄 즉시 롤백.
- **requiredScore 70·ADR-0471 FREEZE 무접촉:** 본 변경은 진입 레인/Gate2/Gate3 영역이지 Gate1 곡선 아님. `check_gate1_required_score_ssot.js` 무위반.
- **9대 불변식:** #1(evaluator 정지 0·shadow try/catch)·#6(눌림목 FIRED 는 marketSignal=false·Gate2 비누수)·#8(`=false`=byte-identical·현 SHADOW_ONLY live 0) 보존.
- **executionImpact:** `=false`=NONE / default ON=entry-selection-adjacent(현 SHADOW_ONLY live 0줄·autoTradeEngine/kisClient/order/SourceSnapshot 0줄).

---

## Patch Scope Guard (ADR-530)

- **targetDomain:** gate-entry-lane (1)
- **allowedFiles:** `server/trading/gateConfig.ts`(isPullbackEntryLaneEnabled 1줄 + 주석) · `server/quant/conditions/evaluatorsAdr0390.test.ts`(default-ON 케이스 + OFF 는 `=false` pin) · `server/quantFilterPullbackLaneAdr0648.test.ts`(동) · `.env.example`(flag 주석) · `scripts/gate_flag_lifecycle.json`(status SHADOW_OFF→ON) · `ARCHITECTURE.md`(boundary 노트) · `docs/adr/0649-*.md`(신규) · `docs/adr/INDEX.md` · `docs/ai/10-patch-history-index.md`.
- **forbiddenFiles:** autoTradeEngine · buyPipeline · kisClient · SourceSnapshot 생성기 · breakoutMomentumEvaluator 레인 임계 본문 · rrrGate `effectiveMinRrr` 산식 · Gate1 weightedScore 곡선/componentScorers · requiredScore=70 SSOT · `src/**`.
- **rollbackPlan:** `GATE_PULLBACK_ENTRY_LANE_ENABLED=false` 1줄 → byte-identical 단일 레인 복귀.

계보 0648/0647/0645/0644/0641/0471/0157/0146/0530. INDEX 0649 등재(다음 0649→0650 갱신).
