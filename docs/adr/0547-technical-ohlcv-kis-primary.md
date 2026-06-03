# ADR-0547 (DRAFT) — 기술지표 OHLCV 시계열 1차 출처 KIS 일봉(L1) 승격, Yahoo(L3) fallback 강등

> 상태: DRAFT (Proposed). 정식 발급 번호 `0547` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0547"
> (2026-05-30 기준, 마지막 발급 0546). **INDEX.md 는 본 단계에서 갱신하지 않음**(설계 전용).
> 머지 시 INDEX.md §전체 인덱스 + docs/ai/10-patch-history-index.md 한 줄 추가 의무.
>
> 작성: 2026-05-31 / architect / 브랜치 claude/gemini-qualitative-evaluation-o3uHj
> 동반 산출물: `surface-map.md`, `patch-plan.md` (동일 폴더)

---

## Context

기술지표(RSI/MACD/볼린저밴드/VCP/일목/MA/ATR/return5d·20d/MTAS) 계산에 쓰이는 **OHLCV 시계열의
사실상 1차 출처가 Yahoo Finance `chart` 응답(range=1y, interval=1d)** 이다
(`server/screener/adapters/yahooQuoteAdapter.ts:331-377`, 산출식 551-745).

문제:
1. **데이터 신뢰등급 불일치** — 매매 결정에 영향을 주는 시계열 파생 지표가 L3(Yahoo)에서 산출된다.
   현재가(price)는 이미 KIS(L1) intraday로 보정되지만(line 325-486), *시계열 배열 자체는 Yahoo* 라
   MA/RSI/MACD/ATR/MTAS 등은 L3 출처에 종속.
2. **휴장/주말 취약점** — 휴장·주말에 Yahoo chart 경로가 EgressGuard/synthetic 503 등으로 막히면
   시계열 부재 → `buildKisPrimaryQuoteFromIntraday`(221-315)가 ma=0/rsi=50/macd=0 같은 **빈 지표**를
   반환하거나 `yahooDerivedIndicatorsReliable=false`로 강등 → evaluator 대량 PROVIDER_DEGRADED.
   반면 KIS FHKST03010100(`inquire-daily-itemchartprice`)는 **휴장에도 마지막 거래일 OHLCV를 정상
   반환**하므로 시계열 부재 자체가 발생하지 않는다.
3. **선례·재료 이미 존재 (★ KIS-first 빌더 완성품 존재)** —
   - `kisQuoteAdapter.buildExtendedFromKisDaily(candles, live)` (kisQuoteAdapter.ts:80-267) 가
     KIS 일봉 캔들 → `YahooQuoteExtended` 동등 객체를 **fetchYahooQuote와 동일 산식**(`_indicators.ts` 공유)
     으로 이미 산출(MA/RSI/MACD/ATR/atr5d/BB폭/return5d·20d/recent*10d/vol5d·20d/dailyVolumeDrying
     /월·주봉 다운샘플 MTAS 힌트). `dataQuality` 미설정 → 호출부에서 KIS_PRIMARY 부여.
   - `fetchKisQuoteFallback(code)` (kisQuoteAdapter.ts:278-339) 가 FHKST01010100(현재가) +
     FHKST03010100(일봉) 2단계 조회 후 빌더 합성을 묶어 **이미 "Yahoo 실패 시 1차 폴백"**으로
     stockScreener/buyPipeline/dryRunScanner/kisIntradayCorrection 등 trading 다수 경로가 사용 중.
   - `enrichQuoteWithKisMTAS`(kisQuoteAdapter.ts:465~, 월/주봉 정식 API + 6h `_mtasCache`)가
     BB폭/일목 MTAS 정밀값을 덮어씀(빌더 다운샘플 힌트 보강).
   - **함의:** 본 변경은 신규 계산 엔진 구축이 아니라 **출처 우선순위(라우팅) 전환**이다 —
     `fetchKisQuoteFallback`를 fallback이 아니라 primary로 호출 순서를 뒤집는 것.

제약(불변식):
- quote(현재가) fallback 라우터 SSOT `KIS_QUOTE > KIS_CACHED > KRX > YAHOO > CONFIDENCE_LOW`
  (docs/ai/05-provider-policy.md "절대 변경 금지")는 **현재가 한 점**용이며,
  endpoint도 `inquire-price`(FHKST01010100)로 시계열 endpoint(FHKST03010100)와 별개 →
  본 변경과 **직교**(surface-map §5).
- 불변식 #4: 휴장 시 KIS 일봉 참조는 OK이나 SourceSnapshot 변경·매매 트리거화 금지.
- 불변식 #6: provider 장애를 약세 신호로 전환 금지(KIS-first가 오히려 위험 감소).
- KIS 호출은 kisClient 단일 통로(`realDataKisGet`) 경유만. raw REST 금지.

## Decision

기술지표용 **OHLCV 시계열의 1차 출처를 KIS 일봉(L1)으로 승격**하고 Yahoo chart(L3)를
**fallback으로 강등**한다. 현재가(price) 한 점의 출처·라우터는 변경하지 않는다.
구현은 **신규 계산 엔진 없이 기존 빌더(`fetchKisQuoteFallback`/`buildExtendedFromKisDaily`)의
호출 우선순위만 전환**한다(surface-map §0-#5 / §8 선택지 C 채택).

1. **신규 얇은 라우터 — `server/screener/adapters/technicalQuoteRouter.ts`**
   - 책임(@responsibility ≤25단어): "기술지표 quote 출처 라우터 — ENV KIS-first 시 KIS 일봉 1차,
     Yahoo chart fallback. 신규 계산 없음, 기존 빌더 재사용."
   - export `fetchTechnicalQuote(code, symbol, opts?): Promise<YahooQuoteExtended | null>`.
   - KIS-first 적용 경로(ENV ON) → `fetchKisQuoteFallback(code)`(6h 캐시 히트 우선) 먼저,
     실패/봉수부족 시 `fetchYahooQuote(symbol)` fallback. 그 외(스캔 등) → 기존 순서(Yahoo first) 유지.
   - BB폭/MTAS 정밀값 결손은 `enrichQuoteWithKisMTAS`로 보강(기존 함수 재사용).
2. **진입점 재배선(경로별 1줄씩)** — Phase 1: prefetchedContext.ts:61(정밀/AI), 단일 종목 정밀 평가 경로가
   라우터를 KIS-first 모드로 호출. universeScanner/stockScreener 풀스캔은 Decision §8에 따라 Yahoo 우선 유지.
   - `fetchYahooQuote`/`fetchKisQuoteFallback` 본체·산식 무변경. 출력 타입 `YahooQuoteExtended` 동일.
   - 현재가/divergence/recovery 로직(yahooQuoteAdapter 419-508)은 무변경(quote 경로 직교).
3. **marker 정합(필드명·리터럴 유지)**
   - KIS-first 정상흐름은 `dataQuality:'KIS_PRIMARY'` + `priceProvider:'KIS_PRICE'`로 표기.
   - stockScreener 596 강등 분기(`KIS_PRIMARY_YAHOO_STALE_DETECTED`)는 divergence 감지 전용 유지 —
     KIS-first 정상흐름이 이 분기로 새지 않게 검증. `yahooDerivedIndicatorsReliable`은 KIS 경로에서
     의미 모호하므로 dataQuality/priceProvider로 일관 표기(필드명 변경 없음). 목표: 강등 소비 **0줄**.
4. **타입 — 신규 최소화** — 출력은 기존 `YahooQuoteExtended`(SSOT) 재사용(빌더가 이미 반환).
   라우터 진단용 `TechnicalQuoteSource = 'KIS_DAILY' | 'YAHOO_CHART' | 'CACHE'`만 라우터 로컬 정의
   (서버 전용; `src/types/` 승격 불요). 향후 공유 필요 시 승격.
5. **ENV 안전 스위치(byte-equivalent 롤백)** — `KIS_OHLCV_PRIMARY_ENABLED`.
   - default OFF(Phase 1) → 기존 Yahoo-first 동작 보존(회귀 0). ON 시에만 KIS-first.
   - 1줄 토글로 즉시 롤백(CLAUDE.md §5 byte-equivalent 원칙).
6. **쿼터 안전장치(필수)** — surface-map §7 우려 구간 대응:
   - 일봉 6h 캐시(MTAS `_mtasCache` 패턴) + 휴장 인지 TTL 연장(휴장 중 동일 마지막거래일 일봉 0콜 재사용).
   - 기존 `isKisChartCooldownActive(...'DISCOVERY')`(stockScreener 562-575) cooldown 인프라 재사용.
   - 스캔 배치 throttle(setTimeout 100ms, kisChartDataFetcher 155-157) + `__kisPurpose:'DISCOVERY'` 버킷.
7. **공식 스펙 기반 쿼터 분석 (FHKST03010100 — 100건/호출 제약)**
   KIS 공식 레퍼런스(`examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py`)
   docstring: *"실전계좌/모의계좌의 경우, 한 번의 호출에 최대 100건까지 확인 가능합니다."*
   현 코드 `kisChartDataFetcher.ts:81-82`가 이미 동일 TR(FHKST03010100)·동일 endpoint 사용 중이므로
   **본 변경은 신규 TR 채택이 아니라 기존 TR의 소비 범위 확대**다(API 계약 무변경).
   - **함의 1 — 종목당 period별 1콜로 모든 일봉 지표 충족:** 일봉 100건이면 RSI14/MACD/BB20/MA60/
     return5d·20d 전부 1회 호출로 충분. 주봉 RSI(45영업일 ≈ 9주)·MTAS 월봉 24개·주봉 78주도
     모두 100건 이내 → **종목당 period(D/W/M)별 정확히 1 call** 로 산출 완결.
   - **함의 2 — 캐시 재사용으로 신규 호출 최소화:** MTAS 6h 캐시(`_mtasCache`) 패턴을 일봉에도 복제하면
     동일 종목 재평가·prefetchedContext 재호출은 0콜. 휴장 인지 TTL 연장 시 휴장 중 0콜.
   - **함의 3 — 풀스캔이 유일한 quota 압박 구간:** 100건 제약 자체는 단일 종목 산출에 무해하나,
     universe 수백~수천 종목을 universeScanner에서 **일괄 per-symbol 호출하면 TR throttle/일일 quota
     위험**(surface-map §7-#1). 즉 위험은 "1콜의 크기"가 아니라 "콜의 개수(종목 수)"다.
8. **단계별 차등 KIS-first (quota 압박 완화 정책 — Decision 채택)**
   전 종목 풀스캔까지 무차별 KIS-first로 전환하지 않고, **경로별로 KIS-first 적용 단계를 차등**한다:
   - **스캔 단계(universeScanner 풀스캔) = Yahoo 우선 유지(기본).** 종목 수 = 콜 수 폭증 구간이므로
     KIS-first 미적용(또는 캐시 히트 한정). 휴장·Yahoo 차단 시에만 KIS fallback.
   - **정밀/AI 해석/보유관리 경로 = KIS-first 우선 적용.** prefetchedContext(Gemini 주입)·
     단일 종목 정밀 평가·보유 포지션 관리처럼 **대상 종목 수가 적고 신뢰도가 중요한 경로**부터
     KIS 일봉 1차로 승격. 콜 수가 본질적으로 적어 quota 안전.
   - 이 차등은 `KIS_OHLCV_PRIMARY_ENABLED`(전역 OFF default) 하위에서 경로 플래그로 단계 분리 가능
     (Phase 1 = 정밀 경로만 ON → 관측 → Phase 2 = 캐시 검증 후 스캔 경로 확대). engine-dev가
     경로별 플래그 입도를 patch-plan §3 범위 내에서 결정.

## Consequences

긍정:
- 시계열 파생 지표 출처 L3 → L1 승격(매매 결정 입력 신뢰도 향상).
- 휴장/주말 Yahoo 차단 취약점 제거(KIS는 마지막 거래일 OHLCV 정상 반환).
- 신규 지표 계산 0(기존 빌더 재사용) — yahooQuoteAdapter 841줄 무변경, 산식 중복 회피.
- provider 장애(Yahoo)가 약세 신호로 전환되던 잔존 경로 축소(불변식 #6 강화).

부정/리스크:
- **KIS 쿼터·throttle 신규 소비** — 공식 스펙상 1콜=최대 100건이라 단일 종목 산출은 1콜로 무해하나,
  **풀스캔의 콜 개수(=종목 수) 폭증이 최대 위험**(surface-map §7-#1). Decision §8 단계별 차등
  KIS-first(스캔=Yahoo 우선 유지, 정밀/보유관리=KIS-first)로 압박 구간을 구조적으로 회피.
  캐시·배치·휴장 TTL 미비 시 단일 무차별 스캔이 일일 quota 압박.
- KIS 수정주가/원주가(`FID_ORG_ADJ_PRC`) 정책이 Yahoo 조정값과 미세 괴리 가능 → 지표 값 소폭 변동
  (회귀 테스트로 허용 오차 범위 확정 필요).
- marker 의미 재정의가 stockScreener 강등 로직과 정합해야 함(필드명 유지로 완화).
- 휴장 시 KIS 일봉 참조가 매매 트리거로 새지 않도록 불변식 #4 가드 유지 필요.

중립:
- 현재가 라우터 SSOT 0줄 변경(직교). SourceSnapshot/Trading Engine/Shadow 본체 0줄.
- ENV default OFF → 머지 즉시 동작 변화 없음(Phase 2에서 ON 전환·관측).

## Alternatives Considered

1. **선택지 A — yahooQuoteAdapter 내부 인라인 스왑** — closes/highs/... 추출만 KIS 우선으로 교체.
   다운스트림 변경 0이나 841줄 함수 비대화 + 기존 빌더(`buildExtendedFromKisDaily`)와 산식 중복 → 기각.
2. **선택지 B — 배열만 반환하는 ohlcvSeriesProvider 신규** — 빌더가 이미 "배열→객체"를 수행하므로
   중복 경계 → 기각(선택지 C가 우월).
3. **현재가 라우터에 시계열을 합치기** — 라우터 SSOT "절대 변경 금지" 위반 + 의미 혼선(한 점 vs 배열) → 기각.
4. **KIS 전면 전환(Yahoo 제거)** — 휴장 외 평상시 quota 부담 과대 + Yahoo per/일부 메타 상실 →
   fallback 보존이 안전. 기각.
5. **MTAS 일봉 다운샘플로 주/월봉 흡수** — 정식 KIS 주/월봉 vs 다운샘플 정확도 트레이드오프.
   Phase 1 보류, Phase 2 후보(quota 추가 절감용).

---

## R1 Extension (2026-06-03 / architect) — code-진입 byte-equivalent 라우터 진입점

> 본 확장은 ADR-0547 DRAFT 본체를 계승·강화한다(신규 ADR 번호 미발급 — 0547 DRAFT 흡수, INDEX
> "한 줄" 룰 유지). ADR-0561(KIS-primary 절대불변식)의 grandfather burn-down 을 byte-equivalent
> 하게 가능케 하는 라우터 진입점 계약을 확정한다. 런타임 .ts 0줄(설계 전용) — 구현은 후속 engine-dev.
> 근거 진단: `_workspace/2026-06-03_factory-activation/engine-dev/MEMO-step3-router-flagoff-byte-equivalence-VERDICT.md`(case b).

### RX-A. funnel 의 KIS/Yahoo 분할 — 확정 판정

grandfather callsite (`fetchYahooQuoteByCode(code, fetchYahooQuote)` =
`fetchYahooQuoteWithMarketFallback`, yahooSymbolResolver.ts:63) 의 실제 출처 분할:

| 데이터 | 1차 출처 | 근거 |
|--------|----------|------|
| 현재가 price/prevClose/dayOpen/changePercent/volume | **이미 KIS(L1)** | funnel ①단계 `fetchKisQuoteFirst → fetchKisQuoteFallback(code)`(yahooSymbolResolver.ts:80-91) 가 sane 시 그대로 반환. 이 경로의 quote 는 FHKST01010100 라이브 + (sane 시) FHKST03010100 일봉 파생까지 **전부 KIS** (kisQuoteAdapter.ts:278-342). 또한 KIS quote 미sane 으로 Yahoo 분기 진입해도 `fetchYahooQuote` 내부 `fetchKisIntraday` 보정으로 price 한 점은 KIS 우선. |
| 기술지표 ma/rsi/macd/atr/MTAS/return5d/20d/BB폭 | **KIS sane 시 KIS, 미sane 시 Yahoo(L3) OHLCV 파생** | KIS quote 가 sane(`dataQuality !== 'STALE_BASE'`)이면 `buildExtendedFromKisDaily` 산출값(KIS 일봉)으로 반환. 미sane 이면 `fetcher(resolved=fetchYahooQuote)` → Yahoo chart OHLCV 파생 지표로 fallback. |

**확정:** 현 callsite 의 진짜 L3 의존 = **기술지표(Yahoo OHLCV 파생), 그것도 "KIS quote 미sane 일 때만"**.
가격은 이미 KIS-primary. 따라서 ADR-0561 가드가 grandfather 를 "Yahoo-first 위반"으로 지목한 정확한
대상은 **(가격이 아니라) KIS quote 미sane fallback 구간의 기술지표 산출**이다 — 위반은 기술지표 한정.

> 함의: 현 callsite 는 이미 부분적으로 KIS-first 다(가격 + KIS-sane 시 지표). 따라서 R1 의 flag-OFF
> 위임은 "Yahoo-first 를 그대로 보존"이 아니라 **"이미 funnel 에 내장된 KIS-first(부분) 동작을 byte-equal
> 보존"** 이다. flag-ON 은 미sane fallback 구간의 Yahoo 기술지표마저 KIS 일봉으로 끌어올린다.

### RX-B. R1 설계 — `fetchTechnicalQuoteByCode` byte-equivalent 진입점

**위치 결정: technicalQuoteRouter.ts 확장**(yahooSymbolResolver 인접 신규 아님).
근거 — adapter 경계: 라우터(technicalQuoteRouter)는 이미 ADR-0547 이 "기술지표 quote 출처 라우팅"
단일 책임을 소유한다. code→symbol resolve 위임 funnel(yahooSymbolResolver)과 KIS-first 라우팅은 직교
책임이며, R1 은 후자(라우팅)의 code-진입 변형이므로 라우터에 귀속한다. yahooSymbolResolver 는 "symbol
변환 + fetch 폴백 SSOT"(ADR-0231) 책임이 고정되어 KIS-first 라우팅을 추가하면 책임 비대.

**신규 export 계약:**

```ts
// technicalQuoteRouter.ts
export async function fetchTechnicalQuoteByCode(
  code: string,
  opts?: FetchTechnicalQuoteOptions,   // { kisFirst?: boolean }
): Promise<YahooQuoteExtended | null>;
```

- **flag OFF**(`opts?.kisFirst !== true && KIS_OHLCV_PRIMARY_ENABLED !== 'true'`):
  내부에서 **`fetchYahooQuoteByCode(code, fetchYahooQuote)` 를 그대로 호출·반환** → byte-equal.
  보장 항목: (1) 호출 수 동일(funnel 1회), (2) 반환 타입 `YahooQuoteExtended` 동일,
  (3) `yahooFreshnessLedger` 부수효과(ADR-0255) 동일, (4) dataQuality/priceMetadata marker 동일,
  (5) .KS↔.KQ sanity fallback(ADR-0241) 동일, (6) KIS-first 부분 동작(funnel ①) 동일.
  → callsite `fetchYahooQuoteByCode(code, fetchYahooQuote)` → `fetchTechnicalQuoteByCode(code)`
  1줄 치환이 **동작 불변**.
- **flag ON**: KIS 일봉 OHLCV 로 기술지표 산출(ADR-0547 자산 `fetchKisQuoteFallback` →
  `buildExtendedFromKisDaily` → `enrichQuoteWithKisMTAS` → `withKisPrimaryMarker` + 6h/휴장 TTL 캐시).
  가격은 KIS-first 유지, Yahoo 는 KIS 불가(null/봉수부족) 시에만 fallback(ADR-0561 절대불변식).
  flag ON 경로는 기존 `fetchTechnicalQuote`(symbol-진입)의 KIS-first 분기를 재사용하되, symbol 이
  필요한 Yahoo fallback 구간에서는 내부에서 `fetchYahooQuoteByCode(code, fetchYahooQuote)` funnel 로
  위임해 resolve 책임을 호출처에 전가하지 않는다(code-진입 계약 일관성).

**구현 형태(engine-dev 재량 범위 — 의사 계약):**
```ts
export async function fetchTechnicalQuoteByCode(code, opts) {
  const kisFirst = opts?.kisFirst === true || isKisPrimaryEnvEnabled();
  if (!kisFirst) {
    return fetchYahooQuoteByCode(code, fetchYahooQuote); // ← byte-equal funnel 위임
  }
  // KIS-first: 캐시 → fetchKisQuoteFallback(code) → enrich → marker → 캐시.
  // KIS 불가 시: fetchYahooQuoteByCode(code, fetchYahooQuote) funnel 로 fallback.
}
```
(`fetchYahooQuoteByCode`·`fetchYahooQuote` import 신규 — 순환 회피: yahooSymbolResolver 는
yahooQuoteAdapter 를 type-only import 하므로 라우터에서 양쪽 value import 안전.)

### RX-B2. 옵션 R2(라우터 flag-OFF fallback 을 resolver 로 교체) — 기각

R2 는 기존 `fetchTechnicalQuote`(symbol-진입)의 flag-OFF `fetchYahooQuote(symbol)` 2곳(113-116, 154)을
`fetchYahooQuoteByCode(code, fetchYahooQuote)` 로 치환하는 안. **기각 근거:**
- 유일 현 소비자 `prefetchedContext.ts:63` 의 flag-OFF 동작을 바꾼다 — 현재 raw `fetchYahooQuote(symbol)`
  (호출처가 `ref.symbol ?? tryGetYahooSymbol ?? '${code}.KS'` 로 resolve, line 58) → resolver funnel 경로로
  전환되어 ledger 부수효과·sanity fallback·marker 가 회귀. byte-equivalent 위반(현 소비자 동작 변경).
- R1 은 신규 export 추가(기존 `fetchTechnicalQuote` 무변경)이므로 prefetchedContext 회귀 0.
  → R2 기각, R1 채택.

### RX-C. ③ 치환 규약 (grandfather burn-down)

R1 발급 후 grandfather callsite 를 byte-equal 1줄 치환:
```
- fetchYahooQuoteByCode(code, fetchYahooQuote)   →   fetchTechnicalQuoteByCode(code)
```
- import 도 `yahooSymbolResolver` → `technicalQuoteRouter` 로 1줄 교체.
- 치환 PR 마다 `scripts/check_kis_primary_invariant.js` 의 `GRANDFATHER_ALLOWLIST` 에서 해당 파일 항목
  제거(burn-down) → 가드 진행률 추적(현 10 file-entries / 11 invocations).
- **최고위험 `stockScreener.ts:577`(메인 Gate full-scan quota)는 본 규약 비대상** — quota cache 워밍 +
  shadow A/B 허용오차 확정 후 별도 PR(ADR-0561 D2/0547 Decision §8 스캔 단계 정책).
- 저위험 우선 치환 후보(quota 압박 적음·소비 종목 수 적음): `shadowDataGate.ts:70`(shadow 샘플,
  실거래 무관·불변식 #8 분리), `reportGenerator.ts:622`·`stockPickReporter.ts:108/179`(알림 리포트,
  Gate 매매결정 비입력). 그다음 `buyPipeline/trancheExecutor/dryRunScanner/kisIntradayCorrection/
  preBreakoutAccumulation/intradayScanner`(per-symbol, full-scan 아님) 순.

### References

- surface-map: `_workspace/2026-05-31_kis-ohlcv-primary/surface-map.md`
- patch-plan: `_workspace/2026-05-31_kis-ohlcv-primary/patch-plan.md`
- `server/screener/adapters/yahooQuoteAdapter.ts` (지표 산출 SSOT, line 36-145 타입 / 317-841 함수)
- `server/screener/kisChartDataFetcher.ts` (KIS 일봉/주봉/월봉 + 6h 캐시, line 70-248)
- `server/screener/adapters/kisQuoteAdapter.ts` (★ KIS-first 빌더 SSOT — buildExtendedFromKisDaily:80-267,
  fetchKisQuoteFallback:278-339, enrichQuoteWithKisMTAS:465~)
- `server/screener/adapters/_indicators.ts` (Yahoo·KIS 공용 산식 SSOT)
- `server/ai/prefetchedContext.ts` (기술지표 소비 진입점, line 19/61/143-152)
- `server/screener/stockScreener.ts` (577 fetchYahooQuoteByCode 진입 + 589-650 divergence/강등 + 562-575 cooldown)
- docs/ai/05-provider-policy.md (quote fallback 라우터 SSOT — 변경 금지)
- 관련 ADR: 0411(KIS recovery·yahooDerivedIndicatorsReliable), 0234/0235(Yahoo self-id/stale),
  0221(prevClose KIS 1차), 0082(Yahoo range ≤1y), 0518(rawPrices), 0011(aiUniverse 단일통로)
- **KIS 공식 레퍼런스(스펙 1, 외부 문서 — repo 미포함):** KIS Open API "국내주식기간별시세(일/주/월/년)"
  — TR `FHKST03010100`, endpoint `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,
  params `FID_COND_MRKT_DIV_CODE`(J:KRX/NX:NXT/UN:통합)·`FID_INPUT_ISCD`·`FID_INPUT_DATE_1/2`·
  `FID_PERIOD_DIV_CODE`(D/W/M/Y)·`FID_ORG_ADJ_PRC`(0:수정주가/1:원주가), 응답 output1(종목정보)+output2(일별 OHLCV 배열),
  **★최대 100건/호출**. 현 `kisChartDataFetcher.ts`가 이미 이 TR 사용 중(계약 무변경).
- **후속 ADR 후보:** 휴장 취약점(본 ADR Context §2 동기)의 권위 있는 해법 = KIS 공식
  `chk-holiday`(CTCA0903R) → **별도 ADR-0548(예정)** 로 분리(도메인 = calendar/market-clock,
  Patch Scope Guard 3도메인 한계 준수). surface-map §10 Follow-up 단락 참조.
