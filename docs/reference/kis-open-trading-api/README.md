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
- **재대조:** 2026-06-05 — 첨부 공식 SDK(`examples_llm/domestic_stock/`)로 order 경로(order-cash·order-rvsecncl·inquire-daily-ccld) TR_ID 전수 재검증. §B 매수/매도 신행 TR 뒤바뀜 1건 정정(아래 ⚠️ 정정). 나머지(정정취소 TTTC0013U·일별체결 TTTC0081R·잔고 TTTC8434R) 공식 일치 재확인.
- **이 디렉토리에 둔 것:** `domestic_stock.json` (curated 기계판독 스펙, 166KB) + 본 README.
  **19MB 전체 SDK 는 커밋하지 않는다** (examples_llm/legacy/backtester 등은 `/tmp` 에만 존재).
- **용도:** `server/clients/kisClient/` 의 TR_ID·api_path·파라미터를 공식 스펙과 대조하는 단일 출처.
  기존 정적 가드 `scripts/check_kis_official_endpoint_registry.js` +
  `server/clients/kisClient/kisOfficialEndpointRegistry.ts` 의 권위 입력으로도 사용한다.

## 우리 kisClient TR_ID ↔ 공식 스펙 교차대조

검증 방법: `server/clients/kisClient/{constants,query,orders,holdings}.ts` +
`orderGateway/`, `query/` 에서 TR_ID 를 grep 추출 → 공식 `examples_llm/domestic_stock/<endpoint>/` 예제의
`tr_id` 와 대조. `real(TTTC/FHKST...)` / `demo(VTTC/...)` 쌍 중 real 기준 표기.

### A. 시세·수급·매크로 (quotation) — 12 TR_ID, 10 일치 / 2 드리프트 ⚠️ (2026-06-05 첨부 SDK 재대조)

| 우리 TR_ID | api_path | 공식 예제 dir | 일치 |
|---|---|---|---|
| `FHKST01010100` | `/quotations/inquire-price` | `inquire_price` | ✅ |
| `FHKST01010300` | `/quotations/inquire-time-itemconclusion` | `inquire_ccnl` | ✅ |
| `FHKST01010900` | `/quotations/inquire-investor` | `inquire_investor` | ✅ |
| `FHKST03010100` | `/quotations/inquire-daily-itemchartprice` | `inquire_daily_itemchartprice` | ✅ |
| `FHKST03030100` | `/quotations/inquire-investor` (시장수급 `fetchKisMarketSupply` query.ts:640, ISCD=0001) | 공식 SDK 예제 부재 | ⚠️ 드리프트 |
| `FHKST17010000` | `/ranking/credit-balance` | `credit_balance` | ✅ |
| `FHKUP03500100` | `/quotations/inquire-daily-indexchartprice` | `inquire_daily_indexchartprice` | ✅ |
| `FHPST01710000` | (우리)`/ranking/volume` ↔ (공식)`/quotations/volume-rank` | `volume_rank` | ⚠️ 경로 |
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
| `TTTC0802U` | 매수 주문 | `/trading/order-cash` | `TTTC0012U` | ⚠️ LEGACY | `constants.ts:12` |
| `TTTC0801U` | 매도 주문 | `/trading/order-cash` | `TTTC0011U` | ⚠️ LEGACY | `constants.ts:13` |
| `TTTC0803U` | 정정/취소 | `/trading/order-rvsecncl` | `TTTC0013U` | ⚠️ LEGACY | `orderGateway/kisSellOrderAdapter.ts:38` |
| `TTTC8001R` | 일별체결조회 | `/trading/inquire-daily-ccld` | `TTTC0081R` | ⚠️ LEGACY | `orderGateway/kisOrderGateway.ts:222` |

> demo(모의) 짝: 우리 `VTTC0802U(매수)/0801U(매도)/0803U(정정취소)/8001R(체결)` ↔ 공식 현행
> `VTTC0012U/0011U/0013U/0081R`. `VTTC8434R`(잔고) 는 일치.
>
> ⚠️ **정정 (2026-06-05, 첨부 SDK 재대조):** 직전 표는 매수↔매도 신행 TR 을 **뒤바꿔** 기재했었다
> (매수→`TTTC0011U`, 매도→`TTTC0012U`). 공식 `order_cash.py:104-107` 은 **매도=`TTTC0011U`,
> 매수=`TTTC0012U`** 다(`ord_dv=="sell"→TTTC0011U`, `"buy"→TTTC0012U`). 이 매핑을 그대로 따라
> 마이그레이션하면 **매수가 매도 TR 로 전송되는 치명적 오라우팅**이 발생하므로 본 PR 에서 정정한다.
> (정정취소 `TTTC0013U`·일별체결 `TTTC0081R` 은 공식과 이미 일치 — 재확인 완료.)

### 교차대조 결과 요약

- **총 17 TR_ID 검사** — 일치 11 / order LEGACY 드리프트 4 / 데이터 경로·TR 드리프트 2(2026-06-05 재대조 신규) / 부재 0.
- order 드리프트 4건은 **order/체결 경로**(매수·매도·정정취소·일별체결): api_path 일치, TR_ID 만 구 스킴(LEGACY, §B).
- **2026-06-05 첨부 SDK 재대조 신규 드리프트 2건 (데이터/스크리닝, advisory — 코드레벨, 본 PR 무수정):**
  1. `FHPST01710000` 거래량순위 — 우리 코드 5경로(`stockScreener.ts:138`·`universeScanner.ts:262`·`kisRankingClient.ts:95,251`·`dynamicUniverseExpander.ts:173`)가 `/ranking/volume` 호출, **공식은 `/quotations/volume-rank`** (api_path 불일치). 유니버스 발굴 영향 가능 → `/ranking/volume` 현재 데이터 반환 여부 라이브 검증 후 flag-gated 경로 정정 권고(behavior 변경).
  2. `FHKST03030100` 시장수급(`fetchKisMarketSupply` query.ts:640, `/inquire-investor`+ISCD=0001) — 공식 SDK 예제 부재로 TR-경로 짝 검증 불가(공식 `/inquire-investor`=FHKST01010900). market supply 정확도 영향 가능 → KIS 공식 포털 TR 명세 확인 후 판정.
- ~~api_path 불일치 0건~~ → 위 거래량순위 1건 불일치 확인(2026-06-05). `/uapi/custom/*`, `/uapi/x` 등 일부 경로는 테스트 스텁(공식 스펙 대상 아님).

### Burn-down (ADR-0555 P-후속, 별도 ADR 필요)

order TR_ID 4건의 신스킴 마이그레이션은 **byte-equivalent 아님 + LIVE 주문 본체 변경**이므로:
1. flag-gated 신구 TR_ID 라우터 (default = 구 TR_ID, byte-equivalent).
2. VTS 모의계좌(`KIS_IS_REAL=false`)에서 신 TR_ID 5경로 대칭 회귀 검증.
3. 별도 ADR 발급 후 단계적 전환. 본 ADR-0555 범위 밖(문서/가시화만).
