# ADR-0529: DART Financials Canonical Inclusion into SourceSnapshot

@responsibility trading — DART Financials Canonical Inclusion into SourceSnapshot

## Status

Proposed

## Context

Canonical Data SSOT 통일(ADR-0519 SourceSnapshot · ADR-0525~0528) 결과 supply·price·PER 입력은 정본
`UnifiedSourceSnapshot.perSymbol`(`SymbolSnapshotData`)을 소비한다. **마지막 갭 = Gate2 DART 재무.**

현재 DART 경로는 정본을 우회한다:

- 수집·판정 단일 read = `gate2ExternalDataProvider.ts` `getGate2DartFinancialsForEvaluation(symbol)`.
  이 함수는 **cache-first** — `gate2ExternalCache`(`data/gate2-external-cache.json`, version 1, 500 cap,
  7일 STALE) 에 `confidence ≠ MISSING` 레코드가 있으면 그것을 반환, 없으면 `getDartFinancials(symbol)`
  (raw `opendart.fss.or.kr` HTTPS, `fetchWithRetry` callerLabel `gate2-dart-financials`) 로 fallback fetch
  후 캐시 upsert.
- read site 4곳: `buyPipeline.ts:115` · `preBreakoutEntry.ts:275` · `kisIntradayCorrection.ts:66` ·
  `universeScanner.ts:615` — 전부 `SymbolSnapshotData` 가 아니라 위 함수를 직접 호출.
- 정본 컨테이너 `SymbolSnapshotData` 는 quote/investorFlow/dailyBars/programTrade 4종 KIS 만 보유,
  **DART 슬롯 없음**. `symbolDataCollector` 는 종목당 4 KIS 엔드포인트만 수집.

DART 재무는 **L2 등급**(분기 공시, intraday 변동 없음). KIS quote/supply(intraday-fresh)와 cadence 가
근본적으로 다르다. per-scan re-fetch 는 opendart quota 낭비이며, 위 cache-first 가 이미 사실상
quarterly-survivable last-good-value 저장소다. 본 ADR 은 **DART 슬롯을 정본에 편입하되 기존 캐시를
정본 슬롯의 backing store 로 재해석**하는 경계를 확정한다.

선례: PER dedup(`perValuation.ts`, `USE_UNIFIED_SOURCE_SNAPSHOT` gate)이 동일 FHKST01010100 정본 quote
재사용으로 재호출을 제거하고 `buildPerValuationFromOutput` 공유로 byte-equivalent 를 보장한다.

## Decision

1. **타입** — `SymbolSnapshotData` 에 optional 슬롯 `dartFinancials?: SymbolDartFinancialsSlot | null` 추가.
   슬롯 payload 는 기존 `Gate2DartEvaluationFinancials`(= `DartFinancials | QmpDartFinancials`)을 **재사용**
   (별도 정본 타입 신설 0) + 정본 메타(`fetchedAt` / `cadence: 'QUARTERLY_CACHED'` / `source` / `cacheHit`).
   `symbolSnapshotData.ts` 는 타입 계약만 — null 은 "정본 DART 미수집"(Gate 가 기존 read 로 fallback).

2. **Cadence — cached-reference (분기) 채택, per-scan 수집 기각**(§Alternatives). collector 는 KIS 4 호출은
   per-scan 유지하되 **DART 는 `getGate2DartFinancialsForEvaluation` 의 cache-first 경로를 그대로 호출**
   (cache hit = 외부호출 0). collector 가 정본 슬롯을 채우는 것은 cache read 한정이며, miss 시 1회 fetch 는
   기존 함수 내부 정책(분기 cadence·STALE 7일) 그대로 — collector 가 별도 fetch 로직을 신설하지 않는다.

3. **quota 가드레일** — (a) cache-first: hit 면 외부호출 0. (b) collector 의 DART read 는 `try/catch` 격리
   (실패가 4 KIS 수집·scan 을 막지 않음, 불변식 #1). (c) 비영업일/장전 skip 은 기존 호출자 게이팅 유지.
   (d) 분기 변동 없으면 캐시 STALE(7일) 도달 전까지 재fetch 0. → 종목당 추가 외부호출 = cache hit 시 0,
   miss 시 ≤1(기존과 동일, 신규 quota 침범 0).

4. **소비 정합 — byte-equivalent** — read site 는 `USE_UNIFIED_SOURCE_SNAPSHOT=true` 또는 정본 슬롯
   non-null 일 때 `snapshot.perSymbol[code].dartFinancials` 를 read, 아니면 기존
   `getGate2DartFinancialsForEvaluation` 호출(100% fallback). 동일 함수가 슬롯·fallback 양쪽의 값 출처라
   DART 값·Gate2 판정 불변. PER dedup 의 `synthesizePerOutputFromSnapshotQuote` 와 동형 패턴.

5. **flag/fallback** — flag OFF 또는 cache miss(슬롯 null) 시 기존 독립 경로 100% 유지. LIVE Gate2 런타임
   동작은 본 단계(설계)에서 0 변경.

## Consequences

- (+) DART 가 정본 4종 데이터와 동일 컨테이너에 편입 → Gate2 가 단일 SourceSnapshot 에서 출발(불변식 #3).
- (+) 종목당 DART 외부호출 0~1 유지(quota 무회귀). 분기 cadence 와 intraday cadence 가 한 컨테이너 안에서
  메타(`cadence`)로 명시 구분 → 신선도 혼동 방지.
- (+) read site 4곳이 점진적으로 정본 슬롯 read 로 수렴 → 우회 경로 축소.
- (−) `SymbolSnapshotData` 가 L1(KIS)·L2(DART) 혼재 컨테이너가 됨 — 슬롯 메타 `cadence`/`source`/`confidence`
  로 등급 분리 필수(L2 가 L1 신선도로 오인되지 않게). 불변식 #7(L4 격리) 무관(DART=L2).
- (−) cache-first 의존 → 캐시 부재 cold-start 시 슬롯 null(기존 fallback 동작과 동일, 회귀 0).
- engine-dev 단계: 타입 slot 추가 → collector cache-read 주입 → read site flag-gated 재바인딩 → 회귀 테스트.

## Alternatives Considered

- **A: per-scan 수집** — collector 가 종목당 DART 를 매 scan fetch. 기각: L2 분기 데이터를 intraday cadence
  로 끌어와 opendart quota 를 종목수×scan 빈도로 침범, 분기 내 동일값 재fetch 낭비. 불변식 #1 위험(느린 외부
  호출이 4 KIS 수집 지연).
- **B(채택): cached-reference(분기 cadence)** — 기존 cache-first 를 정본 슬롯 backing 으로 재해석. quota 무회귀,
  cadence 명시 분리, byte-equivalent.
- **C: 신규 정본 DART 타입 신설** — 기각: `Gate2DartEvaluationFinancials` 재사용으로 충분, 중복 선언 = 7대
  단일 통로 위반 위험.

## Guardrails

- No live trading path change unless explicitly stated. (본 단계 LIVE Gate2 런타임 0 변경)
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated. (byte-equivalent, DART 값·판정 불변)
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated. (cache-first·cadence·callerLabel 불변)
- No data promotion behavior change unless explicitly stated.
