# ADR-0542: Investor Flow Supply Router — KIS output1/output2 버킷 정합 + KIS-first 명시 재정렬

@responsibility provider/supply-routing — KIS investor-trade-by-stock-daily output1/output2 버킷 합성으로 coverage 2/11 회귀 제거 + 라우터 priority KIS-first 명시 재정렬(L1 한정, executionImpact NONE).

## Status

Accepted / Shadow-only dry-run.

## Context

`investorFlowProviderRouterAdr0477`(ADR-0477) 의 KIS per-symbol investor-flow coverage 가
한 scan 사이클 후보 11개 중 2개(2/11)에 그쳤다. 라우터는 이미 사실상 KIS-first 다 —
KRX OTP 가 구조적으로 빈 응답(`otpGenerated=false; httpStatus=NONE`)을 반환해 priority 정렬
*이전* `sampleMaterialized=false` 필터에서 탈락하고, 살아남은 최소 priority 인 KIS_API(3)가
자동 선택된다. 즉 `selectedProvider=KIS_API` 는 *이미* KIS-first 결과다. 문제는 "선택"이
아니라 **KIS 자체의 per-symbol 커버리지** 다.

근본원인(최유력) = **KIS investor-trade output 버킷 shape 불일치**:

- KIS 공식 spec(`investor_trade_by_stock_daily.py`)은 `output1`(요약 row)+`output2`(일자별
  시계열)을 **둘 다** 반환하며, `chk_*.py` COLUMN_MAPPING 의 `frgn_ntby_qty / orgn_ntby_qty /
  prsn_ntby_qty` 순매수 필드는 **두 버킷 모두**에 나타날 수 있다.
- `server/clients/kisClient/query.ts` 의 `fetchKisInvestorTradeByStockDaily` 는 `pickMaterializedBucket`
  으로 단일 버킷(`output2 → output → output1` 순)만 선택한 뒤 그 버킷 `row[0]` 에서 외국인·기관
  순매수를 추출하고, `foreignNetBuy===undefined || institutionalNetBuy===undefined → null` 로
  탈락시켰다. 외국인이 output2, 기관이 output1 처럼 **버킷에 갈라져 있는 종목은 한쪽만 잡혀 null**
  처리되어 누락(2/11 회귀의 직접 원인).
- `kisOfficialEndpointRegistry.ts` 는 `outputBuckets: ['output']` 만 선언해 impl 의 output1/output2
  합성 의도와 드리프트가 있었다(검증 SSOT 오염).

KRX OTP 는 34 variant 브루트포스에도 OTP 미발급으로 구조적 차단 상태라 옵션 B(KRX 파라미터 수정)는
투자 대비 효과 최저로 비채택. KIS investor-trend-estimate(HHPTJ04160200)는 L4(ESTIMATED) 추정
데이터라 불변식 #7 격리 정책과 함께 **ADR-0543 로 분리**한다(본 PR 미도입).

조사 산출물: `_workspace/2026-05-29_supply-router-reprioritize/engine-dev/supply-router-reprioritize-design.md`.

## Decision

L1(KIS 공식 확정 일별) 한정으로 3단계를 적용한다. **executionImpact=NONE(전 경로 SHADOW_ONLY,
liveExecutionAllowed=false 보존)**, **KIS quota 추가 호출 0**(파싱·메타·priority 상수만 변경).

- **Step 0 — 진단 게이트(무비용)**: `KIS_ONLY_TRACE=true` 시 누락 종목의 버킷별 net-buy 존재
  여부(`bucketTrace`)를 비식별 메타로 경고 로그한다(값 미노출). 다음 스캔에서 output1-vs-output2
  가설을 확증하는 무비용 장치. Silent 금지(명시 로그).
- **Step 1 — registry 드리프트 정정(patch type)**: `kisOfficialEndpointRegistry.ts` 의
  `investorTradeByStockDaily.outputBuckets` 를 `['output1','output2','output']` 로 정정(공식 spec 정합).
  런타임은 impl 상수를 쓰므로 메타 SSOT 정합만. investorTrendEstimate param 드리프트(MKSC_SHRN_ISCD)는
  **ADR-0543 분리** — 본 PR 미수정(주석만).
- **Step 2 — output 버킷 합성(C-c1, 핵심 레버)**: `query.ts` 의 `fetchKisInvestorTradeByStockDaily`
  가 `synthesizeInvestorFlowAcrossBuckets` 로 output1·output2·output 어느 버킷에 net-buy 가 있든
  외국인·기관·개인 순매수와 carrier base row 를 합성한다. **ENV 게이트 `KIS_INVESTOR_OUTPUT_BUCKET_FIX`
  (default ON) + 1줄 revert**. 기존 단일 버킷 완전 응답·기존 작동 종목 무회귀.
- **Step 3 — priority KIS-first 명시 재정렬(옵션 A)**: `materialization.ts` priority 상수에서
  `KIS_API:1`, KRX 후순위. 정합 범위(quality-guard 검증): **kisFirstMode=true(ADR-0503, KRX 차단
  운영상태)** 에서는 KRX 가 rank 필터에서 탈락하므로 priority 무관·**byte-equivalent**.
  **kisFirstMode=false(KRX 정상) 且 KIS·KRX 동시 materialized** 케이스에서는 본 재정렬로 KIS 가
  우선 선택된다 — 이는 **의도된 KIS-first 동작**이며(양쪽 L1, SHADOW_ONLY, executionImpact=NONE,
  live 무영향) 표시·귀속 라벨만 바뀐다. (후속 권고: 해당 동시충족 selection 회귀 테스트 1건 추가.)

## Consequences

- **coverage 회귀 제거**: router-usable KIS coverage 2/11 → 기대 7~10/11(버킷 갈림 종목 복구). SHADOW
  관찰 row 증가(ADR-0476 ledger 긍정).
- **불변식 #6 보존**: KRX/KIS 빈응답은 `providerIssue=true; marketSignal=false` 분리 유지. provider
  선택만 바꾸고 UNKNOWN→bearish 변환을 도입하지 않는다.
- **불변식 #7 보존**: L4(estimate) 미도입(ADR-0543 분리). 본 PR 은 L1(FHPTJ04160001) 한정.
- **executionImpact=NONE**: engineMode=SHADOW_ONLY, liveExecutionAllowed=false 불변. live 영향 0.
- **단일 통로 준수**: 모든 KIS 호출 `query.ts`(realDataKisGet SSOT). raw KIS/KRX 신규 호출 0. krxClient 무수정.

## Guardrails

- No live trading path change. (autoTradeEngine/orderExecutor/kisClient order 무변경.)
- No SourceSnapshot/Gate/regime change. (provider 선택·파싱만 — snapshot 구조 불변, 불변식 #3/#4/#9.)
- No L4 estimate introduction. (investor-trend-estimate 호출 추가 0 — ADR-0543 분리.)
- No krxClient change. (옵션 B 비채택.)
- KIS quota 0 추가. (이미 받은 응답 파싱·registry 메타·priority 상수만.)
- Rollback: `KIS_INVESTOR_OUTPUT_BUCKET_FIX=false` 1줄(C-c1) + priority 상수 1줄 revert(A).
- Provider issue remains separated from market signal. UNKNOWN remains UNKNOWN.
