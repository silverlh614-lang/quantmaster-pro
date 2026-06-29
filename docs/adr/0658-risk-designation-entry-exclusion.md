# ADR-0658 — Risk-Designation Entry Exclusion (위험·경고 종목 후보 제외)

- Status: Accepted (운영자 silverlh614 risk-exclusion 명시 요청 — 서산 079650 투자경고 -10% stop 사례)
- Date: 2026-06-29
- 계보: 0657(INTRADAY_MOVER 주입 — 노출 증폭 맥락) · 0652(leader 랭킹 endpoint 정정) · 0529(Gate2 canonical merge) · 0157(flag 비교 규약) · 0641(flag-lifecycle 거버넌스) · 0146(LIVE 안전·byte-equivalent) · 0530(Patch Scope Guard)

## Context — Root Cause

운영자가 서산(079650) — 투자경고 지정 종목 — 에 shadow 진입이 발생해 -10% stop 에 걸린 사례를 보고하고,
위험·경고 지정 종목을 진입에서 제외할 것을 명시 요청했다. 근본 원인(검증):

- KIS 위험·경고 지정 검사는 `server/screener/stockScreener.ts`(`isRiskyKisRow`)·`server/screener/universeScanner.ts`
  에만 존재하며, **랭킹-TR row**(`s.mrkt_warn_cls_code`/`s.iscd_stat_cls_code`/`s.trht_yn`/`s.sltr_yn`/`s.mang_issu_*`)
  에 대해서만 판정한다. 랭킹-TR 응답은 일반적으로 이 지정 필드를 채우지 않아 → 랭킹 소스 후보에 사실상 no-op.
- 권위 소스는 detailed quote `inquire-price`(trId FHKST01010100)로, 출력(KIS 공식 `chk_inquire_price.py` 검증)에
  `iscd_stat_cls_code`(종목상태구분)·`mrkt_warn_cls_code`(00없음/01투자주의/02투자경고/03투자위험)·
  `short_over_yn`(단기과열 Y/N)·`mang_issu_cls_code`(관리종목)·`trht_yn`(거래정지)·`sltr_yn`(정리매매)을 포함한다.
- 그러나 `kisOfficialQuoteMapper.ts`(NormalizedKisOfficialQuote)가 이 필드들을 추출하지 않아 → 지정이 fetch 된 뒤
  **DROP** → downstream/entry guard 부재(buyPipeline/autoTrade/perSymbol grep 결과 가드 없음).
- ADR-0657(INTRADAY_MOVER top changeRate 주입)이 노출을 증폭한다 — top gainers 가 KRX-flagged 일 확률이 가장 높다.

## Decision — 4 parts

### 1. 지정 carry (신규 KIS fetch 0 — inquire-price 가 이미 반환)

`kisOfficialQuoteMapper.ts` 에서 `iscd_stat_cls_code`/`mrkt_warn_cls_code`/`short_over_yn`/`mang_issu_cls_code`/
`trht_yn`/`sltr_yn` 을 `NormalizedKisOfficialQuote.designation?`(nested optional)으로 추출한다. `fetchKisQuoteFallback`/
`fetchKisIntraday` 가 attach 하는 `quote.kisOfficialQuote` 로 자연 전파(additive — 기존 consumer 무영향).

### 2. 순수 SSOT 분류기 (신규 모듈)

`server/trading/riskDesignationClassifier.ts` `isRiskDesignatedStock(designation) → { excluded, reason? }`. ANY 조건 시 제외:
거래정지/정리매매/관리종목 · `marketWarnCode ∈ {01,02,03}` · 단기과열 · 위험 `iscd_stat_cls_code`. 결손/미존재 → 미제외(graceful).

**제외하는 iscd_stat_cls_code 와 근거**: `51`(관리종목)·`52`(투자위험)·`53`(투자경고)·`54`(투자주의)·`56`(위험예고)·
`58`(거래정지)·`59`(단기과열). benign 으로 분리해 **제외하지 않는** 코드: `00`(그외/정상)·`55`(신용가능, 거래 가능 상태).
불확실 코드는 over-filter 회피를 위해 위험 집합에서 보수적으로 누락(missing ≠ risk). 시장경고/거래정지/관리는 별도 boolean
필드로 1차 판정되므로 본 코드셋은 보강(redundant-safe)일 뿐 단일 의존이 아니다.

### 3. 단일 per-symbol chokepoint 가드 (모든 candidate 소스 포괄)

`server/trading/signalScanner/perSymbol/buyListLoop.ts` 에서 `kisIntradayCorrectionStep` 이 산출한 `reCheckQuote`
(`kisOfficialQuote.designation` carry)가 가용한 시점 — Gate1 entry candidacy 직전 — 에 `evaluateRiskDesignationGate`
(`perSymbol/steps/riskDesignationGate.ts`)를 둔다. 모든 candidate 소스(INTRADAY_MOVER/WATCHLIST/universeScanner/
prior-carry)가 이 단일 chokepoint 를 통과한다. 제외 시 silently drop 하지 않고 `RISK_DESIGNATION_EXCLUDED`(reason 포함)
진단(perStageDropoff LIVE_ORDER_BLOCKED=BLOCKED)을 남겨 `/scan_blockers` 에 노출한다. 위쪽 counterfactual/provisional
학습 lane 은 이미 실행돼 관측 연속성을 유지하되(불변식 #2), paper/shadow ENTRY 는 되지 않는다.
기존 `isRiskyKisRow` 랭킹-row 사전필터는 그대로 유지(cheap pre-filter)한다.

### 4. Flag + governance

`gateConfig.ts` `isRiskDesignationExclusionEnabled()` → `process.env.RISK_DESIGNATION_EXCLUSION_ENABLED !== 'false'`
(default ON kill-switch — 운영자 명시 요청; `=false` 롤백). 호출자 inline ENV 검사 금지 — SSOT only.

## Scope / Safety (Patch Scope Guard, ADR-0530 — 11 fields)

- targetDomain: (1) quote mapper designation carry (2) 순수 분류기 (3) per-symbol entry chokepoint 가드 — 3 도메인.
- allowedFiles: `kisOfficialQuoteMapper.ts` · `riskDesignationClassifier.ts`(신규) · `riskDesignationGate.ts`(신규) ·
  `buyListLoop.ts`(가드 wiring) · `gateConfig.ts`(flag) · 테스트 · 거버넌스(ADR/INDEX/patch-history/.env/flag-lifecycle).
- forbiddenFiles: autoTradeEngine order 본문 · buyPipeline order placement · SourceSnapshot 생성기 ·
  Gate1 score curves(ADR-0471) · requiredScore=70 SSOT · src/**.
- expectedBehaviorChange: 위험·경고 지정 종목이 ENTRY(paper/shadow 포함) 후보에서 제외 — candidate-eligibility EXCLUSION only.
- sourceSnapshotImpact: 없음(designation 은 quote additive 필드, SourceSnapshot 생성기 무접촉; 불변식 #3/#9).
- executionImpact: **candidate EXCLUSION only — 엄격히 더 보수적**. engineMode SHADOW_ONLY 라 live 주문 0.
- shadowLearningImpact: 제외 종목도 위쪽 counterfactual/provisional 학습 lane 관측은 유지(차단 ≠ 삭제, 불변식 #2).
- telegramImpact: `/scan_blockers` perStageDropoff 에 RISK_DESIGNATION_EXCLUDED 노출(진단 가시화).
- providerImpact: 신규 KIS/KRX/Yahoo fetch 0 — inquire-price 가 이미 반환하는 필드 carry 만(ADR-0561 정합).
- testsRequired: 분류기(각 지정 → excluded/reason · 정상/결손 → 미제외) · mapper(designation carry/undefined) ·
  가드(위험 → EXCLUDE+진단 · flag=false → byte-identical).
- rollbackPlan: `RISK_DESIGNATION_EXCLUSION_ENABLED=false` 1줄 → 제외 미적용 byte-identical.

## 9대 불변식

- #1 Trading Engine 보존 — 가드는 순수 판정 + continue, try/catch 흐름 무영향.
- #2 Shadow Learning 보존 — 제외 종목도 counterfactual/provisional 관측 lane 유지(차단 ≠ 학습 정지).
- #6 provider issue ≠ bearish — designation 결손/미존재 → 미제외 graceful(부재 ≠ 위험), market signal 생성 0.
- #7 품질 필터 우회 0 — 본 가드는 후보 자격 *축소*(더 보수적)이며 Gate0~3+requiredScore70 우회 아님.
- #8 실거래 차단과 Shadow 판단 분리 — flag 는 ENTRY 후보 제외만, shadow 관측은 별도 유지.

## Note — 단기과열(short_over_yn) 기본 제외의 trade-off

운영자 "위험종목 안건드림" 요청에 따라 단기과열도 default 제외한다. 단, 대형주 rally-leader 가 종종 단기과열에
지정되므로 **이 제외가 주도주 포착을 줄일 수 있다**. flag-lifecycle nextAction 에 명시 — over-filter 관측 시 운영자가
단기과열 제외만 재검토(분류기에서 단기과열 분기 분리/완화) 가능. 본 ADR 은 운영자 명시 요청대로 전체 제외로 출하한다.
