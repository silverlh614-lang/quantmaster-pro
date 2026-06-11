# ADR-0601: Gate2 Supply 축 KIS 네이티브 investor-flow hydration — 단일통로 evidence 의 후보 전체 확장

@responsibility policy — 스캔당 대표 1종목만 조회하던 KIS 종목별 투자자 순매수(단일통로 기존 배선)를 결손 후보 전체로 확장 주입해 Gate2 Supply 축을 L1 데이터로 충전 (일중 캐시·스캔당 상한·실패 격리, default ON)

## Status

Accepted (D3 구현 동반 — default ON `!== 'false'` · D4 Phase 2)

## Context

ADR-0600 D3 로드맵의 실행. 공식 open-trading-api 인벤토리로 확인한 핵심: **신규 TR 불필요** —
`kisClient.fetchKisInvestorTradeByStockDaily`(종목별 투자자매매동향)와 그 어댑터
`fetchKisInvestorFlowEvidence`(`server/supply/kisInvestorFlowEvidence.ts`, frgn/orgn_ntby 정규화)가
이미 존재한다. 갭은 **호출 범위**: ADR-0477 라우터가 스캔당 대표 1종목만 평가 → 나머지 후보의
`gate2ExternalDataCoverage.kisInvestorFlow` 가 비어 Supply 축 28/43 결손 (ADR-0600 fallback 으로
시맨틱 보충 중이나 L1 네이티브가 KIS Primary 원칙상 1순위 — ADR-0561).

## Decision

### D3. per-candidate hydration (구현)

신규 모듈 `scanDiagnostics/gate2InvestorFlowHydrationAdr0601.ts` —
`persistScanResults` 의 entryFilterDecomposition **직전**에 실행:

- 대상: `kisInvestorFlow` 의 foreign/institutional 모두 결손인 후보만. **Gate1 통과 후보 우선** 정렬.
- 조회: 기존 단일통로 `fetchKisInvestorFlowEvidence(symbol)` ('LOW' rate 우선순위) — raw KIS 호출 0.
- **quota 3중 관리:** ① 일중 캐시(symbol×KST일자 — 재스캔 fetch 0) ② 스캔당 신규 조회 상한
  (`GATE2_INVESTOR_FLOW_HYDRATION_MAX`, 0~50, default 16) ③ 당일 실패 심볼 재시도 1회 억제.
- 주입: `snapshot.gate2ExternalDataCoverage.kisInvestorFlow = { status: VERIFIED|PARTIAL,
  foreignNetBuy, institutionalNetBuy, sourceDate, hydratedBy: 'ADR_0601_KIS_NATIVE_HYDRATION' }`
  → `buildSupplyAxis` 가 기존 경로로 소비 (gate2ConfluenceScore 0줄 변경). 주입 실패/결손 시
  ADR-0600 시맨틱 fallback 이 최후 보조로 잔존 (우선순위: L1 네이티브 > 시맨틱 fallback > missing).
- 집계: `ScanSummary.gate2InvestorFlowHydrationAdr0601` (hydrated/cache/fail/capped) + 1줄 로그.
- 실패 전면 격리 (불변식 #1/#2) · 결손→bearish 변환 0 (불변식 #6).

### 게이트: `GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED` — default ON (`!== 'false'`)

근거: 진단 차선 한정(ADR-0600 §안전 등급 동일) + 기존 단일통로/rate limiter 경유 + 상한·캐시로
quota bounded (~16콜/스캔, 일중 재스캔 0콜) + `=false` 1줄 롤백. 사용자 명시 지시("공식 API 자료
빠뜨리지 말 것")의 즉시 반영.

### D4 (Phase 2, 미구현). KOSDAQ 마스터 업종코드 → Sector 축 네이티브

`stocks_info/kis_kosdaq_code_mst` 마스터파일의 종목별 지수업종 대/중/소분류 코드를 일 1회
다운로드·캐시해 코스닥 업종 매핑 부재(Sector 21/43 결손 1차 원인)를 해소하고, 업종코드로
`inquire_index_category_price` 계열 sectorCycle 공급을 확장한다. 마스터 파서(고정폭)·캐시 저장소
·sectorEnergy provider 통합이 필요해 별도 구현 단위 — 그때까지 ADR-0600 D2 동종군 fallback 유지.

## Guardrails

- kisClient 단일통로 준수 (raw KIS REST 0) · live 주문 경로 0줄 · Gate2 판정 로직 0줄
  (입력 데이터만 충전) · AI_ESTIMATED 승격 없음 (KIS L1 데이터만 주입).

## Rollback

ENV 1줄 `GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED=false` → hydration 0, ADR-0600 fallback 만 잔존.

## References

- ADR-0600 (§D3/D4 로드맵·fallback 보조) · ADR-0561 (KIS Primary Absolute) · ADR-0477 (라우터 —
  대표 1종목 한정의 출처) · `server/supply/kisInvestorFlowEvidence.ts` ·
  공식 API: `investor_trade_by_stock_daily` · `inquire_investor`(FHKST01010900, 보조 후보)
