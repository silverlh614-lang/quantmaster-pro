# ADR-0536: Yahoo quoteSummary 기반 PER/EPS Opportunistic Enrichment

@responsibility discovery enrichment — 종목 카드 PER/PBR N/A 감소를 위한 Yahoo quoteSummary 보조 소스 설계 (PENDING_WIRING C18)

## Status

Accepted (Phase 1 wired, ENV default OFF — 2026-05-30).

- Phase 0 (이 ADR 머지 시점, 2026-05-27): 설계 문서만, 코드 0줄.
- **Phase 1 (현재, 코드 wired)**: `server/screener/adapters/yahooQuoteSummary.ts` 신규 + `/api/ai-universe/snapshot` 라우트가 Naver per/pbr ≤ 0 시 quoteSummary 폴백, 응답에 `perSource` 동봉. 클라이언트 타입(`AiUniverseValuation.perSource`, `StockRecommendation.valuation.perSource`) + `enrichment.ts` carry. ENV `YAHOO_QUOTE_SUMMARY_PER_ENABLED=true` 명시 활성화 — **default OFF 면 fetchYahooQuoteSummary 가 즉시 null 반환(외부 호출 0건, byte-equivalent)**. 11 mocked adapter tests + 기존 enrichment regression pass.
- Phase 2 (후속): 운영자 staging 검증(샘플 코드 PER 대조 + 부재율 감소 확인) 후 ENV 활성화 / 카드에 perSource 툴팁 표시 / SymbolMarketRegistry 결합으로 .KS/.KQ 시도 1발 정확화 / 배치 `/snapshots` 경로 확장 — 운영 데이터 누적 후 별도 PR.

## Context

`UI_WIRING_MATRIX.md` §9.1 사용자 보고: 종목 카드 VALUATION MATRIX 의 P/E·P/B 가 대형주(현대차·SK하이닉스 등)에서도 `N/A` 다발.

정적 추적으로 확인된 데이터 흐름:

1. 탐색 enrichment 의 PER/PBR 1차 소스는 **Naver 모바일 snapshot** 이다. 클라이언트 `enrichment.ts:fetchKrxValuation` → 서버 `/api/ai-universe/snapshot` (`aiUniverseService` Naver enrichment, ADR-0011 통로) → `per/pbr/marketCap` 매핑. 카드는 `valuation.per>0` 일 때만 값 표시, 아니면 `N/A`(`WatchlistCard.tsx:826-827`).
2. **Yahoo chart API**(`yahooQuoteAdapter.ts`, range/interval OHLCV)는 PER/PBR 을 신뢰성 있게 제공하지 않는다. `YahooQuoteExtended.per`(주석 "Yahoo 제공 시")는 chart meta 에 거의 부재 → 0.
3. 따라서 Naver snapshot 이 특정 코드에 `per/pbr=0` 을 반환하면(모바일 endpoint 파싱 한계 / 필드 부재) PER/PBR 은 다른 보강 소스가 없어 그대로 `N/A` 가 된다. **클라이언트 wiring 결함이 아니라 데이터 소스 한계.**

데이터 신뢰등급(§2.3): Yahoo = L3, Naver = L3. PER/PBR 은 현재도 L3(Naver) 입력으로 카드 표시 + Gate2 보조 입력에 쓰인다. 본 ADR 은 **동일 L3 등급 안에서 보조 소스를 1개 추가**하는 것이며 L1/L2 승격이 아니다(불변식 #7 — L4 만 live 매매 결정 금지, L3 는 기존 정책 유지).

정책 경계: ADR-0011 (탐색 universe·enrichment 는 KIS/KRX 비의존, Google/Naver/Yahoo 통로). Yahoo 는 이미 탐색 경로의 정규 소스이므로 Yahoo quoteSummary 추가는 ADR-0011 과 정합한다. 대안 소스 **KIS 기업정보 API(PENDING_WIRING B10)** 는 ADR-0011 의 "탐색 경로 KIS 비의존" 정책 + 자동매매 quota 침범 위험으로 기각/보류한다.

## Decision

종목 탐색 enrichment 에 **Yahoo quoteSummary 를 opportunistic 보조 소스**로 추가해 PER/PBR/EPS N/A 를 감소시킨다. 핵심 원칙: **fail-soft + 출처 명시 + ENV default OFF + 기존 통로 경유**.

### 1. 소스·필드 매핑 (보조 추가, 1차 Naver 유지)

- Yahoo quoteSummary 모듈: `summaryDetail`(`trailingPE`/`forwardPE`/`priceToBook`), `defaultKeyStatistics`(`forwardPE`/`priceToBook`), `financialData`(보조). 심볼은 KRX 접미사 사용(`005380.KS` / `196170.KQ`).
- 우선순위: **Naver snapshot(per>0) → Yahoo quoteSummary(trailingPE>0) → N/A**. Naver 가 유효값을 주면 그대로 사용(현행 무변경), Naver 가 0/부재일 때만 Yahoo quoteSummary 로 보강.
- EPS: `epsTrailingTwelveMonths` 보조 — 현행 카드 EPS 타일은 `epsGrowth`(DART) 표시이므로 본 필드는 PER 산출 검증·`per evaluator` DATA_UNAVAILABLE 원인 분리에만 사용(표시 추가는 후속 결정).

### 2. 출처 명시 (provenance)

- `valuation.perSource` 신규 옵셔널 필드: `'NAVER_SNAPSHOT'` / `'YAHOO_QUOTE_SUMMARY'` / `'YAHOO_CHART_META'` / `'UNAVAILABLE'`. 카드/진단이 PER 출처를 표기 가능 → `per evaluator` 의 `DATA_UNAVAILABLE` vs `THRESHOLD_NOT_MET` 구분에 기여(PENDING_WIRING C16/C18 연계).

### 3. 단일 통로·캐시·가드 계약

- 호출은 **기존 Yahoo 어댑터 단일 통로**(`server/screener/adapters/yahooQuoteAdapter.ts`) + `egressGuard`(guardedFetch) 경유. raw 외부 fetch 신규 도입 금지.
- IntentTag = `HISTORICAL`(ADR-0058) — 펀더멘털은 분기 단위 갱신이라 장 시간과 무관. TTL 5분(positive) + Negative cache 30분(부재 코드 재호출 억제). 동일 코드 중복 호출은 `_valuationCache` 패턴 재사용.
- OHLCV chart 호출과 **독립** — quoteSummary 실패해도 가격/지표 enrichment 는 그대로 성공(fail-soft). PER 만 `UNAVAILABLE` 로 남는다.

### 4. ENV gate (기본 OFF)

- `YAHOO_QUOTE_SUMMARY_PER_ENABLED=true` 명시 활성화(default OFF). 운영자가 quota·정합 검증(샘플 코드 PER 대조 + 부재율 감소 확인) 후 활성화. OFF 상태에선 현행과 byte-equivalent(quoteSummary 호출 0).

## Consequences

**긍정**
- 대형주 PER/PBR N/A 다발 감소 → §9.1(b) 사용자 보고 직접 대응.
- `perSource` 로 PER 부재 원인이 진단 가능 → `per evaluator` DATA_UNAVAILABLE 정합(C16/C17 연계).
- Yahoo 단일 통로·egressGuard·캐시 재사용으로 외부 호출 표면 최소.

**부정 / 리스크 (격리책)**
- 추가 외부 호출 → quota/latency. → opportunistic(Naver 우선) + TTL/Negative cache + ENV default OFF 로 격리. OFF 시 호출 0.
- Yahoo quoteSummary 안정성(rate-limit/차단/스키마 변동). → fail-soft(가격/지표 enrichment 무영향), 실패 시 `perSource='UNAVAILABLE'`.
- 데이터 정합(Yahoo PER 기준일·통화·결산 시점이 Naver/KRX 와 상이). → L3 등급 유지(표시·Gate2 보조 한정), `perSource` 표기로 사용자/진단이 출처 인지.

**executionImpact: NONE**
- PER/PBR 은 표시 + Gate2 보조 입력(현행 Naver L3 와 동일 등급). LIVE 주문 경로(autoTradeEngine/kisClient) 무변경, SourceSnapshot·executionPermission 무변경. 본 ADR 머지로 코드/런타임 변경 0건(설계 only). 활성화는 ENV `=true` + 후속 wiring PR + 운영자 승인.

## 후속 (PENDING_WIRING C18 wiring PR)

1. `yahooQuoteAdapter` 에 `fetchYahooQuoteSummary(code)` 추가(quoteSummary 모듈 파싱 + validPrice 패턴 + IntentTag HISTORICAL).
2. `aiUniverseService` snapshot enrichment 또는 클라이언트 `enrichment.ts` 에 Naver→Yahoo quoteSummary fallback wiring + `perSource` 영속.
3. `StockRecommendation['valuation']` 에 `perSource?` 추가(architect 타입 확정).
4. 회귀 테스트(우선순위 fallback / fail-soft / ENV OFF byte-equivalent / negative cache) + 운영자 활성화 절차(샘플 검증 → ENV `=true`).
5. wiring 완료 시 PENDING_WIRING C18 항목 제거 + 변경 이력 인용.
