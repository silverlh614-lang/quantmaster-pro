# ADR-0434 — Counterfactual Price Provider Cache Wiring

## 1. 배경

ADR-0430~0433은 SELL_ONLY, HARD_BLOCK, R3, VIX, FOMC, DATA_STARVED 등 preflight abort 상황에서도 counterfactual shadow/universe learning snapshot을 남긴다.

이제 남겨진 학습 표본을 T+30m, T+1h, SAME_DAY_CLOSE, NEXT_OPEN, T+1d, T+3d 성과 데이터로 바꿔야 한다. 이 ADR은 ADR-0431 counterfactual performance report가 cache-only 가격 provider를 실제로 사용하도록 배선한다.

## 2. 문제

기존 counterfactual report의 `priceProvider`는 thin adapter 수준에 머물러 있었다. `INTRADAY_CANDLE_CACHE`, `DAILY_CANDLE_CACHE`, `MARKET_DATA_CACHE`, `READ_ONLY_QUOTE` 경로가 비어 있으면 ledger는 쌓이지만 성과 포인트는 PENDING, DATA_UNAVAILABLE, INSUFFICIENT_DATA에 과도하게 머문다.

성과 판정을 위해 새 외부 호출을 추가하면 KIS/KRX/Yahoo/Naver quota를 침범하고, 학습 리포트가 매매 본체나 일반 shadow ledger에 영향을 줄 위험도 생긴다.

## 3. 결정

`server/learning/counterfactualShadowPriceProviderAdapter.ts`를 확장해 CounterfactualPriceProvider SSOT를 둔다.

- counterfactual ledger entries를 read-only index로 들고 있다.
- horizon 도달 전에는 PENDING을 반환한다.
- cache reader는 intraday, daily, market data, read-only quote 순서로 조회한다.
- 외부 API 호출은 절대 하지 않는다.
- cache reader 예외는 해당 point ERROR로 격리한다.
- cache miss는 손실이 아니라 DATA_UNAVAILABLE 또는 INSUFFICIENT_DATA로 분리한다.
- `COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED=true`이면 cache lookup만 비활성화한다. 정확히 문자열 `'true'`만 true다.

## 4. 가격 Source 우선순위

1. `ENTRY_SNAPSHOT`: `entry.entryPrice`, `entry.entryPriceHint`, `metadata.entryPriceHint`
2. `SCAN_SNAPSHOT`: `conditionSnapshot.price`, `conditionSnapshot.lastPrice`, `metadata.quoteSnapshot.lastPrice`
3. `INTRADAY_CANDLE_CACHE`: T+30m, T+1h, SAME_DAY_CLOSE 성격의 당일 캐시
4. `DAILY_CANDLE_CACHE`: NEXT_OPEN, T+1d, T+3d 성격의 일봉 캐시
5. `MARKET_DATA_CACHE`: 이미 저장된 market data/off-hours snapshot cache
6. `READ_ONLY_QUOTE`: 이미 보관된 read-only quote snapshot
7. `NONE`: 유효 가격 없음

모든 가격은 positive finite 값만 인정한다. 0, NaN, 음수는 거부한다.

## 5. PointStatus / PointSource 의미

`PointStatus`

- `OBSERVED`: 유효 가격으로 수익률 계산 완료
- `PENDING`: 아직 horizon 도달 전
- `DATA_UNAVAILABLE`: horizon 도달 후 cache에 비교 가격 없음
- `MARKET_CLOSED`: 해당 horizon이 시장 휴장 구간이라 관측 불가
- `INSUFFICIENT_DATA`: entry price 또는 comparison price가 부족
- `ERROR`: provider 내부 예외

`PointSource`

- `ENTRY_SNAPSHOT`: counterfactual entry 자체의 가격
- `SCAN_SNAPSHOT`: scan/condition/quote snapshot의 가격
- `INTRADAY_CANDLE_CACHE`: intraday candle cache 가격
- `DAILY_CANDLE_CACHE`: daily candle cache 가격
- `MARKET_DATA_CACHE`: market data snapshot cache 가격
- `READ_ONLY_QUOTE`: read-only quote cache 가격
- `NONE`: 가격 source 없음

## 6. 외부 호출 금지

ADR-0434는 `fetch`, `axios`, KIS/KRX/Yahoo/Naver outbound fetch를 추가하지 않는다. 캐시 조회는 `offHoursSnapshotRepo` 같은 기존 read-only persistence만 사용한다.

## 7. LIVE 매매 본체 영향 0

주문 경로, `autoTradeEngine`, `orderExecutor`, `trancheExecutor`, `entryEngine` 주문 실행부, `exitEngine` 청산 실행부는 수정하지 않는다. 이 ADR은 learning/report read path만 바꾼다.

## 8. KIS/KRX/Yahoo/Naver Quota 0 침범

캐시 miss는 외부 조회로 보강하지 않는다. 따라서 KIS/KRX/Yahoo/Naver quota 영향은 0이다.

## 9. 잘못된 해결 방법

- 성과 계산을 위해 실시간 fetch를 추가한다.
- `DATA_UNAVAILABLE`을 손실로 계산한다.
- counterfactual record를 일반 shadow trade로 승격한다.
- virtual account cash/holding/equity에 반영한다.
- live/paper로 자동 승격한다.
- cache miss를 임의 가격 0 또는 손실로 보정한다.
- provider 예외로 전체 Telegram command를 실패시킨다.

## 10. 롤백 방법

`COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED=true`

정확히 이 문자열만 cache lookup을 비활성화한다. `'1'`, `'TRUE'`, `'yes'`는 비활성화로 인정하지 않는다.
