# ADR-0450 — KIS-WS Priority Routing for Pre-Breakout Retry Candidates

**Status**: Accepted
**Date**: 2026-05-08
**Predecessors**: ADR-0437 (KIS WebSocket Subscription Priority Queue), ADR-0449 (Pre-Breakout WAIT Liveness Policy), ADR-0436 (Gate Eligibility Split), ADR-0157 (ENV exact comparison)
**Successors**: bulkApplySubscriptionsByPriority caller wiring (`reconnectWs.cmd.ts` / `kisStreamJobs.ts`) — out of scope.

---

## 1. Problem

ADR-0449 가 도입한 `PreBreakoutWaitDecision` 7-state 분류는 *왜 매수가 보류되었는지* 를 운영자에게 보여주지만, 이 분류가 **KIS-WebSocket 30 슬롯 자원 분배에 영향을 주지 않는다**. ADR-0437 의 `requestKisWsSubscription` 우선순위 큐는 *모든 watchlist 후보를 동일하게 priority 500 (`WATCHLIST`)* 로 등록한다.

### 사용자 핵심 의도 (절대 변경 금지)

> *"ADR-0450 은 매수 조건을 낮추는 패치가 아니라, '지금 매수에 가장 가까운 후보' 가 KIS-WS 실시간 슬롯을 먼저 받게 하는 패치다."*

### 결함 시나리오

1. 후보 A: `WAIT_RETRY_ELIGIBLE` (진입가 ≤ 1% + Gate1 통과 + 거래량 정상) — 다음 tick 에 매수 가능성 가장 높음.
2. 후보 B: `WAIT_PRICE_TOO_FAR` (진입가 > 3%) — 단기 진입 가능성 낮음.
3. 후보 C: `WAIT_REJECTED` (riskBlocked) — 진입 불가능.

ADR-0437 default 동작에서 A·B·C 모두 priority=500 (`WATCHLIST`) 동일 슬롯 점유 → 30 슬롯 포화 시 A 가 가장 먼저 evict 될 가능성 존재. KIS-WS 실시간 시세를 진짜 필요한 종목 (A) 이 못 받고, 매수 가능성이 거의 없는 종목 (B/C) 이 슬롯을 차지.

---

## 2. Decision

`PreBreakoutWaitDecision.state` → `SubscriptionPriorityReason` 매핑 SSOT 신설. 결정은 *KIS-WS 슬롯 자원 분배만* 영향, **매매 결정 / Gate threshold / STRONG_BUY 조건 / 진입가 임계 모두 무관**.

### 2.1 Priority Matrix (절대 변경 금지)

| WaitState | SubscriptionPriorityReason | Priority | vs WATCHLIST(500) | Mode |
|-----------|---------------------------|---------:|:-----------------:|------|
| WAIT_RETRY_ELIGIBLE | PRE_BREAKOUT_RETRY_ELIGIBLE | **850** | ↑ (격상) | PROMOTE_TO_PRE_BREAKOUT_RETRY |
| WAIT_SHADOW_ONLY | SHADOW_OBSERVABLE | 700 | ↑ | DOWNGRADE_TO_OBSERVE (학습 보존) |
| WAIT_PRICE_TOO_FAR | WAIT_PRICE_TOO_FAR | 300 | ↓ (격하) | DOWNGRADE_TO_OBSERVE |
| WAIT_VOLUME_WEAK | WAIT_VOLUME_WEAK | 300 | ↓ | DOWNGRADE_TO_OBSERVE |
| WAIT_GATE_RECHECK_FAILED | WAIT_GATE_RECHECK_FAILED | 300 | ↓ | DOWNGRADE_TO_OBSERVE |
| WAIT_COOLDOWN | WAIT_COOLDOWN | 250 | ↓↓ | DOWNGRADE_TO_OBSERVE |
| WAIT_REJECTED | UNKNOWN | 0 | (호출 미수행) | REJECT_LOW_PRIORITY |

핵심:
- **WAIT_RETRY_ELIGIBLE 만 WATCHLIST 보다 격상** (850 > 500). 다른 모든 후보보다 KIS-WS 슬롯 우선 확보.
- **먼/약한/탈락 후보는 WATCHLIST 보다 격하** (300/250 < 500). 30 슬롯 포화 시 자연 evict.
- **WAIT_REJECTED 는 KIS-WS 호출 자체 차단** (priorityHint=0, manager 부담 감소).
- **WAIT_SHADOW_ONLY 는 priority 700** — 매수 후보 아니지만 학습 표본 보존 위해 SHADOW_OBSERVABLE slot 사용 (ADR-0173 ShadowLearningOnlyScan 정합).

### 2.2 SubscriptionPriorityReason union 확장 (13 → 18)

ADR-0437 기존 13-value union 에 5 신규 reason 추가 (table 동시 확장):

```typescript
export type SubscriptionPriorityReason =
  | 'OPEN_POSITION'                   // 1000 (ADR-0437)
  | 'LIVE_ELIGIBLE'                   //  900 (ADR-0437)
  | 'PRE_BREAKOUT_RETRY_ELIGIBLE'     //  850 (ADR-0450 신규)
  | 'ENTRY_CANDIDATE'                 //  800 (ADR-0437)
  | 'SHADOW_OBSERVABLE'               //  700 (ADR-0437)
  | 'DART_CATALYST'                   //  600 (ADR-0437)
  | 'WATCHLIST'                       //  500 (ADR-0437)
  | 'OBSERVE_ONLY'                    //  300 (ADR-0437)
  | 'WAIT_PRICE_TOO_FAR'              //  300 (ADR-0450 신규)
  | 'WAIT_VOLUME_WEAK'                //  300 (ADR-0450 신규)
  | 'WAIT_GATE_RECHECK_FAILED'        //  300 (ADR-0450 신규)
  | 'WAIT_COOLDOWN'                   //  250 (ADR-0450 신규)
  | 'WAIT_LONG'                       //  100 (ADR-0437)
  | 'PROVIDER_DEGRADED'               //  300 (ADR-0437)
  | 'DATA_UNAVAILABLE'                //  300 (ADR-0437)
  | 'INVALID_CODE'                    //    0 (ADR-0437)
  | 'HARD_RISK_BLOCK'                 //    0 (ADR-0437)
  | 'UNKNOWN';                        //  100 (ADR-0437)
```

ADR-0437 의 12 기존 priority 값 변경 0건 (사용자 명시 §"절대 하지 말 것" 정합).

---

## 3. SSOT 신규 — `preBreakoutKisWsPriorityRouting.ts`

```typescript
// server/trading/signalScanner/preBreakoutKisWsPriorityRouting.ts (신규)

export type PreBreakoutKisWsRoutingMode =
  | 'PROMOTE_TO_PRE_BREAKOUT_RETRY'  // WAIT_RETRY_ELIGIBLE → 850
  | 'KEEP_WATCHLIST'                  // ENV DISABLED → 500 fallback
  | 'DOWNGRADE_TO_OBSERVE'            // WAIT_PRICE_TOO_FAR / VOLUME_WEAK / GATE_RECHECK_FAILED / COOLDOWN / SHADOW_ONLY
  | 'REJECT_LOW_PRIORITY';            // WAIT_REJECTED → priority 0 (호출 미수행)

export interface PreBreakoutKisWsRoutingDecision {
  state: PreBreakoutWaitState;
  reason: SubscriptionPriorityReason;
  priorityHint: number;
  mode: PreBreakoutKisWsRoutingMode;
  shouldRequestSubscription: boolean;  // false 시 호출자가 requestKisWsSubscription skip
  operatorMessage: string;
}

export function isPreBreakoutKisWsPriorityRoutingDisabled(): boolean;

export function routePreBreakoutWaitToKisWs(
  decision: PreBreakoutWaitDecision,
): PreBreakoutKisWsRoutingDecision;
```

### 3.1 결정 트리 (사용자 §"결정 규칙" 정합 — 절대 변경 금지)

위에서 아래 첫 매칭:

1. **ENV `PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true`** → `KEEP_WATCHLIST` (priority 500, ADR-0437 default 동작 100% 복원)
2. **WAIT_RETRY_ELIGIBLE** → `PROMOTE_TO_PRE_BREAKOUT_RETRY` (priority 850, WATCHLIST 격상)
3. **WAIT_SHADOW_ONLY** → `DOWNGRADE_TO_OBSERVE` (priority 700 SHADOW_OBSERVABLE, 학습 보존)
4. **WAIT_PRICE_TOO_FAR / WAIT_VOLUME_WEAK / WAIT_GATE_RECHECK_FAILED** → `DOWNGRADE_TO_OBSERVE` (priority 300)
5. **WAIT_COOLDOWN** → `DOWNGRADE_TO_OBSERVE` (priority 250, 가장 낮음)
6. **WAIT_REJECTED** → `REJECT_LOW_PRIORITY` (priority 0, KIS-WS 호출 자체 차단)

`shouldRequestSubscription=false` 는 WAIT_REJECTED 한 분기만 (manager 재호출 부담 차단).

### 3.2 외부 의존성 0

본 SSOT 는 순수 함수만:
- 의사결정 / 주문 / 회로차단기 / 영속 / 외부 API 호출 모두 부재.
- 단지 ADR-0449 `PreBreakoutWaitDecision` 입력 → ADR-0437 `SubscriptionPriorityReason` + `priorityHint` 출력 매핑.

---

## 4. Caller Wiring — `buyListLoop.ts` (두 WAIT site)

```typescript
// PRE_BREAKOUT_MISS site + ENTRY_PRICE_DEVIATION site 동일 패턴
const decision = evaluatePreBreakoutWait({...}); // ADR-0449
// decision.increaseWaitCount 시 stock.waitCount/lastWaitAt 갱신 (ADR-0449 기존)
// ADR-0450 신규 wiring:
try {
  const routing = routePreBreakoutWaitToKisWs(decision);
  if (routing.shouldRequestSubscription) {
    requestKisWsSubscription(
      {
        code: stock.code,
        name: stock.name,
        priority: routing.priorityHint,
        reasons: [routing.reason],
        entryCandidate: decision.state === 'WAIT_RETRY_ELIGIBLE',
        shadowObservable: decision.shadowLearningAllowed,
      },
      {},
    );
  }
} catch (e) {
  console.warn(`[ADR-0450] pre-breakout KIS-WS routing 실패 ${stock.code}:`, e);
}
```

### 4.1 try/catch 격리 (사용자 §"절대 하지 말 것" 정합)

routing throw / requestKisWsSubscription throw 모두 catch 흡수 — 매수 흐름 *절대* 차단 금지. ADR-0437 `requestKisWsSubscription` 자체도 invalid code / HARD_RISK_BLOCK 등 보호 분기 보유.

### 4.2 호출자 측 inline ENV 검사 0건

본 SSOT 의 `isPreBreakoutKisWsPriorityRoutingDisabled()` 가 결정 트리 1번 분기에서 통합 처리. buyListLoop 측은 *결과만* 사용 (drift 차단).

---

## 5. ENV 우회

### 5.1 `PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true`

(default OFF, ADR-0157 정확 비교 — `=== 'true'` 의무, `'1'` / `'TRUE'` / `'yes'` 모두 거부)

활성 시 `routePreBreakoutWaitToKisWs` 가 *모든* WaitState 에 대해 `KEEP_WATCHLIST` (priority 500) 반환 → ADR-0437 default 동작 100% 복원.

회귀 발견 시 Railway ENV 1줄 즉시 적용 가능.

---

## 6. 절대 불변식 (17종)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄 (buyListLoop 두 WAIT site 는 *진단 + KIS-WS 우선순위 격상 layer* 만, 매수 결정 / 주문 / 회로차단기 무관).
2. **KIS 주문 함수 5종 import 0건** (`placeKisMarketBuyOrder` / `placeKisMarketSellOrder` / `placeKisLimitOrder` / `cancelKisOrder` / `placeKisStopLossOrder`) — 정적 grep 가드.
3. **autoTradeEngine / orderExecutor / trancheExecutor import 0건** — 정적 grep 가드.
4. **외부 API 신규 호출 0건** (KIS REST / KRX / Yahoo / Naver) — 본 SSOT 는 순수 함수.
5. **Gate threshold + condition weight + STRONG_BUY 조건 변경 0건** — 사용자 §"절대 하지 말 것" 정합.
6. **SectorEnergy / 수급 / FSS / R3 / sanity diagnostic 무수정** (out of scope).
7. **ADR-0437 기존 12 priority 값 변경 0건** — `OPEN_POSITION=1000` / `LIVE_ELIGIBLE=900` / `ENTRY_CANDIDATE=800` / `SHADOW_OBSERVABLE=700` / `DART_CATALYST=600` / `WATCHLIST=500` / `OBSERVE_ONLY=300` / `PROVIDER_DEGRADED=300` / `DATA_UNAVAILABLE=300` / `WAIT_LONG=100` / `UNKNOWN=100` / `INVALID_CODE=0` / `HARD_RISK_BLOCK=0` 모두 정합 보존.
8. **WAIT_RETRY_ELIGIBLE 만 WATCHLIST 격상** (850 > 500) — 다른 6 WaitState 는 모두 격하 또는 호출 미수행.
9. **WAIT_REJECTED → KIS-WS 호출 자체 차단** (`shouldRequestSubscription=false`, priorityHint=0).
10. **ENV `PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true` 1줄로 ADR-0437 default 동작 100% 복원** (회귀 안전망).
11. **호출자 측 inline ENV 검사 0건** — `isPreBreakoutKisWsPriorityRoutingDisabled()` SSOT 위임 의무.
12. **try/catch 격리** — routing throw / requestKisWsSubscription throw 모두 매수 흐름 차단 금지.
13. **bulkApplySubscriptionsByPriority 호출자 wiring 본 PR scope 외** (별도 후속 PR).
14. **WAIT 후보 priority routing 자동 변경 금지** — `decision.kisWsPriorityAdjustment` 는 진단 정보, 본 SSOT 가 결정 SSOT.
15. **ADR-0157 ENV 정확 비교 의무** (`=== 'true'`).
16. **ADR-0449 PreBreakoutWaitDecision schema 무수정** — 본 SSOT 는 read-only consumer.
17. **TypeScript exhaustive switch** — `_exhaustive: never` 패턴으로 PreBreakoutWaitState union 신규 값 추가 시 컴파일 타임 fail.

---

## 7. Out of Scope (잔여 후속 PR)

- `bulkApplySubscriptionsByPriority` 호출자 wiring (`reconnectWs.cmd.ts` / `kisStreamJobs.ts`) — KIS-WS 30 슬롯 자동 재배분 활성화. 별도 ADR + PR.
- WAIT_COOLDOWN 영속 만료 정책 (lastWaitAt + 30분 cooldown 자동 해제 via Heartbeat) — ADR-0449 §Out of scope 그대로.
- KIS-WS quota 모니터링 (1000 priority queue 진단) — 별도 PR.
- watchlist 자동 정리 (REJECTED → 영구 제거) — 사용자 §"WAIT 는 실패 아님" 정합 보존, 별도 ADR scope.

---

## 8. Rollback ENV (즉시 적용 가능)

```bash
# Railway 또는 .env
PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true
```

→ `routePreBreakoutWaitToKisWs` 가 *모든 WaitState* 에 대해 `KEEP_WATCHLIST` (priority 500) 반환 → ADR-0437 default 동작 100% 복원.

---

## 9. Test Plan (55 신규 회귀)

| Group | Cases | Coverage |
|-------|------:|----------|
| A. Priority table SSOT | 11 | SUBSCRIPTION_PRIORITY_TABLE 18 entries / 5 신규 정합 / 12 기존 무변동 / Object.freeze drift / 상대 순서 |
| B. Decision mapper | 9 | 7 WaitState × routing mode + ENV DISABLED fallback + exhaustive |
| C. ENV gate | 5 | default OFF / `'true'` / `'1'` `'TRUE'` `'yes'` 거부 / `'false'` |
| D. Manager wiring | 7 | priority 격상 KEEP / 30 슬롯 evict / OPEN_POSITION 보호 / WAIT_COOLDOWN REJECT |
| E. Static grep guards | 11 | KIS 주문 5종 / autoTradeEngine / Gate threshold / STRONG_BUY / fetch / inline ENV / 외부 API |
| F. ADR-0449 regression | 3 | PreBreakoutWaitDecision schema 무수정 / increaseFailCount: false 보존 |
| G. operatorMessage | 3 | 한국어 문구 / state 별 차이 |
| H. Integration scenarios | 4 | 30 종목 distribution / WATCHLIST → PROMOTE / SHADOW_OBSERVABLE / WAIT_REJECTED skip |

총 **55 케이스** (목표 ≥40 의 1.38배). heuristic ~28/100 LoC 충족.

---

## 10. 잘못된 해결 방법 영구 차단 (8종)

1. **WAIT_REJECTED 도 priority 100 으로 호출 시도** — manager 재호출 부담 누적, `shouldRequestSubscription=false` 의무.
2. **WAIT_SHADOW_ONLY priority 800 (LIVE_ELIGIBLE 동등) 격상** — 학습 후보가 매수 후보보다 슬롯 우선권 가짐.
3. **WAIT_RETRY_ELIGIBLE priority 1000 (OPEN_POSITION 동등) 격상** — 보유 종목 evict 위험.
4. **bulkApplySubscriptionsByPriority 본 PR 통합** — 별도 PR scope (회귀 위험 격리).
5. **decision.kisWsPriorityAdjustment 를 routing 결정에 사용** — 진단 정보 (운영자용), 본 SSOT 가 routing SSOT.
6. **ADR-0437 기존 priority 값 (특히 ENTRY_CANDIDATE 800 / SHADOW_OBSERVABLE 700) 변경** — 사용자 §"절대 하지 말 것" 위반.
7. **호출자 측 inline `process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED` 검사** — drift 위험, SSOT 헬퍼 위임 의무.
8. **routing throw 시 매수 흐름 차단** — try/catch 격리 의무, manager 측 `requestKisWsSubscription` 도 invalid code / HARD_RISK_BLOCK 보호 분기 보유.

---

## 11. ADR-0146 PR Self-Review (5 categories — all PASS)

- **A. LIVE 매매 안전성**: KIS/KRX quota 0 침범 + ENV 롤백 1줄 + 회귀 55 케이스 + 5 보호층 (try/catch + invalid code + HARD_RISK_BLOCK + ENV gate + 호출자 측 ENV 0).
- **B. wiring 완료 vs 인프라만**: routing SSOT + buyListLoop 두 WAIT site wiring 완료. bulkApplySubscriptionsByPriority caller wiring 만 PENDING_WIRING 후속.
- **C. ADR 발급 무결성**: INDEX.md 다음 발급 0450 → 0451 + 0450 등재.
- **D. 회귀 테스트 적정성**: 55 신규 (heuristic ~28/100 LoC, ≥5 충족) + 사전 baseline 16 fail 본 PR 무관 git stash 동일 재현 확정.
- **E. 정책 위반**: validate:all 16종 baseline 무회귀.

---

## 12. References

- ADR-0437 (KIS WebSocket Subscription Priority Queue) — SUBSCRIPTION_PRIORITY_TABLE SSOT, requestKisWsSubscription 단일 진입점.
- ADR-0449 (Pre-Breakout WAIT Liveness Policy) — PreBreakoutWaitDecision 7-state schema.
- ADR-0436 (Gate Eligibility Split) — liveEligible / shadowObservable 분류 SSOT.
- ADR-0173 (Shadow Learning Only Scan) — shadowLearningAllowed propagate.
- ADR-0157 (ENV exact comparison) — `=== 'true'` 의무.
- ADR-0115 (Entry Price Immutable + failCount 보호) — `increaseFailCount: false` literal type 강제.
- ADR-0146 (PR Pace Audit Rule) — PR 자가 review 5 카테고리.
