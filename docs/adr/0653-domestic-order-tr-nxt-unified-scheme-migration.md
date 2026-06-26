# ADR-0653 — 국내 주문 TR_ID 신스킴(KRX+NXT 통합) 마이그레이션 계획 (flag-gated·LIVE 본체 0줄)

> 상태: **Accepted** — 신스킴 구현을 **flag-gated·default OFF·byte-equivalent** 로 포함한다
> (`KIS_ORDER_TR_NXT_SCHEME_ENABLED`). flag OFF 시 라이브 주문 경로 byte-equivalent(회귀 378/378 green).
> **실제 활성화(ON)는 운영자 승인 + VTS(모의) 회귀 후** — ENV 1줄로 켠다(코드 재배포 불요).
> 정식 발급 번호 `0653` — 출처: `docs/adr/INDEX.md` §"최대 발급 0652 · 다음 발급 0653"
> (2026-06-25 실측·`validate:adrIndex`). 상단 stale "다음 발급 0593" 블록은 레거시(무시).
> 작성: 2026-06-26 / architect
> 트리거: 사용자 첨부 공식 SDK(`open-trading-api-main`, 2026-03-18 vintage = ADR-0555 큐레이션 원본)
> 재대조 — "놓친부분 확인 후 정본화" 요청.
> 동반 산출물: `_workspace/20260626_kis-canonicalization/kis-registry-reconciliation-report.md`.

---

## Context

### 현행 라이브 주문 경로는 구(舊) TR 스킴

`server/clients/kisClient/constants.ts` 의 주문 상수는 KRX 전용 구 스킴이다:

| 용도 | 코드(현행) | 소비처 |
|------|-----------|--------|
| 매수 | `BUY_TR_ID = TTTC0802U` (demo `VTTC0802U`) | `orderGateway/kisBuyOrderAdapter.ts:18` |
| 매도 | `SELL_TR_ID = TTTC0801U` (demo `VTTC0801U`) | `kisSellOrderAdapter.ts:13`, `kisOcoOrderAdapter.ts:11` |
| 일별체결 확인 | `CCLD_TR_ID = TTTC8001R` (demo `VTTC8001R`) | `ocoFillMonitor.ts:138`, `ocoConfirmLoop.ts`, `kisRouter.ts:234`, `kisOrderGateway.ts:222` |

### 공식 SDK 는 KRX+NXT 통합 신스킴으로 이행

첨부 공식 `examples_llm/domestic_stock/` 전수 재대조(`order_cash.py:103-116`,
`order_rvsecncl.py:107-109`, `inquire_daily_ccld.py`) 결과 공식은 신스킴으로 이행했다.
이는 2025 대체거래소 **Nextrade(NXT)** 도입에 따른 거래소 통합 주문 체계다.

| 용도 | 공식 신스킴 | 신규 필수 param |
|------|-------------|-----------------|
| 매수 | **`TTTC0012U`** (demo `VTTC0012U`) | `EXCG_ID_DVSN_CD`(거래소ID·KRX/NXT/통합), `SLL_TYPE`, `CNDT_PRIC` |
| 매도 | **`TTTC0011U`** (demo `VTTC0011U`) | (동일) |
| 정정취소 | **`TTTC0013U`** (demo `VTTC0013U`) | `QTY_ALL_ORD_YN`, `EXCG_ID_DVSN_CD` |
| 일별체결 | **`TTTC0081R`** / 연속 `CTSC9215R` (demo `VTTC0081R`/`VTSC9215R`) | — |

`fid_cond_mrkt_div_code` 도 `J:KRX` 단일에서 `J:KRX / NX:NXT / UN:통합` 으로 확장됐다
(`investor_trade_by_stock_daily.py` Args 주석).

### ⚠️ 매수↔매도 뒤바뀜 함정 (재확인)

공식 `order_cash.py:104-107` 의 분기는 **`ord_dv=="sell" → TTTC0011U`, `ord_dv=="buy" → TTTC0012U`**.
구 스킴(매수 `...02U`·매도 `...01U`, 끝자리 2=매수)의 직관으로 끝자리만 보고
"매수=`...11U`"로 유추하면 **매수 주문이 매도 TR 로 전송되는 치명적 오라우팅**이 발생한다.
프로젝트는 2026-06-05 `Patch-KisRef-OrderTR-BuySellSwap-Fix`(patch-history #189)에서 큐레이션
레퍼런스의 이 swap 오기재를 이미 정정했고, **라이브 코드는 의도적으로 미접촉**으로 두어
본 ADR(flag-gated 마이그레이션)로 위임한 상태다. 즉 현행 구 스킴 잔존은 *버그가 아니라
의도적으로 parked 된 항목*이다.

### 구 스킴은 깨진 게 아니라 KRX 전용

`TTTC0802U/0801U` 은 KIS 가 하위호환으로 여전히 동작시키나 **KRX 라우팅 전용**이다.
NXT/통합 라우팅·SOR(Smart Order Routing)·신규 필수 param 지원은 신스킴에서만 가능하다.
따라서 본 마이그레이션은 *장애 복구가 아니라 거래소 커버리지·미래 호환 확보*다.

---

## Decision

국내 주문 TR_ID 를 신스킴으로 이행하되, **flag-gated·default OFF·byte-equivalent** 원칙
(CLAUDE.md §5 byte-equivalent, ADR-0146 LIVE 매매 안전성)을 절대 준수한다.

### (a) 본 PR 구현 범위 — flag-gated·default OFF

1. `constants.ts` 단일 SSOT: `ORDER_TR_SCHEME` 스위치(`KIS_NXT_ORDER_TR_IDS` vs
   `KIS_LEGACY_ORDER_TR_IDS`)로 `BUY_TR_ID`/`SELL_TR_ID`/`CCLD_TR_ID`/`RVSECNCL_TR_ID` 전부
   flag-aware화. **매핑 동결: 매수=`TTTC0012U`, 매도=`TTTC0011U`**(swap 함정 주석 + 가드 테스트).
2. ENV gate `KIS_ORDER_TR_NXT_SCHEME_ENABLED` (default **OFF**). OFF → 구 스킴 값 그대로
   → **byte-equivalent**(주문 본체 산술/순서/param 불변, 회귀 378/378).
3. 어댑터(`kisBuyOrderAdapter`/`kisSellOrderAdapter`/`kisOcoOrderAdapter`)에 `...nxtOrderCashParams(side)`
   spread — OFF 시 `{}` → body 동일. ON 시 `EXCG_ID_DVSN_CD`(env `KIS_ORDER_EXCG_ID_DVSN_CD` 기본 `KRX`)·
   `SLL_TYPE`(매도 `01`/매수 공란)·`CNDT_PRIC`(공란) 주입.
4. 정정취소: `selectCancelOrderTrId(isReal)`(input.isReal 경로 보존) + `nxtCancelParams()`(EXCG_ID 주입).
5. 체결 확인: `CCLD_TR_ID` 동일 flag로 자동 이행(importer 3곳 자연 전파) + 게이트웨이 inline
   `selectCcldTrId(deps.isReal)` 정합.
6. 가드 테스트 `kisOrderTrScheme.test.ts`: 신/구 매핑 + 매수↔매도 swap 동결 + OFF byte-equivalent.

### (b) 실제 활성화(ON) 게이트 — 운영자 승인 필수

1. **VTS(모의계좌) 회귀 필수** — 모의 매수/매도/정정취소/체결조회 1사이클 E2E,
   매수가 매수 TR(`VTTC0012U`)로 나가는지 raw 로그 확인.
2. 활성화: `KIS_ORDER_TR_NXT_SCHEME_ENABLED=true` (+ 필요 시 `KIS_ORDER_EXCG_ID_DVSN_CD`). 코드 재배포 불요.
3. 롤백: ENV 1줄 OFF → 즉시 구 스킴 복귀.
4. NXT/통합(`UN`) 거래소 확대(`EXCG_ID_DVSN_CD=NXT/SOR`)는 KRX 검증 후 별도 ADR.

---

## Consequences

- **9대 불변식**: #1(엔진 상시 가동) — flag OFF 시 주문 경로 byte-equivalent 로 무영향.
  #4(providerIssue ≠ marketSignal) 무관. #7(L4 격리) 무관(주문은 L1).
- **executionImpact**: flag OFF=**NONE**(byte-equivalent, 회귀 378/378) / ON=주문 TR·param 변경
  (실거래 경로 — 운영자 승인·VTS 회귀 게이트).
- **byte-equivalent 원칙**: OFF 시 주문 본체 산술/순서/param 불변 + ENV 1줄 롤백 + VTS 회귀
  + KIS/KRX quota 0 침범(주문 경로는 quota 무관).
- **계보**: ADR-0555(공식 레퍼런스 큐레이션·SSOT), Patch #189(swap 정정·라이브 보류 결정),
  ADR-0561(KIS Primary), ADR-0146(LIVE 안전성 5 카테고리).
- **미해결/후속**: 거래소 구분 `EXCG_ID_DVSN_CD` 의 NXT/통합(`UN`) 확대 라우팅은 본 ADR 범위 밖
  (KRX 고정 시작) — SOR·NXT 호가 정합 검증 후 별도 ADR. `inquireDailyCcld` 연속조회
  `CTSC9215R` 페이지네이션 헤더 처리도 후속 PR 에서 VTS 확인.

---

## 출처 / 재대조

- 공식: 한국투자증권 `open-trading-api` `examples_llm/domestic_stock/{order_cash,order_rvsecncl,inquire_daily_ccld}/*.py`
  (첨부 SDK mtime 2026-03-18 = ADR-0555 큐레이션 원본과 동일 vintage — 신규 버전 drift 없음).
- 큐레이션 SSOT: `docs/reference/kis-open-trading-api/` (ADR-0555, 2026-06-05 order TR 재대조 이력).
