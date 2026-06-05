# ADR-0578: gate1 technical indicator injection

@responsibility engine — Gate1 price-context 하이드레이션에 기술지표(ma/rsi/atr) 주입

## Status

Accepted (flag default OFF — byte-equivalent)

## Context

Gate1 minimum signal score가 평균 ~49/70 에 갇혀 통과 종목이 전무하다
(`/scan_blockers_gate1` avg 49.2/70, pass 2/48; technicalProjected 22/48). 2026-06-05
원인조사 결과는 **임계(70)가 아니라 기술 피처 배선 갭**이었다(ADR-0417 분류상
data/evaluator 영역, true-fail 아님 — `requiredScore=70` 절대 보존).

- 스코어러(`minimumSignalScoreTrace.ts`)의 `TECHNICAL_TREND`(max 14)·`VOLUME_LIQUIDITY`
  컴포넌트는 `trace`의 `ma20/ma60/rsi14/atr/volume` 를 읽는다. 후보 스냅샷 구성
  (`signalScanner/index.ts:663-677`)에서 이 필드들의 fallback 은 `symbolFeatures → quote`
  **단 2곳**이다.
- 반면 RS/모멘텀(`return20d`·`rsRankPct`)은 `featurePack.momentum`·`momentumProjection`
  까지 5~6단 fallback 이라 장후(시세 미수신)에도 생존한다 → live 관측상 RS 48/48 vs
  기술 22/48 의 비대칭.
- 스캔 경로의 per-symbol 하이드레이션(`injectPerSymbolPriceContext.ts`, `index.ts:484`
  에서 전 후보 실행)은 일봉 bars 를 이미 fetch 해 `return5d/return20d/avgVolume` 를
  계산·주입하지만 **`ma20/ma60/rsi14/atr` 는 계산하지 않는다** — bars 가 거기 있는데도.
- 그 지표 산식은 이미 `screener/adapters/kisQuoteAdapter.ts`(buildExtendedFromKisDaily)에
  존재한다(공유 `_indicators` 의 RSI/MACD + 로컬 avg/ATR). 즉 **데이터도·계산기도 있으나
  스캔 하이드레이션 경로가 둘을 연결하지 않은 "존재-but-미배선"** 갭이다(ADR-0551
  leadershipBridge·ADR-0568 sector wiring 과 동류).

영향: 기술/거래량 컴포넌트가 항상 0 → score 천장이 ~26점 눌려 평균 49 고착 →
55~70 밴드 진입 종목 부재 → counterfactual 자동튜너(ADR-0554) 도 관측 표본을 못 얻어 교착.

## Decision

`GATE1_TECHNICAL_INDICATOR_INJECTION_ENABLED`(default OFF, 명시적 `=== 'true'` opt-in)
플래그로 배선 갭을 닫는다.

- **공유 헬퍼**: `screener/adapters/_indicators.ts` 에 `calcSMA`·`calcATR` 추가
  (kisQuoteAdapter 로컬 산식과 동일 — 산식 SSOT 통합 1차). RSI 는 기존 `calcRSI14` 재사용.
- **주입 지점**(`injectPerSymbolPriceContext.ts`): flag ON 시 *이미 받아온 동일 bars* 로
  `ma20/ma60/rsi14/atr/atr20avg` 계산 후 `candidate.symbolFeatures` 에 주입한다(스코어러
  ma20 읽기 경로 = `symbolFeatures?.ma20 ?? quote?.ma20`). 기존 symbolFeatures 값은
  **보존**(덮어쓰기 금지) — full adapter 하이드레이션을 거친 종목은 자기 값 유지.
- bars 는 최신→과거 내림차순이나 `_indicators` 헬퍼는 과거→최신 오름차순 기대 → 역순 변환.
  ma/rsi 는 종가, atr 은 high/low/close 정합 표본만 사용(필드 부재 시 해당 지표만 null).
- KIS 일봉 lookback 을 flag ON 시 35→90 *역일*(ma60=60거래일 충당)로 상향 — **KIS 호출
  수 불변(rows 만 증가)**. snapshot 경로(dailyBars 최대 60일)는 추가 fetch 없이 재사용.
- 주입 성공률(`technicalInjected`/total)을 진단 로그에 노출 — 잔여 bar-fetch 커버리지
  (quota) 포크를 운영 데이터로 실측.

## Consequences

- **flag OFF = byte-equivalent**: lookback 35 유지·지표 계산 skip·symbolFeatures 무변경·
  기존 주입(volume/return) 동일. 회귀 테스트로 증명(injectPerSymbolPriceContext.test.ts).
- **flag ON**: bar-fetch 성공 후보의 TECHNICAL_TREND(14)+VOLUME_LIQUIDITY 회복 →
  Gate1 score 55~70 밴드 진입 → counterfactual 밴드 표본 누적 → 자동튜너 교착 해소.
- **executionImpact**: OFF=NONE / ON=execution-adjacent — `requiredScore=70` 와
  ×1 live 게이트(`getEffectiveGateThreshold`)는 0 변경이라 주문 경로 직접 변경은 없으나,
  score 상승으로 Gate1 통과 수가 늘 수 있어 **shadow 검증 권고**(diagnostic-only 아님).
- **providerImpact**: KIS 호출 수 불변(동일 `fetchKisStockDailyBars` 1콜, 35→90 역일은
  응답 rows 증가만) — ADR-0561 KIS-primary·05-provider-policy 정합.
- **불변식**: #6(providerIssue≠marketSignal — marketSignal 미설정)·#7(L4/AI 데이터 미사용)·
  스코어러 본체·requiredScore 70 무접촉. 9대 불변식 VERBATIM 0줄.
- **롤백**: ENV 제거 = byte-equivalent.
- **테스트**: injectPerSymbolPriceContext.test.ts +4(OFF byte-equiv / ON 주입 /
  일봉<60 ma60 null / 기존값 보존).

계보: ADR-0417(empty-scan postmortem true-fail vs unavailable 분리) · ADR-0551/0568
(존재-but-미배선 wiring 패턴) · ADR-0554(counterfactual gate) · ADR-0557(consumer contract).
