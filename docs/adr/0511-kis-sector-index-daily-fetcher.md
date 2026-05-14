---
id: 0511
title: KIS 국내업종 기간별 지수 시세 Fetcher — callable SSOT (ENV-gated default OFF, live 파이프라인 미연결)
status: ACCEPTED
date: 2026-05-14
executionImpact: NONE
liveExecutionAllowed: false
policyPromotionMode: SHADOW_ONLY
operatorApprovalRequired: true
---

# ADR-0511 — KIS 국내업종 기간별 지수 시세 Fetcher (callable SSOT, live 미연결)

## Context

사용자 5/14 요청 직접 인용:

> "첨부한 파일은 참고해서 krx 섹터 주소를 확인하고, 호출 할 수 있도록 적용한다."

> "섹터에너지는 KRX가 공식 원천이고, KIS는 임시 proxy 또는 보조 fallback이다."

첨부 파일 = KIS (한국투자증권) 공식 오픈소스 (`koreainvestment/open-trading-api`). 본 ADR 은
그 zip 을 분석하여 *국내업종 지수 시세 endpoint* 를 검증하고, callable fetcher 를 신설한다.

ADR-0510 (KRX-First Pipeline Design) 정책 정합 — SectorEnergy 의 **공식 1차 원천은 KRX
OpenAPI**, KIS 는 **임시 proxy / 보조 fallback**. 본 PR 은 KIS fetcher 를 *callable* 상태로만
만들고 (ENV default OFF), live SectorEnergy 파이프라인 wiring 은 후속 PR.

## KIS 공식 endpoint 검증 (zip 분석 결과)

| endpoint | tr_id | 용도 | 채택 여부 |
|---|---|---|---|
| `inquire-index-price` | `FHPUP02100000` | 국내업종 현재지수 (스냅샷만) | ✗ 시계열 없음 |
| `inquire-index-daily-price` | `FHPUP02120000` | 국내업종 일자별지수 | ✗ OHLC 부분 |
| `inquire-daily-indexchartprice` | `FHKUP03500100` | 국내주식업종기간별시세 (일/주/월/년) | ✅ **채택** |

**채택 endpoint**: `/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice`
- `FID_COND_MRKT_DIV_CODE='U'` (업종)
- `FID_INPUT_ISCD` — 업종 상세코드 (`idxcode.mst` 마스터, 0001:종합 / 1001:코스닥종합 / 2001:코스피200 …)
- `FID_INPUT_DATE_1` / `FID_INPUT_DATE_2` — 조회 시작/종료 (YYYYMMDD)
- `FID_PERIOD_DIV_CODE='D'` — 일봉
- `output1` — 업종 지수 현재 스냅샷 (`bstp_nmix_prpr` / `bstp_nmix_prdy_ctrt` / `hts_kor_isnm`)
- `output2` — 일자별 지수 OHLC 시계열 (`stck_bsop_date` / `bstp_nmix_oprc/hgpr/lwpr/prpr` / `acml_vol` / `acml_tr_pbmn`)

업종 상세코드 마스터: `https://new.real.download.dws.co.kr/common/master/idxcode.mst.zip`
(fixed-width cp949, `tcode = row[1:5]` 4자리, `tname = row[3:43]`). 본 PR 은 마스터 다운로드
wiring 미포함 — well-known 집계 코드 (`KIS_SECTOR_INDEX_ISCD` SSOT) 만 노출.

## Decision

### §1. 신규 callable fetcher SSOT

`server/clients/kisClient/query.ts` 에:

- `KIS_SECTOR_INDEX_ISCD` — well-known 업종 상세코드 SSOT (KOSPI/KOSDAQ/KOSPI200)
- `isKisSectorIndexDailyDisabled()` — ENV gate (ADR-0157 정확 비교, default OFF)
- `fetchKisSectorIndexDaily(sectorIscd, fromDate?, toDate?, priority?)` — `realDataKisGet` SSOT
  경유 (절대 규칙 #2 — 회로차단/블랙리스트/jitter 자동 적용), `pickKisRowsByBucket` +
  `extractKisNumber`/`extractKisNumberOptional` 로 output1/output2 파싱

`server/clients/kisClient/types.ts` 에:
- `KisSectorIndexDailyRow` / `KisSectorIndexDaily` 도메인 타입
- `KisClientOverrides.fetchKisSectorIndexDaily?` (VTS mock 진입점)

### §2. ENV gate — default OFF

`KIS_SECTOR_INDEX_DAILY_ENABLED !== 'true'` → `fetchKisSectorIndexDaily` 즉시 `null`.
명시 활성화 (`=true`) 전까지 KIS 호출 0건. ADR-0157 정확 비교 — `'1'`/`'TRUE'`/`'yes'` 모두 거부.
`KIS_SECTOR_INDEX_DAILY_TR_ID` ENV 우회 가능 (운영 환경 검증 후 즉시 교체).

### §3. live 파이프라인 미연결 (본 PR scope)

본 PR 은 *callable 함수 신설* 만. SectorEnergy live 파이프라인 (`sectorEnergyProvider.ts`
L4 fallback) wiring 은 후속 PR — KIS quota 부담 (12 업종 × 1 스캔 = 12 호출/스캔) +
LIVE-adjacent 위험 격리. ADR-0510 의 design-only 패턴 정합.

## 불변식 (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner` / `entryEngine` / `exitEngine` /
   `orchestrator` / `autoTradeEngine` / `trancheExecutor` / `buyPipeline` 모두 0줄.
2. **KIS 주문 함수 import 0건** — `placeKis*` / `cancelKisOrder` 미사용.
3. **신규 외부 API 직접 호출 0건** — `realDataKisGet` SSOT 경유만 (raw fetch/axios 금지).
4. **ENV default OFF** — 명시 활성화 전 KIS 호출 0건.
5. **SectorEnergy live 파이프라인 미연결** — 호출자 0건 (callable only).
6. **`executionImpact: 'NONE'`** — 진단/proxy 데이터 입력 전용. liveExecutionAllowed=false.
7. **KRX 가 공식 원천** — KIS 는 임시 proxy / 보조 fallback (ADR-0510 정합).
8. **`sectorEnergyMaster.ts` / SECTOR_INDEX_MASTER 무수정** — KIS fetcher 는 독립.
9. **Gate threshold / scoring formula 변경 0건.**

## 잘못된 해결 방법 영구 차단

- KIS fetcher 를 SectorEnergy 의 *공식 원천* 으로 승격 (KRX 가 공식, ADR-0510 §1 위반)
- ENV default ON (명시 활성화 의무)
- 본 PR 에서 live 파이프라인 wiring 통합 (후속 PR 분리 — quota + LIVE-adjacent 위험)
- raw fetch/axios 직접 호출 (`realDataKisGet` SSOT 위임 의무)
- idxcode.mst 마스터 다운로드 cron 신설 (별도 ADR)

## 검증

- `npm run lint` (tsc client + server) EXIT=0
- `querySectorIndexDaily.test.ts` 14/14 PASS — ENV gate 정확 비교 / SSOT 노출 /
  default OFF 시 KIS 호출 0건 / overrides 우선 / KIS_APP_KEY 미설정 null / 빈 iscd null /
  output1+output2 파싱 / output fallback / throw graceful / fromDate/toDate 명시·잘못된 형식 /
  TR_ID ENV 우회
- 인접 kisClient 회귀 무영향

## 후속 PR (scope 외)

- SectorEnergy `sectorEnergyProvider.ts` L4 fallback 에 `fetchKisSectorIndexDaily` wiring
  (ENV-gated, KIS quota 분석 후)
- `idxcode.mst` 업종 마스터 다운로드 + 캐시 (KRX-First 정합 — KRX 마스터 우선)
- ADR-0510 Phase 2~7 진행 시 KIS proxy 의 SHADOW_SCORE 단계 활용 검토
