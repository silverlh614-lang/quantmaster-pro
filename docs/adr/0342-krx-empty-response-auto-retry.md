# ADR-0342: KRX OpenAPI 빈 응답 자동 재시도 (직전 거래일)

**Status**: Accepted
**Date**: 2026-05-06

## 배경

`fetchIndexDaily(endpoint, cachePrefix, date?)` — KRX OpenAPI 가 휴장일 진입 직후 또는 데이터 미반영 시 빈 응답 반환. 현 구현은 빈 결과 그대로 반환 → 호출자 (sectorEnergyProvider 등) 가 처리 부담 + 매번 같은 빈 응답 재시도.

ADR-0341 가 weekday+공휴일 정합 까지 차단했지만, **장 마감 직후 데이터 미반영** / **공휴일 직전 마지막 영업일도 데이터 부족** 같은 케이스는 여전히 빈 응답 발생.

## 결정

### 적용

1. `fetchIndexDaily` 시그니처 — `retryDepth: number = 0` 4번째 인자 (private)
2. **`fetchStockDaily` 동일 적용** (사용자 추가 요청 — 설날/추석/임시공휴일 대응)
   - `KRX_STOCK_RETRY_MAX = 5` SSOT (fetchIndexDaily 와 정합)
   - `fetchKospiDailyTrade` / `fetchKosdaqDailyTrade` 시그니처 무변경 (호출자 무수정)
3. 외부 export (`fetchKospiIndexDaily` / `fetchKosdaqIndexDaily` / `fetchKrxIndexDaily` / `fetchDerivativesIndexDaily` / `fetchKospiDailyTrade` / `fetchKosdaqDailyTrade`) 시그니처 무변경 (호출자 무수정)
4. 빈 응답 + `retryDepth < 5` + ENV 미우회 → `previousBusinessDayYyyymmdd(basDd)` 산출 → 재귀 호출
5. `previousKrxTradingDay` (krxTradingCalendar SSOT) 활용 — 한국 공휴일 정합
6. 무한 루프 차단 — `prevYyyymmdd !== basDd` 검증 + max depth 5 + 재귀 1회당 깊이 +1
7. ENV `KRX_AUTO_RETRY_ON_EMPTY_DISABLED=true` (default OFF) → 재시도 비활성 (양 함수 동시 적용)

### 안전 제약

- 재귀 깊이 ≤ 5 → 추석 7일 명절도 1회 사슬로 회복 (5/5 어린이날 + 5/4 휴장은 5/1 근로자의 날 + 5/2 토 + 5/3 일 클러스터에서 4회 재시도 후 5/8 도달 가능)
- 빈 응답 캐시 미저장 → 재시도 가치 보존 (기존 동작 동일)
- `previousBusinessDayYyyymmdd` null 반환 시 재시도 미진입

### ENV 우회

`KRX_AUTO_RETRY_ON_EMPTY_DISABLED=true` 1줄 즉시 비활성 (재시도 자체 차단).

## 안전 invariant

- KIS/KRX 자동매매 quota — 휴장일 시 최대 5회 추가 호출 (분기당 1회/일 cron). 정상일 0회.
- LIVE 매매 본체 — `fetchIndexDaily` 본체 분기 추가만, 공개 API 시그니처 무변경.
- 절대 규칙 #2 (KIS) / #3 (stockService) 무관 — KRX OpenAPI 별도 통로.

## 잘못된 해결 방법 영구 차단

1. **외부 export 시그니처 변경 (`retryDepth` 노출)** — 호출자 회귀 위험.
2. **재시도 깊이 제한 없음** — 무한 루프 위험.
3. **이전 거래일 동일 시 무한 호출** — `prevYyyymmdd !== basDd` 검증 의무.
4. **빈 응답 캐시 저장** — 재시도 가치 손실.
5. **ENV default ON for disabled** — 자동 회복 정책 정합.

## 회귀 테스트

`krxOpenApiAdr0342.test.ts` — ENV 정확 비교 3 + 정적 grep 가드 11 (시그니처 / SSOT 상수 / 헬퍼 정의 / 재귀 호출 / ENV 우회 / 무한 루프 차단 / 진단 로그 ADR 마커 / krxTradingCalendar import / 외부 export 무변경 / 입력 가드 / 캐시 정책).
