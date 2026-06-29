# ADR-0658 — 종목별 투자자매매동향(FHPTJ04160001) 'UN' 마켓코드 Observe-Mode 진단 Probe

- Status: Proposed (Phase 0 — architect: 경계·타입 SSOT·flag 계약·ADR·INDEX 0658→0659·flag-lifecycle 1행 SHADOW_OFF·HANDOFF. probe 삽입 본문·UN params 빌더 변형·observe ledger stamp·테스트는 engine-dev 인계.)
- Date: 2026-06-29
- Operator: silverlh614
- 계보: 0477 / 0542 / 0561 / 0146 / 0641 / 0530 / 0657 / 0476
- targetDomain: kisClient-investor-flow-query (1)

---

## Context

09:26 스캔 실측 — 종목별 투자자매매동향(`FHPTJ04160001` KIS 일별 수급)
`gateEligibleRows=36/46`·`shadowOnlyRows=10/46`(일별 미정산/미materialize). 즉 46종목 중 10종목은
KIS 일별 수급이 빈 채로 들어와 gateEligible 판정에서 누락된다. ADR-0657 은 이 10 shadow-only 행을
**추정수급(HHPTJ04160200)** SHADOW fallback 으로 채우는 처방이나, 추정(L4)은 live execution 금지(불변식 #7)
라서 본질적 수급 커버리지(L1 정산) 회복이 아니다.

LIVE 호출 seam (재조사 불필요 · 검증됨):

- `server/clients/kisClient/query.ts:901` `fetchKisInvestorTradeByStockDaily`
  → `:348` `buildInvestorTradeByStockDailyParams(safeCode, dateKst)` 가 `FID_COND_MRKT_DIV_CODE: 'J'` 하드코딩.
- `:915-933` `dateCandidates` 루프 → `:934-944` `payloadClass.materialized` false 면 `return null`.
  **이 `null` 이 곧 shadow-only 행** (스캔 `shadowOnlyRows=10/46`).

공식 KIS SDK(open-trading-api `investor_trade_by_stock_daily.py` docstring)는 이 엔드포인트의
`FID_COND_MRKT_DIV_CODE` 를 **`J:KRX, NX:NXT, UN:통합`** 으로 명시한다. 즉 J(KRX 단일)가 못 잡는 행을
`UN`(통합 — KRX+NXT) 으로 재조회하면 정산 수급을 회복할 가능성이 있다.

### OPSQ2001 위험 근거 (중요)

`query.ts:185` 주석: `ADR-0146: comp-program-trade-today 의 시장구분코드는 U 가 아니라 J.
/sh rawDiag 에서 msg_cd=OPSQ2001 ERROR INVALID FID_COND_MRKT_DIV_CODE`.

**단 이는 다른 엔드포인트(comp-program-trade-today)의 'U' 이력**이다. investor-trade-by-stock-daily 의
`UN` 이 유효한지는 **검증되지 않은 가설**이다. UN 이 OPSQ2001 INVALID 를 반환하면 그것도 귀중한 증거
(=이 엔드포인트의 UN 미지원 확정)이므로, probe 는 이 에러를 swallow 하지 말고 **분류 기록**해야 한다.

---

## Decision

**observe-mode 진단 probe** 를 도입한다. flag ON 시, J 호출이 not-materialized(null)인 행에 **한해**
UN 으로 추가조회하여 다음 3개 사실을 ADR-0476 관찰 ledger / 스캔 진단에 기록한다:

1. `unMaterialized` — UN 호출 결과가 materialize 되었는가(J 가 놓친 행을 UN 이 잡았나).
2. `jMissedRowRecovered` — J 가 못 잡은 net-buy 를 UN 이 실제로 보유하는가(forward 증거).
3. `unInvalidOpsq2001` — UN 이 OPSQ2001 INVALID 를 반환했는가(=UN 미지원 확정 증거).

### 절대 원칙 (P2 의 본질)

**LIVE 'J' 호출은 1바이트도 바꾸지 않는다.** UN 은 shadow-only 행에 한해 **관찰만** 한다. 선택
provider·gateEligible 판정은 **영원히 J 결과 기반**. `fetchKisInvestorTradeByStockDaily` 반환값은
flag ON 이어도 J 결과(J-null 행은 여전히 `null`). 운영자가 N영업일 증거 확인 후 **별도 PR** 에서
live flip — **본 ADR 은 flip 이 아니다.**

### probe 삽입 위치

`query.ts:934` `if (!payloadClass.materialized)` 블록 — `return null` **직전**. flag OFF 면 probe 미진입
(추가 KIS 호출 0). flag ON + J materialized 면 probe **skip**(이미 :929 break 로 분기). flag ON + J null
인 경우에만 UN 재조회.

### probe 격리

- probe 는 `realDataKisGet` SSOT 단일통로 경유(불변식 #2/#9 — raw KIS 호출 금지).
- probe 전체를 try/catch 로 격리 — UN 실패가 J 결과·엔진에 절대 전파 금지(불변식 #1 엔진 생존).
- probe 결과/실패는 `marketSignal=false`·`executionImpact=NONE`·`providerIssue=true(UN 실패 시)`
  literal 로 고정(불변식 #6 — UN 미가용/INVALID 를 bearish 변환 금지).
- bounded probe — shadow-only 행(현 ~10) + flag ON 에만(전 종목 무차별 호출 금지, ADR-0561 quota).

### OPSQ2001 분류 재사용

UN INVALID 분류는 신규 함수 없이 기존 SSOT 재사용 — `supplyDiagnostics.ts:520`
`classifyEndpointRootIssue` 의 `msgCd === 'OPSQ2001' → 'PARAM_ERROR'` 판정을 호출해 `unInvalidOpsq2001`
플래그를 채운다(두 번째 OPSQ2001 판정 공식 금지·SRP).

---

## Consequences

- **(+)** J 가 놓친 10 shadow-only 행을 UN 이 잡는지 forward 증거가 ledger 에 쌓여, 운영자가 live flip
  여부를 데이터 기반으로 판단할 수 있다. UN 이 OPSQ2001 INVALID 면 그 자체가 "UN 미지원 확정" 증거로
  ADR-0657 추정수급 경로의 정당성을 보강한다.
- **(+)** LIVE byte-identical — flag OFF=무동작(추가 KIS 호출 0), flag ON 이어도 J 결과가 fetch
  반환값·선택·gateEligible 결정.
- **(−)** flag ON 시 shadow-only 행(현 ~10) 당 UN 추가 호출 1건 발생(bounded·quota 관리 범위 내).
- **(중립)** 본 PR 은 증거수집까지 — 수급 커버리지 실제 회복(live flip)은 N세션 증거 + 운영자 승인 후
  별도 PR.

---

## Alternatives Considered

1. **즉시 J→UN flip (기각)** — OPSQ2001 미검증 상태에서 LIVE 수급 선택을 UN 으로 바꾸면, UN 이
   INVALID 거나 KRX 단일과 다른 의미면 36 gateEligible 행의 수급 판정이 즉시 오염된다(LIVE 수급 위험·
   불변식 #6/#7 경계). probe 로 증거 확보가 선행.
2. **전 종목 probe (기각)** — 46종목 전부 UN 재조회는 quota 2배 소비(ADR-0561 quota 거버넌스 위반).
   J-null shadow-only 행(~10)에 bounded.
3. **UN INVALID swallow (기각)** — OPSQ2001 을 조용히 무시하면 "UN 미지원 확정"이라는 귀중한 증거를
   버린다. probe 가 이 에러를 분류 기록(Silent Catch 금지).
4. **flag 없이 즉시 ON (기각)** — 신규 KIS 호출 행위는 ADR-0146/0641 flag-lifecycle 거버넌스 대상.
   default OFF·SHADOW_OFF 등재·N세션 관측·운영자 flip 검토 의무.

---

## Patch Scope Guard (ADR-530 · 11필드)

- **targetDomain**: `kisClient-investor-flow-query` (1)
- **allowedFiles**:
  - `server/clients/kisClient/query.ts` — probe seam(:934 null 직전)·UN params builder 변형
  - `server/clients/kisClient/types.ts` — `InvestorFlowUnProbeResultAdr0658` 타입 계약
  - `server/trading/gateConfig.ts` — `isInvestorFlowUnMarketProbeEnabled()` SSOT flag
  - 신규 probe 순수/진단 모듈 (engine-dev 명명·예: `query/investorFlowUnMarketProbeAdr0658.ts`)
  - observe ledger stamp (ADR-0476 라인·`source='INVESTOR_FLOW_UN_PROBE'`)
  - `server/clients/kisClient/supplyDiagnostics.ts` — `classifyEndpointRootIssue` 재사용(읽기 전용 호출)
  - 해당 `*.test.ts`
  - `scripts/gate_flag_lifecycle.json` — 1행 SHADOW_OFF
  - `.env.example` — flag 주석
  - `docs/adr/0658-*.md`·`docs/adr/INDEX.md` 0658→0659·`docs/ai/10-patch-history-index.md` 1줄
- **forbiddenFiles**: `autoTradeEngine`·`buyPipeline`·`kisClient` 주문 경로·`SourceSnapshot` 생성기·
  Gate1 곡선/`requiredScore=70` SSOT·**live 'J' 선택로직 변경**·ADR-0477 라우터 `selectedProvider`·`src/**`
- **expectedBehaviorChange**: flag OFF=무동작(byte-identical). flag ON=J-null 행에 UN probe 1건 추가 +
  ledger stamp. fetch 반환값·선택·gateEligible 판정 무변경.
- **sourceSnapshotImpact**: NONE (SourceSnapshot 생성기 무접촉·probe 는 ledger stamp 만).
- **executionImpact**: NONE (LIVE 'J' 경로 byte-identical·현 engineMode=SHADOW_ONLY live 주문 0).
- **shadowLearningImpact**: observe ledger 에 UN probe 행 additive 기록(관측 전용·판정 미변경).
- **telegramImpact**: NONE (probe 는 Railway 로그/ledger 전용·Telegram 발송 0).
- **providerImpact**: flag ON 시 shadow-only 행(~10) 당 UN 추가 호출 1건(bounded·realDataKisGet SSOT 경유).
- **testsRequired**: OFF byte-identical / ON+J materialized=probe skip /
  ON+J null+UN materialized=ledger 기록·fetch 여전히 null / ON+UN OPSQ2001=INVALID 분류 기록·격리 /
  probe 예외 격리(UN throw 가 J/엔진 무전파).
- **rollbackPlan**: ENV `INVESTOR_FLOW_UN_MARKET_PROBE_ENABLED` 미설정/삭제 → 즉시 byte-identical baseline
  (추가 KIS 호출 0).

---

## References

- `server/clients/kisClient/query.ts:348`·`:901`·`:934`
- `server/clients/kisClient/supplyDiagnostics.ts:520` (`classifyEndpointRootIssue` OPSQ2001)
- `server/trading/gateConfig.ts:416` (flag SSOT 패턴 거울)
- ADR-0477 (investor-flow router)·0542 (output bucket realign)·0561 (KIS primary absolute)·
  0146/0641 (flag-lifecycle)·0530 (Patch Scope Guard)·0657 (추정수급 SHADOW fallback)·0476 (observe ledger)
- 공식 SDK `investor_trade_by_stock_daily.py` docstring (`J:KRX, NX:NXT, UN:통합`)
