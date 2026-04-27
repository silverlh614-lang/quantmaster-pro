# ADR-0064: Market Overview AI 가격 위임 제거 + Yahoo prefill overlay (PR-α)

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0009 (외부 호출 예산), ADR-0010 (외부 호출 강화), ADR-0011 (AI 추천 KIS/KRX 분리), ADR-0058 (EgressGuard IntentTag), 후속 ADR (PR-β SWR 캐시 / PR-γ disk snapshot 영속화)

---

## 1. 배경

`src/services/stock/marketOverview.ts:97-153` (PR-α 이전) 의 `getMarketOverview()` 가
시장 개요 화면의 거의 모든 가격성 데이터를 Gemini AI 에게 *추정* 하도록 위임했다:

- **지수**: S&P 500, NASDAQ, Dow Jones, Nikkei 225, CSI 300 → "최신 지식 기반으로 채워라"
- **환율**: JPY/KRW, EUR/KRW → AI 추정
- **원자재**: 금, WTI 원유 → AI 추정
- **금리**: 한국 3년물 → AI 추정
- **거시지표**: CPI, PCE, 실업률, FOMC 결정 → AI 추정

KOSPI/KOSDAQ/VIX/VKOSPI/US10Y 만 `/api/market-indicators` 의 Yahoo 직접 fetch 결과를
prefill 로 주입했다. 그 외는 모두 AI hallucination 영역이었다.

### 1.1 사용자 보고 회귀

> "데이터가 너무 불안정함" — 호출마다 나스닥/S&P 가격이 흔들리고 환율도 출렁임.

원인: AI 가 어제 1.4% 빠진 나스닥을 "전일 대비 +0.8%" 라고 답하거나 매번 다른 hallucinated
값을 반환. 캐시 윈도우 boundary (예: 11:59 → 12:00) 에서 새 hallucinated 값으로 교체되며
점프하는 인상.

### 1.2 추가 비용

AI 가 가격 데이터를 답하기 위해 토큰 소비 + 정확성 0. Gemini 비용 낭비.

---

## 2. 결정

가격성 데이터 4 카테고리 (지수 / 환율 / 원자재 / 금리) 중 **Yahoo 로 fetch 가능한 3 카테고리**
(지수 / 환율 / 원자재) 를 AI 위임에서 제거하고 Yahoo 직접 fetch + overlay enforcement 로 전환.

### 2.1 신규 모듈 — `src/services/stock/marketOverviewIndicators.ts`

가격성 실데이터 prefill SSOT. 8 심볼 병렬 fetch:

| 카테고리 | 심볼 | UI 라벨 |
|---------|------|---------|
| 지수 | `^GSPC` | S&P 500 |
| 지수 | `^IXIC` | NASDAQ |
| 지수 | `^DJI` | Dow Jones |
| 지수 | `^N225` | Nikkei 225 |
| 지수 | `000300.SS` | CSI 300 |
| FX | `JPYKRW=X` | JPY/KRW |
| FX | `EURKRW=X` | EUR/KRW |
| 원자재 | `GC=F` | 금 (Gold) |
| 원자재 | `CL=F` | WTI 원유 |

KOSPI / KOSDAQ 는 기존 `/api/market-indicators` 의 `^KS11` / `^KQ11` 결과를 그대로 사용
(intraday 신선도 우수). USD/KRW 는 ECOS macroCached 우선 (정확도 우수).

### 2.2 fetch 정책

- `fetchHistoricalData(symbol, '1d', '1d')` 호출 → `/api/historical-data` 프록시 경유
- 서버 LRU 캐시 + coalescing (ADR-0009/0010) + EgressGuard IntentTag (ADR-0058) 자동 적용
- `Promise.allSettled` — 단일 심볼 OFFHOURS / 네트워크 실패가 전체 차단 X
- 실패한 심볼은 `failedSymbols` 배열에 기록만, 다른 심볼은 계속 처리

---

## 3. Overlay Enforcement (핵심)

`normalizeMarketOverview(raw, prefillOverlay?)` 가 AI 응답을 *완전히 무시* 하고 prefill
결과로 덮어쓴다:

```
prefill 카테고리에 ≥1 항목 → AI 응답 무시, prefill 사용 (hallucination 차단)
prefill 카테고리 빈 배열  → AI 응답 fallback 유지 (모든 심볼 fetch 실패 시)
```

빈 배열 케이스는 *모든* 8 심볼이 동시에 OFFHOURS 또는 fetch 실패한 매우 드문 상황. PR-γ
disk snapshot 영속화 정착 후엔 fallback 사용도 거의 0.

### 3.1 비대칭 정책 — 분석/서술/추론은 AI 그대로

다음 필드는 AI 가 여전히 담당 (overlay X):

- `summary` (시장 요약 서술)
- `dynamicWeights` (조건별 동적 가중치 추론)
- `upcomingEvents` (매크로 이벤트 달력)
- `snsSentiment` (SNS 감성 분석)
- `sectorRotation` (섹터 자금 흐름 분석)
- `euphoriaSignals` / `regimeShiftDetector` / `globalEtfMonitoring` / `marketPhase` / `activeStrategy`
- `interestRates`, `macroIndicators` (한국 3년물 / CPI / PCE / 실업률 등 — 후속 PR 에서 ECOS/FRED 위임)

AI 의 *분석 가치* 는 보존하면서 *가격 추정 영역* 만 차단.

---

## 4. 캐시 정책 (본 PR 변경 없음)

기존 6시간 버킷 캐시 (`market-overview-${date}-${Math.floor(hour/6)}`) 그대로 유지.
캐시 hit 시 normalize 결과 (overlay 적용된 값) 가 그대로 재사용 → 6시간 윈도우 안에서는
가격성 데이터도 동결.

이 정책은 PR-β 에서 SWR (60s fresh + 5min stale) 패턴으로 재설계 예정. 본 PR 은 hallucination
차단의 핵심 효과 (캐시 miss 시 AI 가 indices/exchangeRates/commodities 를 추정한 값이 영원히
캐시되어 6시간 내내 잘못된 데이터로 표시되던 회귀) 를 우선 차단.

---

## 5. 자동매매 영향

`getMarketOverview` 호출자: `src/hooks/useMarketData.ts:58` (`useMarketData` hook) 만.
자동매매 경로 (signalScanner / autoTradeEngine / entryEngine) 에서 호출 0건 — 절대 규칙
#4 위반 없음 (조사 완료, grep zero match).

LIVE 매매 본체 0줄 변경.

---

## 6. 테스트 정책

- `src/services/stock/marketOverviewIndicators.test.ts` (17 케이스)
  - SSOT 검증: INDEX_TARGETS 5 / FX_TARGETS 2 / COMMODITY_TARGETS 2
  - extractDataPoint 7: 정상 / previousClose fallback / prev 부재 0% / 가격 0/음수/NaN/Infinity null / meta null / prev=0 분모 방어
  - applyPrefilledOverlay 4: hallucination 차단 / 빈 배열 fallback / undefined fallback / 부분 prefill 카테고리 독립 분기
  - fetchPrefilledMarketData 4: 8 심볼 병렬 정상 / 일부 throw graceful / null 반환 fallback / range/interval 통일

- `src/services/stock/marketOverview.normalize.test.ts` (6 케이스)
  - prefillOverlay 미전달 시 기존 동작 유지
  - prefillOverlay 전달 시 AI hallucinated 값을 *완전히* 덮어쓰기
  - 빈 배열 시 AI fallback
  - sectorRotation flat → topSectors 변환 (기존 동작 보존)
  - regimeShiftDetector { current, probability, signal } 변환 (기존 동작 보존)
  - overlay + sectorRotation 변환 동시 적용

---

## 7. 후속 PR

- **PR-γ**: `/api/market-indicators` disk snapshot 영속화 (ADR-0009 LRU 패턴 차용). prefill
  카테고리 빈 배열 fallback 케이스를 거의 0 으로 감축. `X-Field-Stale: vix,us10yYield`
  헤더로 운영자 인지.
- **PR-β**: 캐시 6시간 → SWR (60s fresh + 5min stale). 윈도우 boundary 점프 영구 차단.
- **후속 분리**: 거시지표 (한국 3년물 / 미국 CPI / PCE / 실업률 / Fed Funds Rate) 를
  ECOS/FRED 클라이언트로 위임. 본 PR scope 외 — `interestRates` / `macroIndicators`
  필드는 여전히 AI 추정.

---

## 8. 회귀 위험

- **Yahoo 장외 차단**: NYSE 정규장 외 시간에 ^GSPC/^IXIC/^DJI 가 EgressGuard 차단으로
  null 반환 가능. 그러나 LRU 캐시 hit 시 stale 값 반환 → 처음 한 번만 OFFHOURS, 이후엔
  stale 데이터 살아있음. PR-γ 가 disk snapshot 으로 fallback 강화.
- **AI 응답 형식 변경**: 본 PR 이전엔 AI 가 indices 배열에 추가 지수를 자유롭게 채울 수
  있었지만, 이제 AI 응답이 어떤 indices 든 prefill 결과로 덮어쓰여 *고정 5 지수* (S&P /
  NASDAQ / Dow / Nikkei / CSI) + KOSPI / KOSDAQ 만 노출. UI 가 더 적은 지수를 보여주는
  변화는 의도된 효과 (정확도 ≫ 다양성).
