# ADR-0648 — Pullback Entry Lane + Overheat Guard + RRR-First (Balanced preset)

- Status: **Proposed (Phase 0 — architect)** — 경계·flag 계약·Gate2/Gate3 정합 설계·shadow 필드·HANDOFF.
  코드 구현(evaluators.ts 멀티 레인·Gate2 카운트·shadow stamp·테스트)은 **engine-dev 인계**.
- Date: 2026-06-22
- Branch: `claude/scan-blockers-diagnostic-wp93a3`
- Operator approval: silverlh614 — "breakout 이 가격을 너무 위에서 잡는다(꼭대기 추격)" 지적,
  **눌림목(Pullback) 진입 레인 + 과열 가드 + RRR-우선** 을 **Balanced 프리셋**으로 승인.
- 계보: 0390(breakout_momentum status)·0387(DATA_UNAVAILABLE)·0471(Gate1 weighted curve FREEZE)·
  0476(관측 ledger hypothetical stamp)·0157(`=== 'true'` 정확비교)·0146(OFF 출하 byte-identical)·
  0530(Patch Scope Guard)·0641(flag-lifecycle 거버넌스)·0030(RRR gate)·0467(requiredScore=70 SSOT).

---

## Context

현행 `breakoutMomentumEvaluator` (`server/quant/conditions/evaluators.ts:380-425`) 는 **단일 레인**이다:
`price/high5d ≥ 0.99~1.01` + `volume/avgVolume ≥ 1.2~1.5` 일 때만 `FIRED`. 즉 **신고가 돌파 캔들에서만**
진입을 인정한다. 이 단일 레인은 구조적으로 두 가지 부작용을 만든다:

1. **꼭대기 추격** — 진입점이 5일 고점 위(또는 바로 아래)라 손절 거리(entry − stopLoss)가 멀어진다.
   스캔 실측: `rrr=0.35 FAIL`, `price=OVEREXTENDED`. RRR-우선 진입 철학과 정면 충돌.
2. **레인 협소** — 돌파 캔들 한 순간만 잡으므로, "20일 신고가 직하 되돌림에서 추세를 유지한 채 거래량이
   마른" 건전한 눌림목 후보를 통째로 놓친다. Gate2 leadership 은 `breakoutMomentumFailCount === 0`
   (`gate2LeadershipAttribution.ts:934`) 이어야 `CONFIRMED` 라, 이 협소함이 Gate2 `NOT_CONFIRMED`
   기아(starvation)에 직접 기여한다.

운영자는 "추격 대신 되돌림에서 선점" 을 **Balanced 프리셋 확정 숫자**로 승인했다. 본 ADR 은 그 경계·임계·
flag 계약·Gate2/Gate3 정합·shadow-first 관측 계약을 확정한다. (입력은 전부 `YahooQuoteExtended` 에 이미
존재 — `high20d`·`ma20`·`volume`·`avgVolume`·`high5d`·`price` 확인 완료. **신규 fetch 0**.)

---

## Decision

### D0 — Flag (default OFF, byte-identical)

신규 ENV `GATE_PULLBACK_ENTRY_LANE_ENABLED`:

```
isPullbackEntryLaneEnabled():  process.env.GATE_PULLBACK_ENTRY_LANE_ENABLED === 'true'   // ADR-0157 default OFF
```

- **OFF (미설정/임의값)** = byte-identical — `breakoutMomentumEvaluator` 는 현행 단일 레인(강/약 돌파)
  그대로. 눌림목 레인·과열 가드·RRR 하한 미적용. 기존 점수·status·detail 무변경.
- **ON (`=== 'true'`)** = 멀티 레인 활성. SSOT 함수 거주지: `server/trading/gateConfig.ts`
  (기존 `isGate1*Enabled` 동거 — engine-dev 가 함수 추가).
- ADR-0644 의 default-ON flip 대상 **아님** — 진입 종목 선택(entry-selection)을 바꾸는 behavior
  change 라, forward-return shadow 검증 후 운영자 승인을 거쳐야 flip(D5 거버넌스).

### D1 — 눌림목 레인 (신규, Balanced 확정 숫자)

`breakoutMomentumEvaluator.evaluate` 안에 **레인 B(눌림목)** 추가. 기존 강/약 돌파(레인 C)는 보존.
다음 **전부 충족** 시 `FIRED`:

| 조건 | 임계 | 의미 |
|------|------|------|
| 20일 고점 되돌림 (구조 내) | `0.92 ≤ price/high20d ≤ 0.99` | 신고가 아래로 되돌렸으나 구조 이탈 아님 |
| 추세 유지 | `aboveMA20 = (price ≥ ma20) = true` | 추세 붕괴 종목 배제 |
| 건전한 눌림(거래량 마름) | `0.5 ≤ volume/avgVolume ≤ 0.9` | 눌림 시 거래량이 마른 것 = 건전(터지는 게 아님) |

- 입력: `quote.high20d`·`quote.ma20`·`quote.volume`·`quote.avgVolume`(이미 존재, 신규 fetch 0).
- 데이터 가드: `high20d > 0 && ma20 > 0 && avgVolume > 0 && Number.isFinite(volume)` 미충족 시
  눌림목 레인은 **평가 생략**(DATA_UNAVAILABLE 로 강제 전환하지 않음 — 기존 레인 C 가드와 독립).
- 점수: 눌림목 레인 FIRED 시 `score = weightFor(weights, 'breakout_momentum') * 0.6`
  (약돌파와 동일 계수 — 추격이 아닌 선점이므로 만점 부여하지 않음. 만점은 레인 C 강돌파 전용).
- detail: `눌림목 진입 (high20d -X.X% / MA20 above / vol Y.Y배 dry)` 형식. status `FIRED`.

### D2 — 과열 가드 (꼭대기 추격 차단)

기존 확정 돌파 레인(C) 안에서 `price/high5d > 1.06` 이면 **FIRED 거부**.

- status `THRESHOLD_NOT_MET`, detail 에 `OVEREXTENDED` 표기(예: `OVEREXTENDED 5일고점 +X.X% > +6.0% 추격거부`).
- score 0. 즉 5일 고점 대비 +6% 초과 추격 진입을 차단 → 손절 거리 폭주·RRR 붕괴 사전 차단.
- 가드는 **레인 C(돌파)에만** 적용. 레인 B(눌림목)는 정의상 `price/high20d ≤ 0.99` 라 과열 불가 — 중복 가드 불필요.

### D3 — RRR-우선 (눌림목 레인 진입 후보 RRR ≥ 2.0)

눌림목 레인(B)으로 FIRED 된 후보는 **Gate3 RRR ≥ 2.0 충족 필수**. 기존 진입 RRR 임계(`RRR_MIN_THRESHOLD`
= `1.8` default, `server/trading/riskManager.ts:5`) 보다 **엄격**하다.

- **정합 위치**: RRR 계산·임계 판정은 Gate3/진입 게이트의 단일 통로(`calcRRR` + `RRR_MIN_THRESHOLD`,
  `server/trading/signalScanner/entryGates/rrrGate.ts`)를 **재사용**한다 — 두 번째 RRR 공식 신설 금지.
- 눌림목 레인 후보에는 추가 하한 `PULLBACK_LANE_MIN_RRR = 2.0` 을 **레인 태그가 있을 때만** 적용
  (engine-dev: 후보에 `entryLane: 'PULLBACK'` 메타를 stamp → rrrGate 또는 Gate3 RRR 판정에서
  `effectiveMinRrr = entryLane==='PULLBACK' ? max(RRR_MIN_THRESHOLD, 2.0) : RRR_MIN_THRESHOLD`).
- **flag OFF 시 적용 없음** — 눌림목 레인 자체가 비활성이므로 RRR 하한 강화도 비활성(byte-identical).
- RRR 미달 시 기존 RRR_FAIL 경로 그대로(신규 blocker reason 불필요 — `RRR_FAIL` 재사용).

### D4 — Gate2 leadership 정합 (눌림목도 "돌파 후보" 인정)

`gate2LeadershipAttribution.ts:867-869` 의 `breakoutMomentumFailCount` 는
`conditionKey === 'breakout_momentum'` 인 항목의 `failed + wait` 를 합산하고,
`breakoutConfirmed = (breakoutMomentumFailCount === 0)` (`:934`) 이다.

**결정**: 눌림목 레인은 **별도 evaluator 가 아니라 기존 `breakout_momentum` evaluator 의 추가 레인**으로
구현한다(D1). 따라서 눌림목 레인 `FIRED` 는 자동으로 `breakout_momentum` status `FIRED`(failed/wait 아님)
가 되어, **Gate2 `breakoutMomentumFailCount` 에 누수되지 않고** `breakoutConfirmed` 를 완화한다
(NOT_CONFIRMED → CONFIRMED 기여). 별도 카운트 키 신설·Gate2 카운트 로직 변경 **불필요**.

- **불변 유지**: Gate2 leadership 의 `final.executionImpact: 'NONE'`·`marketSignal=false`(`:588`)·
  **hardBlock 아님**(diagnosticOnly) 무변경. 눌림목 FIRED 는 "돌파 후보 인정"일 뿐 **강제 통과(hardBlock)
  아니다** — 나머지 Gate2 축(sector/fundamental/RS/volume)·Gate3(RRR/timing)는 그대로 평가된다.
- providerIssue ≠ bearish 불변식 무접촉(본 변경은 가격/거래량 구조 평가지 provider 신호 변환 아님).

### D5 — Shadow-first 관측 계약 (force-ON hypothetical)

flag **OFF 에서도** 눌림목 레인 후보를 **force-ON hypothetical** 로 stamp 한다(ADR-0476 ledger 패턴 정합).
목적: 추격 레인(C) 대비 눌림목 레인(B) 의 **forward 1D/3D/5D return 우월성**을 flip 결정 전에 데이터로 검증.

stamp 필드(scan_blockers / 관측 ledger 행 — 진단 전용, 매매 무관):

| 필드 | 의미 |
|------|------|
| `pullbackLaneHypotheticalFired` | force-ON 가정 시 눌림목 레인이 FIRED 였는지(boolean) |
| `pullbackLanePosVsHigh20d` | `price/high20d` 실측값 |
| `pullbackLaneVolRatio` | `volume/avgVolume` 실측값 |
| `pullbackLaneAboveMa20` | `price ≥ ma20`(boolean) |
| `breakoutChaseLaneFired` | 기존 추격(레인 C) 레인 FIRED 였는지(대조군) |
| `overheatGuardTriggered` | 과열 가드(`price/high5d > 1.06`)로 거부됐는지 |
| `pullbackLaneForwardReturn1d/3d/5d` | forward-return cron 이 사후 채움(추격 대비 대조용) |

- **불변식 #1 격리**: 모든 stamp 는 `try/catch` 로 감싸 실패해도 Trading Engine 스캔을 막지 않는다
  (Shadow Learning #2 도 무정지). force-ON hypothetical 은 **실제 entry-selection 을 바꾸지 않는다**
  (flag OFF live 경로는 byte-identical) — 관측 ledger 행에만 기록.
- scan_blockers 노출: 진단 명령(`/scan_blockers`)에 위 필드 요약 1줄 추가(engine-dev). marketSignal=false 유지.

### D6 — 불변 보존 (FREEZE)

- **requiredScore=70 리터럴 불변**(ADR-0467 SSOT) — 본 변경은 진입 레인·Gate2 카운트·Gate3 RRR 이지
  Gate1 점수 곡선 아님.
- **ADR-0471 Gate1 weighted curve FREEZE** — `weightedFromNormalized`·component maxScore·weight 무변경.
  flag OFF byte-identical(명시).
- **9대 불변식 무위반** — Engine 무정지(#1)·Shadow 무정지(#2)·SourceSnapshot 우회 0(#3,#9: 신규 fetch
  0, quoteFeatures 기존 입력만)·providerIssue ≠ bearish(#4,#6)·AI_ESTIMATED live 사용 0(#7)·
  실거래 차단 ≠ Shadow 차단(#8: 현 engineMode=SHADOW_ONLY 라 live 주문 0).
- **KIS primary**(ADR-0561) — 신규 fetch 0, 기존 quoteFeatures 입력 재사용 → provider 경로 무접촉.
- **클라이언트 실주문 0** — 본 변경은 서버 스캐너/조건 평가 경계, autoTradeEngine/kisClient/order 무접촉.

---

## Consequences

- **flag OFF (default)**: byte-identical. executionImpact **NONE**. KIS/KRX quota 0 침범. 기존 회귀 테스트
  무변경(추가 케이스만). 출하 안전(ADR-0146).
- **flag ON**: entry-selection 변경 — "20일 고점 직하 되돌림에서 추세 유지 + 거래량 마른" 후보를 추가로
  진입 인정하고, 5일 고점 +6% 초과 추격은 거부하며, 눌림목 후보는 RRR ≥ 2.0 을 강제한다.
  단 **현 engineMode=SHADOW_ONLY 라 live 주문 0** — 실제 영향은 shadow 후보 분포·Gate2 CONFIRMED 율·
  Gate3 RRR 통과율에 국한. forward-return shadow 로 추격 대비 우월성 검증 후 flip(D5 → D0 ON).
- **shadow-first**: flag OFF 에서도 force-ON hypothetical 이 상시 stamp → flip 결정의 데이터 근거 확보.
  "OFF 출하 → 검증 → flip" 패턴(ADR-0146/0641)을 정확히 따른다(플래그 무덤 회피: D0 가 flag-lifecycle
  레지스트리에 reviewBy 90일·activationCriteria 명시 등재).
- **Gate2 기아 완화**: 눌림목 FIRED 가 `breakout_momentum` FIRED 로 카운트되어 `breakoutMomentumFailCount`
  를 줄이고 NOT_CONFIRMED 를 완화(단 hardBlock 아님 — 다른 축은 그대로).

---

## Alternatives Considered

1. **신규 evaluator 분리(`pullback_entry` 키 신설)** — 기각. Gate2 의 `breakoutMomentumFailCount` 는
   `breakout_momentum` 키만 카운트하므로, 별도 키면 Gate2 정합을 위해 카운트 집합·confirm 로직을
   추가 수정해야 한다(D4 단순성 상실). 기존 `breakout_momentum` 레인 확장이 Gate2 정합 0줄.
2. **눌림목 레인 만점 부여(`score = w`)** — 기각. 눌림목은 선점이지 확정 돌파가 아니므로, 강돌파(레인 C)와
   동일 만점은 신호 강도 과대평가. 약돌파 계수(`w*0.6`)로 차등.
3. **과열 가드를 모든 레인에 적용** — 기각. 레인 B(눌림목)는 정의상 `price/high20d ≤ 0.99` 라 과열 불가.
   레인 C 전용으로 충분(중복 가드 제거).
4. **눌림목 RRR 하한을 `RRR_MIN_THRESHOLD` 그대로(1.8)** — 기각. 운영자 Balanced 확정이 RRR ≥ 2.0.
   눌림목은 손절 거리가 짧아 RRR 확보가 쉬우므로 더 엄격한 하한이 비용 낮고 "RRR-우선" 철학에 부합.
5. **default-ON flip(ADR-0644 식)** — 기각. entry-selection behavior change 라 forward-return 검증
   없이 켜면 #8 미검증 분포 변경. shadow-first 후 운영자 승인 flip(D5).
6. **별도 RRR 공식 신설** — 기각. `calcRRR` + `RRR_MIN_THRESHOLD` 단일 통로 재사용(두 번째 공식 금지).

---

## Patch Scope Guard (ADR-530)

- **targetDomain**: gate-entry-lane (1) — breakout_momentum 조건 멀티 레인 + Gate2 카운트 정합(자동) +
  Gate3 RRR 하한 정합 + shadow ledger.
- **allowedFiles**:
  - `server/quant/conditions/evaluators.ts` — `breakoutMomentumEvaluator` 레인 B + 과열 가드(flag-gated)
  - `server/trading/gateConfig.ts` — `isPullbackEntryLaneEnabled()` SSOT 함수 추가
  - `server/trading/signalScanner/entryGates/rrrGate.ts` 또는 Gate3 RRR 판정 — 눌림목 레인 `effectiveMinRrr` 정합
  - shadow ledger stamp 모듈(ADR-0476 ledger 행 빌더) + `/scan_blockers` 노출 1줄
  - `scripts/gate_flag_lifecycle.json` — 신규 flag SHADOW_OFF 등재
  - `*.test.ts`(evaluators·gateConfig·rrr·shadow stamp 회귀) · `.env.example` 1줄
  - 본 ADR · `docs/adr/INDEX.md`(0648→0649) · `docs/ai/10-patch-history-index.md` 1줄 · `ARCHITECTURE.md` 1줄
- **forbiddenFiles**: autoTradeEngine · buyPipeline · kisClient · SourceSnapshot 생성기 ·
  Gate1 weightedScore 곡선/componentScorers · requiredScore=70 calibration SSOT(minimumSignalScoreTrace
  판정 라인) · `isGate1PositiveMaxNormalizationEnabled`(ADR-0643 봉인) · `src/**`(클라).
- **expectedBehaviorChange**: flag OFF NONE(byte-identical) / flag ON entry-selection(눌림목 인정 +
  과열 거부 + 눌림목 RRR≥2.0).
- **sourceSnapshotImpact**: NONE(신규 fetch 0, 기존 quoteFeatures 입력만 — #3/#9 무접촉).
- **executionImpact**: flag OFF NONE / flag ON entry-selection(현 SHADOW_ONLY 라 live 주문 0).
- **shadowLearningImpact**: force-ON hypothetical stamp 추가(관측 전용·#2 무정지·try/catch 격리).
- **telegramImpact**: `/scan_blockers` 진단 1줄 추가(marketSignal=false).
- **providerImpact**: NONE(provider 경로 무접촉·KIS/KRX quota 0).
- **testsRequired**: OFF byte-identical(레인 C 강/약 돌파 무변경) · ON 레인 B FIRED(임계 경계값) ·
  과열 가드 거부(`high5d>1.06`) · 눌림목 RRR≥2.0 정합 · Gate2 breakoutMomentumFailCount 눌림목 FIRED
  비누수 · shadow stamp try/catch 격리 · flag-lifecycle validate.
- **rollbackPlan**: `GATE_PULLBACK_ENTRY_LANE_ENABLED` 미설정(default OFF)이면 byte-identical — flip
  후 회귀 시 ENV 제거(또는 `=false` 이외 값)만으로 즉시 롤백. 1줄.

---

## References

- 현행 단일 레인: `server/quant/conditions/evaluators.ts:380-425`
- Gate2 breakout confirm: `server/trading/signalScanner/gate2LeadershipAttribution.ts:867-869,934,941,1000`
- Gate3 RRR 단일 통로: `server/trading/riskManager.ts:5,8` · `server/trading/signalScanner/entryGates/rrrGate.ts`
- quote 입력(신규 fetch 0): `server/screener/adapters/yahooQuoteAdapter.ts:43-50`(volume/avgVolume/ma20/high5d/high20d)
- flag SSOT 거주지: `server/trading/gateConfig.ts`
- flag-lifecycle 거버넌스: ADR-0641 · `scripts/gate_flag_lifecycle.json` · `scripts/check_flag_lifecycle.js`
- shadow ledger 패턴: ADR-0476
- HANDOFF: `_workspace/2026-06-22_gate1-starvation-realfix/architect/HANDOFF_0648.md`
