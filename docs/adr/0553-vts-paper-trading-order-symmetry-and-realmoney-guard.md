# ADR-0553: VTS paper-trading order symmetry + real-money startup guard

@responsibility trading — VTS(모의) 주문 대칭화 게이트 + 실계좌 시동 안전 가드 (2축 정책)

## Status

Accepted

## Context

운영자는 모의투자(KIS VTS, `KIS_IS_REAL=false` → `openapivts` endpoint + `VTTC*` TR_ID)로
**실계좌처럼 매매를 돌리며 전략을 튜닝**하길 원한다(실계좌 튜닝은 금지). 감사 결과, 시스템이
"실행 방향"과 "계좌(real/모의)"라는 **직교 2축**을 두 곳에서 conflate 하고 있었다:

1. **매도/주문 facade 게이트** — `isLiveOrderAllowed() = KIS_IS_REAL && getTradingMode()==='LIVE'`
   ([orders.ts](../../server/clients/kisClient/orders.ts)). `KIS_IS_REAL===true` 를 요구해
   **모의(VTS) 매도 경로가 아예 없다.** 반면 매수는 게이트웨이(`submitBuyOrder`)가 모드무관 +
   `KIS_IS_REAL` 라우팅이라 `LIVE + KIS_IS_REAL=false` 면 모의 매수가 정상 집행된다.
   → **매수는 모의로 나가는데 매도는 SHADOW로 빠지는 비대칭**(사고 못 파는 상태).
2. **시동 가드** — `if (AUTO_TRADE_MODE==='LIVE' && KIS_IS_REAL!=='true') throw`
   ([index.ts](../../server/index.ts)). `LIVE + 모의` 조합 자체로 **서버 기동을 거부**한다.
   "LIVE ⟹ 실계좌" 가정의 같은 conflation.

올바른 모델은 2축이다: **실행 ON/OFF(`AUTO_TRADE_MODE`) × 계좌 real/모의(`KIS_IS_REAL`)**.
모의투자 = `LIVE`(주문 집행) + `KIS_IS_REAL=false`(계좌 라우팅). 매수가 이미 이 모델이므로
매도·시동 가드만 정합시키면 대칭 모의매매가 가능하다.

## Decision

2축 모델로 정합. 모두 **flag-gated, default OFF → byte-equivalent**.

1. **주문 facade 게이트** — 순수 resolver `resolveFacadeOrderExecutionAllowed({mode, kisIsReal,
   vtsPaperTradingEnabled})` 추출:
   - `mode !== 'LIVE'` → false (SHADOW/OFF, 불변).
   - `VTS_PAPER_TRADING_ENABLED=true` → `mode==='LIVE'` 면 true (계좌는 `KIS_IS_REAL` 라우팅 — 매수와 동일).
   - flag OFF(default) → `return kisIsReal` = 기존 `KIS_IS_REAL && LIVE` **byte-identical**.
   - facade 5개 경로(매수·매도·손절OCO·익절OCO·취소)가 이 단일 게이트를 공유 → 한 곳 수정으로 대칭.

2. **시동 안전 가드** — 순수 resolver `resolveAutoTradeStartupGuard(env)` (startupExecutionContext)로
   격상, index.ts 인라인 throw 대체:
   - `LIVE + 실계좌(KIS_IS_REAL=true)`: `KIS_REAL_MONEY_ACK=true` **필수** — 없으면 기동 거부
     (실수로 실거래 켜짐 방지 하드가드). 있으면 🔴 실제 돈 경고 배너.
   - `LIVE + 모의(KIS_IS_REAL=false)`: `VTS_PAPER_TRADING_ENABLED=true` **필수** — 없으면 기동 거부
     (매수만 나가는 비대칭 방지; 기존 거부와 byte-equivalent 트리거). 있으면 🧪 모의 배너.
   - `mode !== LIVE` → 통과(실주문 경로 비활성).

3. **시동 배너** — `buildStartupExecutionContextSnapshot` 에 `paperExecutionActive`/`accountType`
   (REAL_MONEY/PAPER_VTS/NONE) 추가. `LIVE+모의+flag` 를 "주문 OFF" 로 오표시하던 것을 정정
   (`orderExecutionLabel=ON`, 🧪 모의 라벨). `liveExecutionAllowed`(실제 돈) 의미는 보존.

## Consequences

- **flag OFF(default): 완전 byte-equivalent.** 주문 게이트 = `KIS_IS_REAL && LIVE`(동일), 시동은
  `LIVE+모의` 거부(동일). 신규 flag 미설정 시 동작 무변화.
- **flag ON 시 executionImpact=HIGH** — `LIVE + KIS_IS_REAL=false + VTS_PAPER_TRADING_ENABLED=true`
  에서 모의(VTS) 매수·매도가 **대칭 집행**. 단 `KIS_IS_REAL=false` 라 **실제 돈 위험 0**(모의계좌).
- **신규 안전 강화(byte-equivalent 아님, 의도)**: `LIVE + 실계좌` 는 이제 `KIS_REAL_MONEY_ACK` 없이는
  기동 거부. 기존엔 무가드 허용이었다. 현재 SHADOW 운영이라 즉시 영향 없음.
- 상류(스캔/게이트/유니버스, 층1)는 실행모드 무관이라 본 변경과 직교 — 손대지 않음.
- shadow 학습 ledger always-on(불변식 #2) 보존. 매수 shadowMode 디스패처(이미 모의 작동) 무수정.
- 롤백 = `VTS_PAPER_TRADING_ENABLED`/`KIS_REAL_MONEY_ACK` env 해제 → flag OFF byte-equivalent.

## Guardrails

- No live trading path change unless explicitly stated. (본 ADR 가 명시적 변경 — flag-gated.)
- No KIS/order import or invocation unless explicitly stated. (게이트 로직만; 신규 KIS 호출 0.)
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated. (shadow 학습 always-on 보존.)
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
