# ADR-0540: Macro shortSelling Trading-Day-Aware Freshness

@responsibility regime/provider — macroDataHealthRouter 의 shortSelling(KRX 공매도) freshness 를 36h flat → 거래일-aware 로 정정. 주말/휴장 T+1 정상지연 STALE 오판 제거, 진짜 outage 는 STALE 유지.

## Status

Accepted.

## Context

`server/trading/regime/macroDataHealthRouter.ts` 는 8개 거시 하위소스의 health 를
`DEFAULT_STALE_SEC = 36h` **flat(캘린더) 임계**로 분류한다. 이 중 `sourceHealth=STALE` 의
**유일한 현실적 경로는 `shortSelling`(KRX 공매도 비율)** 이다:

- 6개(macroState/kospi/usdKrw/spx/dxy/vkospi)는 timestamp 가 `updatedAt`(3분 갱신)으로 귀결 → STALE 불가.
- `programTrading` 은 실패 시 source='NONE' → DEGRADED(STALE 아님).
- `shortSelling` 만 실패 시 값/timestamp 를 carry-forward 하고 source 를 강등하지 않아, 자체
  `shortSellingFetchedAt` 이 36h 를 넘으면 STALE 로 떨어진다.

KRX 공매도는 **일 1회 장후 발표 + T+1 지연** 데이터다. 36h flat 임계는 거래일을 인지하지 못해
**금요일 fetch → 월요일 판정(주말 갭 60~77h)** 같은 정상 지연을 STALE 로 오판한다. 코드에 이미
`P1_SHORT_SELLING_DATA_STALE` 전용 경고(`marketDataRefresh.ts:280`)가 하드코딩돼 있어, "shortSelling
단독 STALE" 이 알려진 시나리오임을 보여준다. 동일 레포의 `supplySourceFreshnessAdr0483.ts` 는 이미
거래일 거리 기반(주말/공휴일 제외)으로 freshness 를 판정하는데 `macroDataHealthRouter` 만 이 거래일
보정이 없어 ADR-0190(거래일 달력)과 비정합이었다.

근본원인 조사: `_workspace/2026-05-29_gate1-zero-rootcause/engine-dev/fss-stale-findings.md`.

## Decision

`macroDataHealthRouter` 의 **shortSelling 항목만** 거래일-aware freshness 로 정정한다(나머지 7소스
36h flat 무변경):

- `tradingDayDistanceAdr0483`(ADR-0483) 재사용(중복 구현 없음). `shortSellingFetchedAt` 날짜와 `now`
  사이 **거래일 거리 ≤ 2 = VERIFIED, > 2 = STALE**. 주말/공휴일은 `isTradingDay`(ADR-0190)로 거리에서
  제외 → 정상 T+1/주말 갭은 거리 1~2 로 FRESH, **진짜 endpoint outage(거리 3+)는 STALE 유지**.
- `classifySource` 에 옵셔널 `tradingDayAwareTimestampKey` 추가 — shortSelling 만 `shortSellingFetchedAt`
  지정. 다른 7소스 호출부는 byte-equivalent. 자체 timestamp 미존재 시 기존 36h flat 폴백.
- **신규 ENV 0건** — 거래일-aware 가 정본 동작(tunable toggle 아님). 36h 본체 상수 무변경.

## Consequences

- **STALE 오판 제거**: 주말/T+1 정상지연이 더는 STALE 로 분류되지 않아 `macroSignalConfidence`
  정확도가 오른다. live 게이팅(`SNAPSHOT_STALE_NOT_LIVE_TRADABLE`) 입력이 정확해진다 — live 전환 시
  "정상 공매도 T+1 지연으로 매크로가 막히는 오작동" 이 사라진다.
- **불변식 #6 보존**: STALE/FRESH 는 confidence/ExecutionPermission 만 바꾼다. SourceSnapshot 불변,
  marketSignal=false 불변(regime 분류 미투입). 이번 변경은 **"오판 정정" 이지 "stale→tradable 승격"
  이 아니다** — 거리 3+ 진짜 outage 는 여전히 STALE→여전히 강등.
- **executionImpact=NONE (현재)**: engineMode=SHADOW_ONLY(의도된 pre-live)라 live 영향 미실현. live 는
  전체 보수 완료 후 별도 활성 예정.
- 다른 7소스 health 분류는 byte-equivalent(programTrading source=NONE→DEGRADED 대조군 포함).

## Guardrails

- No live trading path change. (autoTradeEngine/kisClient 무변경.)
- No regime/cooldown/engineMode change. (regimeBridge/marketStateResolver 무변경 — shortSelling health 분류만.)
- No Gate/Kelly/curve/threshold change.
- No Shadow policy change. (shadowLearning 무변경.)
- No provider fetch behavior change. (수집 로직 무변경 — freshness *판정 기준* 만 정정.)
- No SourceSnapshot/data promotion change. (불변식 #6, L1~L4 무변경.)

## Alternatives Considered

- **ENV `MACRO_SHORT_SELLING_STALE_HOURS` 가변 임계 (default 36h)**: 코드 0줄에 가깝지만 여전히 캘린더
  flat — 거래일 비인지라 주말 오판 근본 미해결. 거래일-aware 가 정본 정정이므로 미채택.
- **36h flat 전면 제거**: 진짜 outage(거리 3+) 도 STALE 안 됨 — provider 침묵 은폐. 비채택.
- **8소스 전부 거래일-aware**: 나머지 7개는 3분 갱신/명시 DEGRADED 라 불필요 + 범위 확대 위험. shortSelling 한정.

## Rollback

`classifySource` 의 shortSelling 호출에서 `tradingDayAwareTimestampKey` 1줄 제거 → 36h flat 복귀
(byte-equivalent). 코드 롤백 외 배포/ENV 무관. 회귀 테스트 `macroDataHealthRouter.test.ts` 의 7소스
36h 무회귀 케이스가 다른 소스 불변을 고정한다.
