# ADR-0606: Runner Mode — Trend-Following Exit (Tranche-Skip + Wide Trailing) and Slot Exemption (Shadow-Gated, default OFF)

@responsibility policy — 큰 수익(추세) 종목을 분할익절 잔량 전량 트랜치 없이 넓은 트레일링으로 추세 끝까지 추종시키고 보유 슬롯 카운트에서 제외하는 러너 모드 (shadow-gated, default OFF byte-equivalent)

## Status

Proposed

> Phase 0 (경계·타입·ADR) 산출물. 런타임 wiring 은 engine-dev 인계(§Implementation Handoff).
> 단일 개념: **러너 = 트레일링 활성 종목 = 슬롯 카운트 제외**. 사용자 확정 2결정의 통합.

## Context

### 사용자 결정 (확정 — 변경 금지)

1. **러너 모드** — 큰 수익 종목은 분할익절 비중을 줄이고 넓은 트레일링으로 추세를 끝까지 추종.
2. **트레일링 추적 중(=러너) 종목은 보유 슬롯 카운트에서 제외 + 별도 관리.**

두 결정은 "러너 = 트레일링 활성 종목 = 슬롯 제외"라는 단일 개념으로 묶는다.

### 문제 — 트레일링의 늦은 활성화 + R4/R5 트레일링 부재 → 큰 러너의 구조적 손실

현재 익절 구조(`server/trading/exitEngine/index.ts` `EXIT_RULES_IN_ORDER` L3-a/b/c):

- **분할익절 SSOT** `src/services/quant/sell/partialProfit.ts` `PROFIT_TARGETS`:
  - R1_TURBO/R2_BULL/R3_EARLY: LIMIT 2개 + 마지막 **TRAILING 40%** (trigger:null, trailPct 0.07~0.10).
  - **R4_NEUTRAL/R5_CAUTION: 트레일링 트랜치 없이 전량 LIMIT** (+18%/+10% 에서 잔량 전량 청산).
  - R6_DEFENSE: 익절 없음.
- **트레일링 활성화 시점** `rules/trancheTakeProfitLimit.ts:82` — *모든 LIMIT 트랜치 소화 후에만*
  `shadow.trailingEnabled=true`. 그 전까지 트레일링 스톱(`rules/trailingStop.ts`)은 NO_OP.
- **트레일링 폭** `rules/trailingStop.ts:24` — `trailFloor = HWM × (1 - (trailPct ?? 0.10))`,
  진입 시 `buyListLoop.ts:725` 에서 `[0.05, 0.14]` 로 클램프된 고정값.

결과적 구조적 손실 두 갈래:

1. **R4/R5 종목은 트레일링 트랜치 자체가 없다.** +18%(R4)/+10%(R5) LIMIT 도달 후 잔량까지 전량
   청산되어 *추세가 막 시작된* 종목도 강제 종료된다. 큰 러너로 자랄 자리에서 잘린다.
2. **R1~R3 종목도 트레일링은 마지막 LIMIT 트랜치 소화 후에만 켜진다.** 그 사이 급등하면 좁은
   고정 trailPct(≤0.14)로 추세 초기 변동성에 조기 청산되기 쉽다. 넓은 추종 폭이 없다.

동시에, 큰 러너가 슬롯 1칸을 끝까지 점유하면 신규 진입 기회를 막는다. ADR-0080 자본 가중
슬롯 회계(`slotAccounting.ts`)는 잔존 비율로 점유를 줄여주지만, *전량 보유 중인 러너*는 여전히
1칸을 온전히 차지한다 — 추세 추종(의도된 장기 보유)과 슬롯 회전이 충돌한다.

### 데이터 흐름 (수정 진입점 확정 — 신규 fetch 0)

- **승격·트랜치 스킵 진입점:** `rules/trancheTakeProfitLimit.ts` — 이미 "모든 LIMIT 트랜치 소화"
  를 감지해 `trailingEnabled=true` 로 전이하는 지점. 여기에 러너 승격 분기를 ENV 게이트로 추가.
- **트레일링 폭 진입점:** `rules/trailingStop.ts:24` `trailFloor` 산식 — `shadow.runnerTrailPct`
  우선 적용(`shadow.runnerTrailPct ?? shadow.trailPct ?? 0.10`). 1줄 변경.
- **슬롯 제외 단일 진입점:** `slotAccounting.ts` `computeSlotConsumption` 의 `eligible` 필터 —
  ENV 게이트 ON 시 `isRunner === true` 를 제외. 3개 소비처(`loopInitializer.ts`/`preflight.ts`/
  `slotSizing.ts`)가 모두 이 한 함수의 `consumed`/`rawCount`/`isFull` 만 읽으므로, **단일 SSOT
  한 곳 수정으로 전 경로에 자연 전파**된다 (소비처 배선 0). 별도 `runnerCount` 는 additive 진단 필드.
- **판정 SSOT:** `server/trading/exit/policies/runnerPolicy.ts` (본 ADR 신규, 순수 함수) —
  provider/store/now 호출 0. ENV 게이트(process.env) 소비라 서버 전용 — 기존 서버 exit 정책
  디렉토리(`shadowPaperExitSessionPolicy`/`r6ShadowHoldPolicy`)와 동거.
  `server/trading/regime/riskOnFastUpgrade.ts` 분리 선례(순수 판정 + ENV 헬퍼).

## Decision

### ① 러너 승격 조건 (`evaluateRunnerPromotion`)

`RUNNER_MODE_ENABLED === 'true'` 일 때만 평가. 두 조건의 **OR**:

- **(a) FINAL_TRANCHE_REACHED** — 모든 LIMIT 트랜치 소화(= 기존 `trailingEnabled` 전이 시점).
  가격 비의존이므로 returnPct 결손이라도 발동(기존 의미 보존).
- **(b) RETURN_THRESHOLD** — `returnPct >= RUNNER_PROMOTE_RETURN_PCT`(가드 [10,40], 기본 18).
  마지막 LIMIT 트랜치 미도달이라도 추세 강도가 크면 승격(R4/R5 전량 청산 전 선점).

returnPct 결손/비유한 → (b) 미발동(불변식 #6: 결손≠signal). flag OFF → 항상 미승격.

### ② 승격 후 익절·트레일링 동작

- **잔량 전량 트랜치 스킵** — `shouldSkipTrancheForRunner(ratio)`: 잔량 전량(ratio ≥ 0.999, 즉
  마지막 전량 트레일링/LIMIT 트랜치)만 *taken 처리 없이 건너뛴다*. **초기 소량 LIMIT 트랜치
  (ratio < 1.0)는 유지** — 러너도 초기 일부 익절은 실현한다(리스크 회수). 남은 전량을 시장에 노출.
- **넓은 트레일링** — `resolveRunnerTrailPct(entryTrailPct)`:
  `clamp( max(entryTrailPct + RUNNER_TRAIL_PCT_BONUS, RUNNER_TRAIL_PCT_FLOOR), entry, 0.30 )`.
  기본 bonus 0.05 / floor 0.15 → 진입 0.10 → 러너 0.15. **항상 진입 trailPct 이상**(넓어지기만
  함, 타이트화 금지). 승격 시 `trailingEnabled=true` + `runnerTrailPct` stamp → `trailingStop`
  이 다음 tick 부터 넓은 폭으로 추종.
- **고점 갱신** — `rules/trailingPeakUpdate.ts` 무변경. 러너도 동일 HWM 갱신(`trailingEnabled`
  게이트 공유).

### ③ 슬롯 제외 규칙

- `RUNNER_SLOT_EXEMPTION_ENABLED === 'true'` 일 때만, `computeSlotConsumption` 의 `eligible`
  필터에서 `isRunner === true` shadow 를 제외. → `consumed`/`rawCount`/`isFull` 에서 러너 빠짐
  → `loopInitializer`/`preflight`/`slotSizing` 가 자동으로 러너 슬롯을 신규 진입 가용으로 인식.
- **별도 러너 카운트** — `SlotConsumptionResult` 에 `runnerCount`(additive) 추가. 진단/텔레그램
  표기 전용. MAX_POSITIONS·regime maxPositions 분모는 무변경(러너만 분자에서 빠짐).
- `src/services/autoTrading/tradeSafety.ts` `checkTradeSafety` 는 `currentPositionCount` 를
  *받는* 쪽 — 내부 무변경. 호출자가 러너 제외 카운트를 넘기도록 정합(서버 슬롯 SSOT 일치).

### ④ ENV 게이트

| ENV | 기본 | 가드 | 역할 |
|-----|------|------|------|
| `RUNNER_MODE_ENABLED` | OFF (`=== 'true'`) | — | 승격 판정·트랜치 스킵·넓은 트레일링 |
| `RUNNER_SLOT_EXEMPTION_ENABLED` | OFF (`=== 'true'`) | — | 슬롯 회계에서 러너 제외 |
| `RUNNER_PROMOTE_RETURN_PCT` | 18 | [10,40] | (b) 승격 수익률 임계(%) |
| `RUNNER_TRAIL_PCT_BONUS` | 0.05 | [0,0.15] | 러너 트레일링 가산폭 |
| `RUNNER_TRAIL_PCT_FLOOR` | 0.15 | [0.10,0.30] | 러너 트레일링 최소폭(바닥) |

두 게이트는 **독립**(각 1줄 롤백). 승격(게이트 1)만 켜고 슬롯 제외(게이트 2)는 끈 채 관측 가능.

### ⑤ SHADOW 전용 · LIVE 본체 0줄 · byte-equivalent(OFF 시)

- 러너 로직은 전부 exitEngine SHADOW 평가 경로 + 슬롯 회계 SSOT 안에서만. LIVE 주문 경로
  (`autoTradeEngine`/`placeKisMarketBuyOrder`/`fillMonitor`) 0줄 변경.
- 신규 타입 필드는 옵셔널 additive — 기존 영속 round-trip 무파괴(JSON 직렬화로 충분).
- 두 ENV 모두 OFF(기본) → `evaluateRunnerPromotion`/`shouldSkipTrancheForRunner` 항상 false,
  `computeSlotConsumption` eligible 필터 무변경, `trailFloor` 산식 `runnerTrailPct` 부재로 기존
  `trailPct` 경로 → **런타임 byte-equivalent**.

### 파라미터 기본값 (제안 — 운영자 counterfactual 튜닝 대상)

- 러너 승격 = 마지막 LIMIT 트랜치 도달 **OR** returnPct ≥ +18%.
- 러너 trailPct = `max(진입 trailPct + 0.05, 0.15)` (상한 0.30).
- 스킵 대상 = 잔량 전량(ratio=100%) 트랜치만. 초기 소량 LIMIT 트랜치 유지.

## Consequences

### 9대 불변식 보존 근거

- **#1 Trading Engine liveness** — 러너 판정·승격·트랜치 스킵은 exitEngine SHADOW 평가 경로.
  기존 try/catch 격리 패턴(`emitShadowPositionMonitor`/attribution) 상속 — 러너 평가 실패가
  LIVE 매매엔진/다른 청산 규칙 평가를 차단하지 않는다. 슬롯 회계 변경은 순수 필터(throw 0).
- **#2 Shadow Learning liveness** — 러너는 학습 라벨(`runnerPromotionReason`) 추가일 뿐,
  Shadow 판단·counterfactual·attribution 경로를 멈추지 않는다.
- **#6 providerIssue ≠ marketSignal** — 러너 승격은 가격/수익률 기반. provider 결손 →
  returnPct 결손 → 미승격(보수). 결손을 bullish/bearish 어느 쪽으로도 변환하지 않는다.
- **#7 AI_ESTIMATED(L4) 금지** — 러너 판정 입력은 KIS L1 `currentPrice`/`returnPct` 뿐.
  AI 추정·L4 데이터 미사용.
- **#8 실거래 차단 ↔ Shadow 판단 차단 분리** — 러너는 SHADOW 장부 안에서만 존재. 슬롯 제외도
  SHADOW 슬롯 회계 한정. LIVE 주문 본체 byte-equivalent — 실거래 경로 무접촉.
- **#3/#4/#5/#9** — SourceSnapshot 무변경(러너는 SourceSnapshot 을 바꾸지 않음). Gate 내부
  provider 직접 조회 0(러너 판정은 exitEngine 입력 currentPrice 재사용).

### executionImpact 분류

- **두 ENV OFF (기본):** `executionImpact: NONE` — 런타임 byte-equivalent.
- **`RUNNER_MODE_ENABLED` ON:** `executionImpact: execution-adjacent (SHADOW only)` — SHADOW
  청산 타이밍/잔량/트레일링 폭 변경. LIVE 미접촉. 운영자 SHADOW N영업일 관측 권고.
- **`RUNNER_SLOT_EXEMPTION_ENABLED` ON:** `executionImpact: execution-adjacent (SHADOW slot
  accounting)` — 러너 제외로 SHADOW 신규 진입 슬롯 가용성 변경. LIVE 슬롯 회계는 동일 SSOT 를
  공유하므로, LIVE 활성화 전 SHADOW 표본으로 슬롯 회전 영향 검증 필수.

### Risks / 한계

- **트랜치 스킵의 비가역성** — 승격 후 잔량 전량 트랜치를 스킵하면, 추세가 꺾일 때 LIMIT 익절이
  아닌 트레일링 스톱(넓은 폭)으로만 청산된다. 넓은 trailPct 만큼 고점 대비 더 큰 되돌림을 감수.
  → 완화: 초기 소량 LIMIT 트랜치 유지(리스크 일부 회수) + floor/cap 가드 + SHADOW 검증.
- **슬롯 제외의 과다 진입 위험** — 러너가 많아지면 슬롯 회계상 빈자리가 늘어 신규 진입이 증가,
  총노출이 의도보다 커질 수 있다. → 완화: regime maxPositions·gross exposure cap 은 무변경,
  `runnerCount` 별도 관측, 게이트 2 독립 활성화로 단계적 검증.
- **승격 임계 튜닝 미정** — RETURN_THRESHOLD 18% 는 제안값. counterfactual(러너 vs 미적용 가정)
  분포로 운영자 확정. buy-the-top 경계와 무관(이미 보유 종목의 익절 정책이라 진입 추격 아님).

## Alternatives Considered

1. **PROFIT_TARGETS(R4/R5)에 트레일링 트랜치 직접 추가** — 분할익절 SSOT 를 레짐별로 바꾸면 모든
   R4/R5 종목에 일률 적용되어 "큰 수익 종목만 추종" 의도를 못 살리고, 전 종목 익절 정책 변경의
   blast radius 가 크다. 러너는 *동적 승격*(returnPct/트랜치 도달)이어야 한다. → 기각.
2. **새 청산 규칙(EXIT_RULES_IN_ORDER 18번째) 추가** — 우선순위 테이블/entryEngine
   `EXIT_RULE_PRIORITY_TABLE` 동기화 비용 + 기존 trancheTakeProfitLimit/trailingStop 과 책임
   중복. 러너는 *기존 트레일링 메커니즘의 파라미터 확장*이라 신규 규칙 불필요. → 기각.
3. **슬롯 제외를 소비처(loopInitializer/preflight)에서 각각 구현** — 3곳 중복 + drift 위험.
   `computeSlotConsumption` 단일 SSOT 의 eligible 필터 한 곳이 정답(ADR-0080 회계 의미 보존). → 채택.
4. **러너 trailPct 를 ATR 기반 동적 산출** — 변동성 적응은 매력적이나 입력 의존 증가 +
   `entryATR14` 결손 종목 fallback 복잡. 1차는 진입 trailPct + bonus 의 단순·예측가능 산식으로
   시작, ATR 적응은 후속 ADR 후보. → 기각(Phase 0 범위 밖).

## References

- ADR-0028 — exitEngine 분해(rules/<name>.ts 파일별 단일 책임).
- ADR-0080 — Capital-Weighted Slot Accounting (`slotAccounting.ts` SSOT, 본 ADR 슬롯 제외의 모재).
- ADR-0085 §트랙2 — slotSizing 자본 가중 옵트인(러너 제외 전파 경로 중 하나).
- ADR-0146 — byte-equivalent 원칙 + PR 자가 review 5 카테고리.
- ADR-0593 — `regime/riskOnFastUpgrade.ts` 순수 판정 + ENV 헬퍼 분리 선례(runnerPolicy.ts 패턴 모재).
- ADR-0561 — KIS Primary Absolute (러너 입력은 KIS L1 currentPrice/returnPct).
- 코드: `server/trading/exitEngine/rules/{trancheTakeProfitLimit,trailingStop,trailingPeakUpdate}.ts`,
  `src/services/quant/sell/partialProfit.ts`, `server/trading/slotAccounting.ts`,
  `server/trading/exit/policies/runnerPolicy.ts`(신규), `server/persistence/shadowTradeRepo.ts`,
  `src/api/autoTradeClient.ts`.
