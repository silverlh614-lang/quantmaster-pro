<!--
@responsibility KIS 공식 open-trading-api curated 레퍼런스 — kisClient TR_ID·엔드포인트 검증 SSOT 출처.
-->

# KIS Open Trading API — Curated Reference (kisClient TR_ID·Endpoint SSOT)

> **Type:** reference (소스 코드 0줄 변경). ADR-0555 산출물 4.
> **Binding rule (ADR-0555 Decision (c)):** kisClient 엔드포인트/TR_ID 를 추가·변경할 때
> 이 레퍼런스를 **스펙 SSOT 로 교차검증**한다. 본 레퍼런스에 없는 신규 엔드포인트는
> 공식 출처(아래 §출처)에서 먼저 확인 후 추가한다.

## 출처 / 버전 / 용도

- **출처:** 한국투자증권(Korea Investment & Securities) 공식 `open-trading-api`
  (https://github.com/koreainvestment/open-trading-api), `examples_llm/domestic_stock/` 엔드포인트별 예제 +
  `MCP/Kis Trading MCP/configs/domestic_stock.json` (기계판독 API 스펙, 74개 엔드포인트).
- **버전:** 추출 시점 2026-03-18 (`domestic_stock.json` mtime). 갱신 시 본 README §출처 날짜를 함께 갱신.
- **이 디렉토리에 둔 것:** `domestic_stock.json` (curated 기계판독 스펙, 166KB) + 본 README.
  **19MB 전체 SDK 는 커밋하지 않는다** (examples_llm/legacy/backtester 등은 `/tmp` 에만 존재).
- **용도:** `server/clients/kisClient/` 의 TR_ID·api_path·파라미터를 공식 스펙과 대조하는 단일 출처.
  기존 정적 가드 `scripts/check_kis_official_endpoint_registry.js` +
  `server/clients/kisClient/kisOfficialEndpointRegistry.ts` 의 권위 입력으로도 사용한다.

## 우리 kisClient TR_ID ↔ 공식 스펙 교차대조

검증 방법: `server/clients/kisClient/{constants,query,orders,holdings}.ts` +
`orderGateway/`, `query/` 에서 TR_ID 를 grep 추출 → 공식 `examples_llm/domestic_stock/<endpoint>/` 예제의
`tr_id` 와 대조. `real(TTTC/FHKST...)` / `demo(VTTC/...)` 쌍 중 real 기준 표기.

### A. 시세·수급·매크로 (quotation) — 12 TR_ID, 전부 일치 ✅

| 우리 TR_ID | api_path | 공식 예제 dir | 일치 |
|---|---|---|---|
| `FHKST01010100` | `/quotations/inquire-price` | `inquire_price` | ✅ |
| `FHKST01010300` | `/quotations/inquire-time-itemconclusion` | `inquire_ccnl` | ✅ |
| `FHKST01010900` | `/quotations/inquire-investor` | `inquire_investor` | ✅ |
| `FHKST03010100` | `/quotations/inquire-daily-itemchartprice` | `inquire_daily_itemchartprice` | ✅ |
| `FHKST03030100` | `/quotations/inquire-daily-indexchartprice` | `inquire_daily_chartprice` | ✅ |
| `FHKST17010000` | `/ranking/credit-balance` | `credit_balance` | ✅ |
| `FHKUP03500100` | `/quotations/inquire-daily-indexchartprice` | `inquire_daily_indexchartprice` | ✅ |
| `FHPST01710000` | `/ranking/volume` | `volume_rank` | ✅ |
| `FHPST04760000` | `/quotations/daily-credit-balance` | `daily_credit_balance` | ✅ |
| `FHPST04820000` | `/ranking/short-sale` | `short_sale` | ✅ |
| `FHPST04830000` | `/quotations/daily-short-sale` | `daily_short_sale` | ✅ |
| `CTCA0903R` | `/quotations/chk-holiday` | `chk_holiday` | ✅ |

### B. 계좌·체결·주문 (trading) — 5 TR_ID, 1 일치 / 4 LEGACY ⚠️

> ⚠️ **LEGACY 표시는 "고장"이 아니다.** 우리가 쓰는 구(舊) order TR_ID 들은 현재도 KIS 서버에서
> 정상 동작한다. 다만 공식 SDK 의 *현행* 예제는 신(新) TR_ID 로 갱신되어 있어 **스펙 SSOT 와 드리프트**가 있다.
> 따라서 burn-down 대상(불일치 가시화)이며, 마이그레이션 자체는 LIVE 주문 본체 변경이므로 별도 ADR + 회귀 테스트 필요.

| 우리 TR_ID (real) | 용도 | api_path | 공식 현행 TR_ID | 상태 | 근거 파일 |
|---|---|---|---|---|---|
| `TTTC8434R` | 잔고조회 | `/trading/inquire-balance` | `TTTC8434R` | ✅ MATCH | `holdings.ts:42,83` |
| `TTTC0802U` | 매수 주문 | `/trading/order-cash` | `TTTC0011U` | ⚠️ LEGACY | `constants.ts:12` |
| `TTTC0801U` | 매도 주문 | `/trading/order-cash` | `TTTC0012U` | ⚠️ LEGACY | `constants.ts:13` |
| `TTTC0803U` | 정정/취소 | `/trading/order-rvsecncl` | `TTTC0013U` | ⚠️ LEGACY | `orderGateway/kisSellOrderAdapter.ts:38` |
| `TTTC8001R` | 일별체결조회 | `/trading/inquire-daily-ccld` | `TTTC0081R` | ⚠️ LEGACY | `orderGateway/kisOrderGateway.ts:222` |

> demo(모의) 짝: 우리 `VTTC0802U/0801U/0803U/8001R` ↔ 공식 현행 `VTTC0011U/0012U/0013U/0081R`.
> `VTTC8434R`(잔고) 는 일치.

### 교차대조 결과 요약

- **총 17 TR_ID 검사** — 일치 13 / 드리프트(LEGACY) 4 / 부재(공식 스펙에 없음) 0.
- 드리프트 4건은 전부 **order/체결 경로**(매수·매도·정정취소·일별체결). api_path 는 모두 일치하며
  TR_ID 헤더 값만 구 스킴이다.
- **api_path 불일치 0건** — 우리가 호출하는 모든 trading/quotation 경로는 공식 스펙에 존재한다.
- `/uapi/custom/*`, `/uapi/x` 등 일부 경로는 테스트 스텁(공식 스펙 대상 아님).

### Burn-down (ADR-0555 P-후속, 별도 ADR 필요)

order TR_ID 4건의 신스킴 마이그레이션은 **byte-equivalent 아님 + LIVE 주문 본체 변경**이므로:
1. flag-gated 신구 TR_ID 라우터 (default = 구 TR_ID, byte-equivalent).
2. VTS 모의계좌(`KIS_IS_REAL=false`)에서 신 TR_ID 5경로 대칭 회귀 검증.
3. 별도 ADR 발급 후 단계적 전환. 본 ADR-0555 범위 밖(문서/가시화만).
