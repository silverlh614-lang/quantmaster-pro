# ADR-0600: Gate2 Supply/Sector 결손 축 보수 fallback + KIS 공식 API 네이티브 커버리지 로드맵

@responsibility policy — Gate2 진단 차선의 Supply(KIS 투자자행 결손)·Sector(코스닥 업종 매핑 부재) 축 결손을 기존 스캔 데이터 기반 보수 fallback(BULLISH 민팅 금지 캡)으로 즉시 보전하고, 한투 공식 API 네이티브 경로(inquire-investor·KOSDAQ 마스터 업종코드)를 1순위 후속으로 확정

## Status

Accepted (D1/D2 구현 동반 — default ON `!== 'false'` · D3/D4 후속 ADR)

## Context

운영 실측(2026-06-11): Supply 28/43 · Sector 21/43 · Fund 28/43. ADR-0599 dry-run(strong=0 weak=0)이
"개수 조건이 아니라 점수/커버리지가 1차 병목"임을 확정 → 사용자 지시 "supply/sector 누락 수정".

- Supply 결손: `buildSupplyAxis` 가 KIS 투자자행(NO_ROW_FOUND/필드 부재) 시 missing 처리.
  **그러나 Gate1 은 같은 후보의 시맨틱 수급 판정(`supplyConfluenceState` BULLISH/NEUTRAL/BEARISH,
  ADR-0477~0488 라우터 산출)을 이미 보유** — Gate2 만 소비하지 않던 배선 갭.
- Sector 결손: 코스닥 종목의 KIS 공식 업종지수 매핑 부재 → `sectorCycle` 미가용. 그러나 스캔 후보
  trace 에 `sector` 문자열 + `return20d` 존재 → 동종군 상대 강도는 산출 가능.
- 안전 등급: `buildGate2ConfluenceSummary` 소비처는 전부 scanDiagnostics(View/formatter/
  counterfactual seed) — **live 주문 경로 미접촉** (live leadership 은 별도 차선).

## Decision

### D1. Supply 시맨틱 fallback (구현)

KIS 투자자행 결손 시 `trace.supplyConfluenceState` 소비: BULLISH→**78 (ACCUMULATING 캡 —
BULLISH 민팅 금지)** / NEUTRAL→50 / BEARISH→30. confidence=DEGRADED·promotionStage=ADVISORY·
source=`GATE1_SUPPLY_SEMANTIC_FALLBACK`. UNKNOWN/UNAVAILABLE/부재 → 기존 missing (결손≠신호, 불변식 #6).

### D2. Sector 스캔 내 동종군 fallback (구현)

공식 업종 데이터 미가용 시, summary 빌더가 1회 산출한 동종군 컨텍스트(섹터별 **n≥3**,
return20d 중앙값)로 `stockVsPeer20d` 산출: ≥+3 → **62 (stockLeader 급 상한 — BULLISH 불가)** /
≤−5 → 35 / 그 외 50. DEGRADED·ADVISORY·source=`SCAN_PEER_RELATIVE_FALLBACK`. 동종군 <3 → missing.
fetch 0 (스캔 trace 만 사용).

### 게이트: `GATE2_AXIS_COVERAGE_FALLBACK_ENABLED` — **default ON** (`!== 'false'`)

default OFF 선례(0592~0599)와 달리 ON 출고 근거: ① 진단/View 차선 한정(live 0줄)
② 보수 캡으로 STRONG 의 BULLISH 요건에 기여 불가(85 미만 고정) ③ ADR-0578(데이터 enrich ON) 선례
④ `=false` 1줄 즉시 롤백. 사용자 명시 요청("누락 수정")의 즉시 반영.

### D3/D4. KIS 공식 API 네이티브 커버리지 (1순위 후속 — ADR-0601 예정, ADR-0561 KIS Primary 정합)

업로드된 공식 open-trading-api 인벤토리로 확인된 네이티브 소스 — fallback 은 이들 도입 후
**최후 보조로 강등**된다:

- **D3 (Supply):** `/uapi/domestic-stock/v1/quotations/inquire-investor` (주식현재가 투자자,
  국내주식-012) — 종목별 `frgn_ntby_qty`/`orgn_ntby_qty`/`prsn_ntby_qty` 일별. kisClient 단일
  통로 신규 메서드 + Gate1 생존자(~12/스캔) 한정 hydration + 일 캐시 (quota 관리).
  보조: `investor-trade-by-stock-daily`(시세분석), `investor_trend_estimate`(외인기관 추정가집계).
- **D4 (Sector):** KOSDAQ 마스터파일(`kis_kosdaq_code_mst`) — 종목별 **지수업종 대/중/소분류
  코드** 보유 → 코스닥 업종 매핑 부재 해소 (일 1회 다운로드·캐시, quota 영향 미미).
  업종코드 확보 후 `inquire_index_category_price` 등으로 sectorCycle 공급 확장.

## Guardrails

- 점수 임계·BULLISH 컷·AI_ESTIMATED(L4) 제외 불변. fallback 축은 ADVISORY/DEGRADED 표기로
  진단에서 식별 가능 (silent 승격 금지). KIS/KRX fetch 0 (D1/D2). 결손→bearish 변환 금지.
- D3/D4 는 신규 KIS TR/마스터 소비라 별도 ADR(quota·캐시·회로차단 설계) 의무.

## Rollback

ENV 1줄 `GATE2_AXIS_COVERAGE_FALLBACK_ENABLED=false` → 기존 missing 동작 100% 복원.

## References

- Gate2 추적 20260611 · ADR-0599(비례 dry-run strong=0 → 커버리지가 1차 병목 확정) ·
  ADR-0477/0481/0482/0488(시맨틱 수급 라우터) · ADR-0578(enrich default ON 선례) ·
  ADR-0561(KIS Primary Absolute) · ADR-0416(결손≠failed) ·
  공식 API 인벤토리: open-trading-api `examples_llm/domestic_stock/inquire_investor` ·
  `investor_trade_by_stock_daily` · `stocks_info/kis_kosdaq_code_mst.py`
