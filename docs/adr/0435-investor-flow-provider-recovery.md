# ADR-0435 — Investor Flow Provider Recovery

## 1. 배경

2026-05-07 장중 운영 로그에서 KRX investor-flow 요청 실패, `KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400`, `CACHE_EMPTY`, `NAVER_INVESTOR_TREND: NOT_WIRED`, semantic net-buy collector 미구현이 반복 확인되었다. ADR-0416~0418은 DATA_UNAVAILABLE을 failed로 오분류하지 않도록 의미론을 정리했지만, 실제 investor-flow provider health는 아직 명확한 상태로 노출되지 않았다.

## 2. 문제

수급 데이터 부재가 단순 `null` 또는 `false`로 떨어지면 `supply_confluence`가 실제 수급 악화와 provider 미확인을 구분하지 못한다. 그 결과 운영자는 gate threshold 또는 weight 문제로 오해할 수 있고, provider 장애가 silent degradation으로 남는다.

## 3. 결정

InvestorFlowProviderHealth SSOT를 추가한다. KRX, NAVER, CACHE, KIS diagnostic-only, COMPOSITE semantic net-buy 상태를 모두 명시한다. provider unavailable은 `DATA_UNAVAILABLE`/`PROVIDER_UNAVAILABLE` 진단으로만 전달하고, 실제 외국인+기관 동반 순매도처럼 semantic net-buy가 확인된 경우에만 `supply_confluence`의 임계 미달로 본다.

## 4. ProviderHealth 상태 정의

상태 union은 `OK`, `CACHE_HIT`, `CACHE_EMPTY`, `HTTP_400`, `HTTP_403`, `HTTP_429`, `HTTP_5XX`, `TIMEOUT`, `NOT_WIRED`, `MARKET_CLOSED`, `LUNCH_BREAK`, `NON_TRADING_DAY`, `PARAM_INVALID`, `PARSER_EMPTY_ROWS`, `PROVIDER_UNAVAILABLE`, `UNKNOWN_ERROR`를 사용한다.

각 health는 `provider`, `status`, `dataAvailable`, `semanticAvailable`, `isNegativeFlowConfirmed`, `isPositiveFlowConfirmed`, `reason`, `observedAtKst`, `sourceDateKst`를 가진다.

## 5. PASS / FAIL / DATA_UNAVAILABLE / ERROR 의미

- PASS: semantic net-buy가 있고 외국인+기관 수급 합치가 확인된다.
- FAIL: semantic net-buy가 있고 외국인+기관 동반 매도 또는 명확한 수급 악화가 확인된다.
- DATA_UNAVAILABLE: cache empty, HTTP400/empty rows, NOT_WIRED, session-gated skip처럼 평가할 데이터가 없다.
- ERROR: timeout, parser exception, 예외처럼 provider 내부 오류가 있다.

## 6. 수급 부정과 수급 미확인의 차이

수급 부정은 실제 foreign/institution net-buy 값이 음수로 확인된 상태다. 수급 미확인은 provider가 데이터를 주지 못한 상태다. 수급 미확인은 `DATA_UNAVAILABLE`이지 `FAIL`이 아니다.

## 7. postmortem action 정책

수급 provider unavailable이 dominant이면 `CHECK_DATA_SOURCE`, `PATCH_PROVIDER`, `PATCH_EVALUATOR` 계열 조치가 맞다. `REVIEW_GATE_THRESHOLD` 또는 gate 완화 권고는 실제 threshold failure가 dominant할 때만 허용한다.

## 8. session gate 정책

KRX investor-flow fetch는 `LUNCH_BREAK`, `NON_TRADING_DAY`, `MARKET_CLOSED`, pre-open/post-close에서 반복 호출하지 않는다. 대신 sourceDateKst와 marketSession을 health에 남기고 cache fallback을 허용한다.

## 9. cache / negative cache 정책

성공한 investor-flow 결과는 기존 `investor-flow-cache.json`에 저장한다. 실패한 empty/HTTP400/session-gated 결과는 in-memory negative cache로 짧게 재시도 억제한다. negative cache key에는 market session과 sourceDateKst가 포함되므로 `LUNCH_BREAK -> REGULAR` 전환 시 재시도 가능하다.

## 10. LIVE 매매 본체 영향 0

LIVE 주문, 체결, 청산 경로는 수정하지 않는다. 본 ADR은 provider health, evaluator semantics, Telegram diagnostics만 다룬다.

## 11. KIS/KRX/NAVER quota 영향

KIS diagnostic investor-flow 호출은 ADR-0435 경로에서 억제한다. KRX/NAVER 호출은 기존 router/warmup 경로 안에서 session gate와 negative cache를 따른다. 무제한 retry는 금지한다.

## 12. 잘못된 해결 방법

- Gate threshold 완화
- `DATA_UNAVAILABLE`을 PASS 처리
- `DATA_UNAVAILABLE`을 FAIL 처리
- 무제한 retry
- 실매수 path 수정
- supply_confluence weight 하향
- STRONG_BUY threshold 완화
- raw response body 또는 민감 header/token 로그

## 13. 롤백 방법

롤백은 ADR-0435 변경 파일을 되돌리면 된다. 운영상 즉시 완화가 필요하면 KRX API disable/session gate 및 기존 `/supply_health` 캐시 진단만 사용해 investor-flow provider 복구 전까지 DATA_UNAVAILABLE 상태로 운용한다.
