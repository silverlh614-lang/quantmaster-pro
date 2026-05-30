# ADR-0543: Macro shortSelling KIS L1 Proxy Fallback (KRX OTP outage remediation)

@responsibility provider/macro-health/regime — KRX OTP 구조적 차단으로 정체된 shortSelling 신선도를 KIS 공식 daily-short-sale 시장-프록시 ETF 비중(L1)으로 보강 + L4(KIS_ESTIMATE/CACHE) 임계 격리. ENV gated, byte-equivalent, executionImpact NONE.

## Status

Accepted / Shadow-only. ENV `SHORT_SELLING_KIS_PROXY_FALLBACK` default OFF.

Tags: provider / macro-health / regime / shadow-only / data-source-policy

## Context

KRX OTP(`generate.cmd`) 가 구조적으로 차단되어(봇 트래픽/세션쿠키·리퍼러 부재 검증 강화)
`fetchKrxShortSelling()` 의 3단 폴백 `KRX_DIRECT → KRX_OTP → KIS_ESTIMATE` 가 전부 null 을
반환했다. 결과적으로 `shortSellingFetchedAt` 이 마지막 성공 시각에 고착되어 거래일 거리가
5일까지 누적, ADR-0540 거래일-aware 분류기가 `shortSelling:STALE` 로 **정확히** 판정했다.
즉 STALE 의 뿌리는 분류기가 아니라 **데이터 자체가 들어오지 않는 것**이다.

기존 3차 폴백 `KIS_ESTIMATE`(`tryKrxShortViaKisRanking`)는 KIS 공매도 **잔고 절대량**만
얻어 비율로 변환하지 못하고 `4.5 + negativePressure*5.0` 하드코딩 휴리스틱을 반환했다 —
이는 **L4(휴리스틱 추정)** 로, 불변식 #7(L4 는 live 매매 결정 금지) 대상이다. 게다가 KIS
미설정/ranking 빈 배열이면 null 이라 신선도 회복에 무력했다.

KIS 에는 "코스피 전체 공매도 비중" 단일 엔드포인트가 **없다**(공식 레포 대조 확정).
공식 공매도 API 2종은 모두 종목 단위다:
- `FHPST04820000 /ranking/short-sale` — 공매도 상위 종목 순위(시장 합계 아님)
- `FHPST04830000 /quotations/daily-short-sale` — 종목별 일별추이, `ssts_tr_pbmn_rlim`(공매도 거래대금 비중) 제공

따라서 코스피200 추종 대표 ETF(`069500`, KODEX 200)의 `ssts_tr_pbmn_rlim` 를 **시장-프록시**로
사용한다. 값 자체는 KIS 공식 체결 데이터(**L1**)이며, 프록시 1종이라는 한계는 *coverage* 문제이지
*신뢰등급* 강등이 아니다.

## Decision

1. **폴백 체인 확장.** `fetchKrxShortSelling()` 의 폴백을
   `KRX_DIRECT(L1) → KRX_OTP(L1) → KIS_PROXY(L1, 신규) → KIS_ESTIMATE(L4, 최후) → null(carryForward)`
   로 확장한다. KIS_PROXY 는 KRX_OTP **뒤**, KIS_ESTIMATE **앞**에 삽입(KRX-first 우선순위 유지).
   신규 `tryKrxShortViaKisProxy()` 는 `fetchKisDailyShortSale('069500')`(kisClient 단일통로)로
   `shortSaleRatio` 를 취득하고, 069500 미반환/null 시 `005930`(삼성전자) 로 1회 재시도한다
   (런타임 가정 견고화). 성공 시 `source='KIS_PROXY'`, `shortSellingFetchedAt` 갱신.

2. **ENV 게이트(byte-equivalent).** `SHORT_SELLING_KIS_PROXY_FALLBACK` default **OFF**
   (`=== 'true'` 일 때만 ON). OFF 면 KIS_PROXY 미호출 → 기존 3경로 폴백 그대로 → byte-equivalent.

3. **소비측 L4 격리(불변식 #7).** R5_CAUTION 8% 임계 평가(regimeEngine.classifyRegime 가
   regimeBridge.base.ts 를 통해 `shortSellingRatio > 8` 참조)는 source ∈ {KRX_DIRECT, KRX_OTP,
   KIS_PROXY}(L1) 일 때만 활성화한다. source ∈ {KIS_ESTIMATE, CACHE}(L4) 이면 영속 ratio 를
   임계 경계(8) 이하로 캡해 regime 강등 유발을 차단한다(source/fetchedAt 은 freshness·표시용
   보존). 이 캡 역시 동일 ENV 게이트 뒤에 두어 OFF 시 byte-equivalent 를 보장한다.
   regime 산출 자체(`regimeBridge.base.ts:78 ?? 5`)는 **무변경** — Trading Engine 생존(불변식 #1).

4. **타입 정식화.** `ShortSellingSource` union 에 `'KIS_PROXY'` 추가. `shortBackfill.cmd`(`/ssb`)가
   쓰던 `'CACHE' as any` 를 `'CACHE'` 정식 union 멤버로 승격(L4).

모든 KIS 호출은 kisClient 단일통로(`fetchKisDailyShortSale`) 경유 — raw KIS/KRX 신규 직접 호출
0건(불변식 #9). `fetchKisDailyShortSale` 본체는 **재사용만, 수정 0줄**.

## Consequences

- (+) ENV ON: KRX 두 경로 실패 시에도 KIS_PROXY(L1)로 `shortSellingFetchedAt` 갱신 →
  shortSelling STALE 해소, sourceHealth VERIFIED 복귀.
- (+) L4(KIS_ESTIMATE/CACHE) 의 R5 임계 누수 차단 — 불변식 #7 강화.
- (−) 프록시 ETF 1종 비중 = 시장 평균 근사(coverage 한계). 신뢰등급은 L1 유지.
- 069500 ETF 가 daily-short-sale 에서 `ssts_tr_pbmn_rlim` 를 반환한다는 전제는 런타임 확증
  대상이며, 005930 fallback 으로 완화한다.

### executionImpact

**NONE** (현재 SHADOW_ONLY, ENV OFF byte-equivalent).
- live 전환(`AUTO_TRADE_ENABLED=true` + execution 허용) 시: shortSelling STALE→VERIFIED 로
  `macroSignalConfidence` 상승 가능 + KIS 프록시 실측 비중이 8% 초과 시 R5_CAUTION 보조 발동으로
  regime 강등 가능 — 이것이 진짜 behavior change 이며 현 운영(SHADOW_ONLY)에선 **미실현**.
- LIVE 매매 본체(autoTradeEngine/exitEngine) 0줄 변경. KRX quota 0 신규 침범, KIS quota +1콜/일
  (LOW priority, daily-short-sale).

### 불변식 준수

- #1/#2: 폴백 실패는 carryForward(throw 금지) — 엔진/Shadow 생존.
- #6: KIS_PROXY 실패 시에도 `SHORT_SELLING_QUERY_FAILED` carryForward, marketSignal=false 유지
  (providerIssue ≠ bearish).
- #7: KIS_PROXY=L1, KIS_ESTIMATE/CACHE=L4 임계 평가 제외.
- #9: KIS 호출 kisClient 단일통로 경유, SourceSnapshot 우회 0건.

### Rollback

`SHORT_SELLING_KIS_PROXY_FALLBACK=false` (1줄) 즉시 복귀. ADR-0540 거래일-aware 분류 로직 무변경.
