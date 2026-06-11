# ADR-0601: Gate2 Supply 축 KIS 네이티브 investor-flow hydration — 단일통로 evidence 의 후보 전체 확장

@responsibility policy — 스캔당 대표 1종목만 조회하던 KIS 종목별 투자자 순매수(단일통로 기존 배선)를 결손 후보 전체로 확장 주입해 Gate2 Supply 축을 L1 데이터로 충전 (일중 캐시·스캔당 상한·실패 격리, default ON)

## Status

Accepted (D3·D4 구현 — default ON `!== 'false'`)

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

### D4 (구현). 종목 마스터 업종코드 → Sector 축 네이티브

- `server/sector/StockSectorCodeMasterProvider.ts` — kospi/kosdaq_code.mst(.zip) 일 1회
  다운로드·디스크 캐시·KST 일자 메모이즈. 고정폭 tail(KOSPI 228B/KOSDAQ 222B, 전부 ASCII —
  cp949 디코딩 불필요)에서 단축코드+지수업종 대/중/소 코드만 바이트 파싱. 실패 시 캐시 fallback,
  전멸 시 loaded=false (결손 ≠ 신호 — 소비처 missing 유지).
- `scanDiagnostics/gate2SectorCycleHydrationAdr0601.ts` — sectorCycle 결손 후보를 마스터
  중분류 코드 → `fetchKisSectorIndexDaily(iscd)`(kisClient 기존 export, 'LOW') 업종지수 r20 으로
  보충: `values.stockVsSectorReturn20d`(+벤치마크 가용 시 `sectorRelativeReturn20d`) 산출 후
  `gate2ExternalDataCoverage.sectorCycle(status=PARTIAL, hydratedBy 표기)` 주입 →
  buildSectorAxis 기존 경로 소비(confidence DEGRADED·ADVISORY). **공식 11-섹터 이름 매핑 체인을
  우회** — 코스닥 포함 마스터 코드 보유 전 종목 커버.
- quota: 업종지수 조회는 심볼이 아니라 **고유 업종코드 단위** — 일중 캐시 + 스캔당 상한
  (`GATE2_SECTOR_INDEX_FETCH_MAX` 0~30, default 12) + 당일 실패 억제. 마스터 다운로드는
  KIS REST quota 외 정적 파일 (일 1회).
- flag `GATE2_SECTOR_CYCLE_NATIVE_HYDRATION_ENABLED` default ON (`!== 'false'`) — D3 동일 근거.
  OFF 시 ADR-0600 D2 동종군 fallback 만 잔존.

## Guardrails

- kisClient 단일통로 준수 (raw KIS REST 0) · live 주문 경로 0줄 · Gate2 판정 로직 0줄
  (입력 데이터만 충전) · AI_ESTIMATED 승격 없음 (KIS L1 데이터만 주입).

## Rollback

ENV 1줄 `GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED=false` → hydration 0, ADR-0600 fallback 만 잔존.

## References

- ADR-0600 (§D3/D4 로드맵·fallback 보조) · ADR-0561 (KIS Primary Absolute) · ADR-0477 (라우터 —
  대표 1종목 한정의 출처) · `server/supply/kisInvestorFlowEvidence.ts` ·
  공식 API: `investor_trade_by_stock_daily` · `inquire_investor`(FHKST01010900, 보조 후보)
