# ADR-0437 (= 사용자 명시 ADR-0439) — KIS WebSocket Subscription Priority Queue

## 상태
Accepted (2026-05-07)

## ADR 번호 정합
- 사용자 명시 ID: ADR-0439
- 실제 발급: ADR-0437 (INDEX SSOT 다음 발급 = 0437, ADR-0148 정합)
- ADR 본문 + INDEX 등재에 *"ADR-0437 (= 사용자 명시 ADR-0439)"* 명문화 (ADR-0432/0433/0431 retrofit 패턴 정합).
- 사용자 명시 0440 / 0441 / 0442 는 reserve — 본 PR 미발급.

## 1. 배경
2026-05-07 운영 로그에서 다음 패턴이 누적 관측됨:

```
[KIS-WS] [LIMIT] subscribeStock(005930) 거부 — 이미 상한 30 도달
[KIS-WS] [LIMIT] subscribeStock(247540) 거부 — 이미 상한 30 도달
```

`server/clients/kisStreamClient.ts:106` 의 `MAX_SUBSCRIPTIONS = 30` 상한은
KIS 계정당 41 종목 하드 리밋의 안전 마진이다. 그러나 `subscribeStock(stockCode)`
는 *선착순 (FIFO)* 으로만 동작 — 워치리스트 갱신 / catalyst 추가 / `getPrice()`
호출 등의 순서대로 슬롯이 채워지면, *나중에* 평가되는 보유 종목 / liveEligible
후보 / shadowObservable 후보가 슬롯을 차지 못하고 LIMIT 거부됨.

사용자 핵심 의도 (절대 변경 금지):

> "30개 슬롯은 자원이다. 보유종목과 진입 직전 후보가 먼저고, 관측 후보와
> degraded 후보는 밀려나야 한다. ADR-0439 는 매수 로직을 바꾸는 패치가 아니라,
> 실시간 추적 슬롯을 제대로 배분하는 운영 안정화 패치다."

## 2. 문제
- `subscribeStock` 의 선착순 → 중요 종목 LIMIT 거부.
- 보유 종목이 워치리스트 다른 후보에게 슬롯을 빼앗길 수 있음 — 실시간 가격 부재
  → exitEngine 의 손절·익절 평가 정확도 ↓.
- liveEligible (entry revalidation 직전) 후보가 OBSERVE_ONLY / DATA_UNAVAILABLE
  종목에게 밀림 — 매수 시점 정확도 ↓.
- invalid KRX code (`0011TO` 등) 가 슬롯 차지 → KIS 1006 강제 종료 위험.

## 3. 결정
신규 SSOT 모듈 `server/clients/kisWebSocketSubscriptionManager.ts` 도입.
- 12-value `SubscriptionPriorityReason` union + 13-key 우선순위 매트릭스 SSOT.
- `requestKisWsSubscription(candidate, ctx)` 단일 entry — `subscribeStock` /
  `unsubscribeStock` wrapper.
- `bulkApplySubscriptionsByPriority(candidates, ctx)` — `startKisStream` 패턴 SSOT
  (호출자 wiring 후속 PR scope 외).
- 30 슬롯 포화 시 eviction 정책 — `openPosition` 절대 보호 + `liveEligible` 가능한
  한 보호.
- min-hold 5분 default — priority 상승은 즉시 반영, 하락은 만료 후 evict.
- `normalizeKrxCodeForWs` — invalid code (`0011TO` / `ABCDEF` / 빈 / 6자리 외) 거부.
- ENV `KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED=true` (default OFF, ADR-0157 정확
  비교) — 1줄 즉시 legacy 동작 100% 복원.

## 4. 우선순위 매트릭스 SSOT (절대 변경 금지)

| Reason | Priority | 설명 |
|---|---|---|
| `OPEN_POSITION` | 1000 | 보유 종목 — 절대 evict 금지 |
| `LIVE_ELIGIBLE` | 900 | ADR-0436 GateEligibility — entry revalidation 직전 |
| `ENTRY_CANDIDATE` | 800 | entryPrice 명시된 진입 후보 |
| `SHADOW_OBSERVABLE` | 700 | ADR-0436 — Shadow 관측 가능 |
| `DART_CATALYST` | 600 | DART 공시 촉매 (TTL 7일) |
| `WATCHLIST` | 500 | 일반 watchlist (default 보수 fallback) |
| `OBSERVE_ONLY` | 300 | ADR-0436 OBSERVE_ONLY 분류 |
| `PROVIDER_DEGRADED` | 300 | ADR-0125/0396/0411/0414/0423 — sectorEnergy 등 |
| `DATA_UNAVAILABLE` | 300 | ADR-0416/0421/0435 — supply/earnings unavailable |
| `WAIT_LONG` | 100 | ADR-0411 14h 이상 대기 |
| `UNKNOWN` | 100 | reasons 미명시 시 fallback |
| `INVALID_CODE` | 0 | invalid KRX code (subscribeStock 호출 0) |
| `HARD_RISK_BLOCK` | 0 | 즉시 unsubscribe (min-hold 우회) |

## 5. 30개 상한 처리

```ts
function decideAtCapacity(candidate, subscribed) {
  const evictionTarget = chooseEvictionTarget(subscribed);
  if (evictionTarget && candidate.priority > evictionTarget.priority) {
    return { action: 'SUBSCRIBE', evict: evictionTarget };  // 신규 우선
  }
  return { action: 'REJECT_LOW_PRIORITY' };  // 기존 보호
}
```

- 신규 priority > evict 후보 priority → evict + subscribe
- 신규 priority ≤ evict 후보 priority → REJECT_LOW_PRIORITY (subscribe 호출 0)
- evict 가능한 후보 부재 (모두 openPosition) → REJECT_LOW_PRIORITY (보유 보호)

## 6. Eviction 정책 (사용자 §3 절대 변경 금지)

```ts
function chooseEvictionTarget(subscribed) {
  // openPosition 절대 evict 금지
  let evictable = subscribed.filter(s => !s.openPosition);
  // min-hold 미만 제외 (forceImmediate=true 시 우회)
  evictable = evictable.filter(s => now - s.lastUpdatedAt >= MIN_HOLD_MS);
  if (evictable.length === 0) return null;
  // priority asc → low-reason (OBSERVE/WAIT/DEGRADED/UNAVAILABLE) 먼저 → lastUpdatedAt 오래된 것
  evictable.sort(...);
  return evictable[0];
}
```

## 7. min-hold / debounce 정책

- 같은 종목 구독 후 5분 (default `KIS_WS_SUBSCRIPTION_MIN_HOLD_MS=300000`) 동안은
  *낮은 우선순위 evict* 차단.
- 우선순위 *상승* 은 즉시 반영 (priority 갱신 — unsubscribe 없이).
- 우선순위 *하락* 은 min hold 만료 후에만 evict 후보.
- `HARD_RISK_BLOCK` / `INVALID_CODE` (priority 0) 은 즉시 unsubscribe (min hold 우회).
  단 `openPosition` 보유 중인 종목은 그래도 보호 (HARD_RISK_BLOCK 자체가 무효화돼야 정상).

## 8. invalid code guard

`normalizeKrxCodeForWs(raw)` SSOT (ADR-0442 후속 PR 에서 `server/utils/symbolNormalizer`
SSOT 로 통합 예정) — 본 PR 은 manager 내 inline 정착으로 회귀 위험 격리.

```ts
export function normalizeKrxCodeForWs(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (s.length === 0) return null;
  if (s.endsWith('.KS') || s.endsWith('.KQ')) s = s.slice(0, -3);
  if (!/^[0-9]{6}$/.test(s)) return null;
  return s;
}
```

## 9. 진단 메시지 (사용자 §8 명시 형식)

```
[KIS-WS] subscribe queued 005930 priority=1000 reason=OPEN_POSITION
[KIS-WS] keep 005930 priority=1000 reason=OPEN_POSITION
[KIS-WS] evict 123456 priority=300 reason=OBSERVE_ONLY → subscribe 005930 priority=900 reason=LIVE_ELIGIBLE
[KIS-WS] reject low priority 123456 priority=300 limit=30 minPriority=700
[KIS-WS] reject invalid code 0011TO
```

`formatKisWsSubscriptionSection(diag)` 텔레그램 임베드 SSOT:

```
🛰️ KIS WebSocket Subscription Queue (ADR-0437)
total: 30/30 | open: 2 | live: 5 | shadow: 8 | watchlist: 10 | observe: 5
rejected: 12 (invalid: 1, low-priority: 11) | evicted: 3
lastEvicted: 123456 reason=OBSERVE_ONLY
```

본 PR 은 SSOT 만 정착 — `/scan_blockers` / `/health` 임베드는 후속 PR scope.

## 10. LIVE 매매 본체 영향

`signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` /
`orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` 모두 0줄 변경.
`helpers.ts:30` 의 `getPrice()` 만 wrapper 경유 (try/catch 격리 + ENV 우회 1줄).

## 11. KIS/KRX/Yahoo/Naver quota 영향

- KIS WebSocket 구독 / 해제 호출 빈도 변경 0건.
- 신규 외부 API 호출 0건 (manager 자체는 `kisStreamClient.subscribeStock` /
  `unsubscribeStock` 만 wrapper).
- `fetch` / `axios` / `node-fetch` 신규 import 0건.
- 31번째 후보의 subscribe 호출이 **REJECT** 됨으로써 **KIS quota 보호 효과 격상**
  (선착순 → 우선순위 → openPosition 우선 → liveEligible 우선 진입).

## 12. 잘못된 해결 방법 영구 차단

1. **30개 제한 무시 / 무제한 retry** — KIS 1006 강제 종료 트리거.
2. **낮은 우선순위가 보유종목 evict** — 사용자 핵심 의도 위반.
3. **invalid code fallback subscribe** — KIS 1006 위험.
4. **WebSocket 문제로 Gate threshold 완화** — 매매 정책 ≠ 인프라 정책.
5. **watchlist 제거 / cooldown 본격 구현** — ADR-0440 별도 reserve.
6. **WAIT cooldown 정책** — ADR-0441 별도 reserve.
7. **symbol resolver 전체 정규화** — ADR-0442 별도 reserve. 본 PR 은 inline
   `normalizeKrxCodeForWs` 만.
8. **호출자 측 inline ENV 검사** — `isKisWsSubscriptionPriorityDisabled()` SSOT
   위임 의무 (ADR-0185~0189 정합).

## 13. 롤백 방법

ENV 1줄로 즉시 legacy 동작 100% 복원:

```bash
KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED=true
```

활성 시 `getPrice()` 가 기존 `subscribeStock(stockCode)` 직접 호출 — manager
경유 0건. 매니저 모듈은 import 만 살아있음 (dead code 안전 fallback).

## 14. 사용자 명시 ADR-0439 → 실제 발급 ADR-0437 정합

- INDEX.md 다음 발급 SSOT = 0437 (ADR-0148 정합).
- 본문 헤더 *"ADR-0437 (= 사용자 명시 ADR-0439)"* 명문화 — 다른 PR (ADR-0432
  Promotion / ADR-0433 Universe Learning / ADR-0431 Counterfactual Perf) 의
  retrofit 패턴 정합.
- 사용자 0440 / 0441 / 0442 는 reserve — 본 PR 미발급, INDEX.md 등재 0건.

## 15. 후속 ADR 후보

- **ADR-0440** — watchlist overflow / cooldown 본격 구현 (사용자 reserve).
- **ADR-0441** — WAIT cooldown 정책 (사용자 reserve).
- **ADR-0442** — symbol resolver 전체 정규화 (`server/utils/symbolNormalizer` SSOT
  통합 — 본 PR `normalizeKrxCodeForWs` 흡수).
- **bulk wiring** — `reconnectWs.cmd.ts` / `kisStreamJobs.ts` 의 `startKisStream`
  호출을 `bulkApplySubscriptionsByPriority` 로 점진 마이그레이션 (회귀 위험 격리).
- **Telegram embed** — `/scan_blockers` / `/health` 에
  `formatKisWsSubscriptionSection` 임베드 (현재 호출자 0건 dead code).

## 안전 invariants (정적 grep 가드 의무)

1. KIS 주문 함수 5종 import 0건 (`placeKisMarketBuyOrder` / `placeKisSellOrder`
   / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder`).
2. `autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건.
3. `fetch` / `axios` / `node-fetch` 신규 import 0건.
4. Gate threshold / condition weight 변경 0건 (`setGateThreshold` /
   `GATE_RELAX` / `STRONG_BUY_OVERRIDE` 부재).
5. `subscribeStock` 직접 호출 — `helpers.ts` 는 wrapper 경유 (legacy ENV
   fallback + try/catch fallback 2건만 허용).
6. `kisStreamClient.ts` `MAX_SUBSCRIPTIONS` 변경 0건 (re-import 만).

## 사용자 명시 핵심 문장 직접 반영

> "30개 슬롯은 자원이다. 보유종목과 진입 직전 후보가 먼저고, 관측 후보와
> degraded 후보는 밀려나야 한다."

이 한 문장이 §4 우선순위 매트릭스 SSOT 의 모든 수치 (1000/900/800/700/500/300/100/0)
를 절대 변경 금지로 만든 근거다.
