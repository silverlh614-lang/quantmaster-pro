# ADR-0655 — Gate2 재무 위험종목 선별 (FUNDAMENTAL_QUALITY 점수 페널티)

- Status: Accepted (타입·flag 계약 단계 / 구현 engine-dev 인계)
- Date: 2026-06-26
- Type: ADR (신규 경계·정책 — Gate2 축 점수 페널티 + flag 도입)
- Branch: `claude/gate1-scoring-analysis-gr9y33`
- Supersedes / Touches: ADR-0519(Gate2 confluence), ADR-0529(DART canonical inclusion),
  ADR-0532(KIS finance primary), ADR-0641(flag lifecycle), ADR-0157(flag opt-in 패턴).
- 현 engineMode: SHADOW_ONLY (live 주문 0).

---

## Context

Gate2 FUNDAMENTAL_QUALITY 축(`server/quant/gate2ConfluenceScore.ts` `buildFundamentalAxis`)은
이미 `interestCoverageRatio`(ICR)·`debtRatio` 입력 path 를 읽지만, 다음 두 갭이 있다.

1. **재무 위험종목 미선별.** 현행 로직은 `icrOk = icr == null || icr >= 2`(graceful) 로 ICR 을
   *상향 가산* 조건으로만 쓰고, **ICR<1(이자 미충당) 또는 부채비율 과다를 명시 강등하지 않는다.**
   부채비율(`debtRatio`)은 표시 metric 으로만 carry 되고 score 판정에 미반영이다.
   결과적으로 이자비용을 영업이익으로 충당하지 못하는 부실 종목이 다른 축(RS/Supply/Sector)
   점수만으로 Gate2 를 통과할 수 있다.

2. **ICR 커버리지 출처 혼선.** 본 작업 착수 시 "KIS stability-ratio 가 ICR·부채비율 둘 다 제공"
   이라는 가정이 있었으나, **KIS 공식 소스 1:1 검증 결과 ICR 은 KIS finance ratio 엔드포인트로
   산출 불가**다 (아래 §데이터 정밀화). 부채비율만 KIS L1 으로 복구 가능하다.

본 ADR 은 (a) 정확한 KIS 필드 매핑 확정, (b) FUNDAMENTAL_QUALITY 위험 페널티 규약,
(c) flag default OFF byte-identical 계약을 고정한다. 구현은 engine-dev.

---

## 데이터 정밀화 — KIS 공식 필드 매핑 (정본 chk_*.py COLUMN_MAPPING)

정본 소스: `open-trading-api-main/examples_llm/domestic_stock/finance_*/chk_*.py`.

### stability-ratio (FHKST66430600, v1_국내주식-083)

| KIS 필드 | 한글 | QmpDartFinancials / KisFinancials 매핑 | 등급 |
|----------|------|----------------------------------------|------|
| `lblt_rate` | 부채 비율 | `debtRatio` (%) | **L1** |
| `bram_depn` | 차입금 의존도 | (미사용) | L1 |
| `crnt_rate` | 유동 비율 | `currentRatio` (%) | L1 |
| `quck_rate` | 당좌 비율 | (미사용) | L1 |
| `stac_yymm` | 결산 년월 | `fiscalYearMonth` | — |

### profit-ratio (FHKST66430400, v1_국내주식-081)

| KIS 필드 | 한글 | 매핑 | 등급 |
|----------|------|------|------|
| `cptl_ntin_rate` | 총자본 순이익율 | (참조) | L1 |
| `self_cptl_ntin_inrt` | 자기자본 순이익율 (≈ROE) | `roe` 대체 후보 | L1 |
| `sale_ntin_rate` | 매출액 순이익율 | `netMargin` 대체 후보 | L1 |
| `sale_totl_rate` | 매출액 총이익율 | (참조) | L1 |

### financial-ratio (FHKST66430300, 현행 사용 중)

`roe_val`(ROE) · `lblt_rate`(부채비율) · `grs`(매출증가율) · `bsop_prfi_inrt`(영업이익증가율) ·
`eps` · `bps`. → 부채비율은 financial-ratio·stability-ratio 둘 다 `lblt_rate`(동일 L1).

### income-statement (FHKST66430200, 현행 사용 중)

`sale_account`(매출액) · `op_prfi`(경상이익) · `bsop_prti`(영업이익) ·
`bsop_non_expn`(영업외비용) · `thtr_ntin`(당기순이익).

### ICR(이자보상배율) 미가용 — 결정적 제약

**KIS finance ratio 엔드포인트는 이자비용(interestExpense)을 분리 노출하지 않는다.**
이자비용은 `bsop_non_expn`(영업외비용) 안에 묶여 있고 단독 추출이 불가능하다.
따라서 ICR = 영업이익 / 이자비용 을 **KIS 단독으로 산출할 수 없다.** 정확한 ICR 은
DART 잔존(`QmpDartFinancials.interestExpense` → `interestCoverageRatio`, L2) 머지에서만 온다.

→ ICR field source = `DART_L2_RESIDUAL` (KIS 미가용 시 `UNAVAILABLE`).
→ debtRatio field source = `KIS_L1` (lblt_rate). 본 ADR 의 두 trigger 중 **debtRatio 만 L1 복구**,
  **ICR 은 L2 잔존 의존**임을 명시한다 (착수 가정 정정).

---

## Decision

### D1 — KIS 재무 필드 계약 확장 (kisFinanceClient.ts)

`KisFinancials` 에 `interestCoverageRatio: number | null`(KIS 단독 항상 null) +
`fieldSources`(metric 별 출처: `KIS_L1` | `KIS_DERIVED` | `DART_L2_RESIDUAL` | `UNAVAILABLE`) 추가.
debtRatio 는 financial-ratio·stability-ratio 둘 다 `lblt_rate` fallback (둘 다 KIS_L1).

### D2 — FUNDAMENTAL_QUALITY 재무 위험 페널티 (별도 순수 모듈)

신규 순수 모듈 `gate2FinancialRiskPenaltyAdr0655.ts`(engine-dev)가 위험 평가를 산출하고,
`buildFundamentalAxis` 가 flag ON 시 산출 score 에 **score-cap(Math.min)** 을 적용한다.
입력은 기존 `Gate2ExternalProjection.stability.{icr,debtRatio}`(ADR-0529 canonical merge) 재사용
— **신규 fetch 0**. `gate2ConfluenceScore.ts`(현 1185줄) 비대화 방지 위해 별도 모듈.

위험 평가 규약 (타입 SSOT = `server/trading/gate2/gate2FinancialRiskTypes.ts`):

| 조건 | riskLevel | triggers | FUNDAMENTAL_QUALITY scoreCap |
|------|-----------|----------|------------------------------|
| 위험 0건 (또는 입력 결손) | `NONE` | `[]` | `null` (cap 미적용 — byte-identical) |
| ICR<1 단독 **또는** 부채>200% 단독 | `ELEVATED` | 1개 | **30** (WEAK 대역) |
| ICR<1 **AND** 부채>200% | `CRITICAL` | 2개 | **15** (심층 WEAK) |

`scoreCap` 은 *상한* 이라 정상 종목 점수를 올리지 않는다. cap 적용은 FUNDAMENTAL_QUALITY 축
(가중 15점) 점수만 누른다 — **Gate2 pass 경계는 `coverageAdjustedScore` 로만 판정**하며
본 cap 은 그 한 축의 입력값일 뿐 전체 차단이 아니다.

### D3 — flag (ADR-0157 패턴, default OFF)

SSOT `gateConfig.isGate2FinancialRiskPenaltyEnabled()` = `GATE2_FINANCIAL_RISK_PENALTY_ENABLED === 'true'`.
호출자 inline ENV 검사 금지. flag_lifecycle.json(ADR-0641) 1행 등재(SHADOW_OFF).

---

## 임계 baseline 근거 (§임계근거)

- **ICR < 1 (`GATE2_ICR_DISTRESS_THRESHOLD = 1`).** 이자보상배율 = 영업이익 / 이자비용.
  ICR<1 은 영업이익이 이자비용조차 충당하지 못한다는 의미 — 한계기업(좀비기업) 판정의
  국제 표준 경계(영업으로 이자도 못 갚음)다. 현행 `icr>=2` 상향 가산과 분리해 **<1 만 강등 trigger**
  로 채택(1~2 구간은 강등 아님 — 보수적). flip 후 ROC 로 1.0 ↔ 1.5 재보정 가능.
- **부채비율 > 200% (`GATE2_DEBT_RATIO_EXCESS_THRESHOLD = 200`).** 부채비율 = 부채총계 / 자기자본.
  한국 시장 통념상 200%(부채가 자기자본의 2배)가 재무 건전성 경계선으로 통용된다
  (과거 정부 부채비율 200% 가이드라인·신용평가 관행). 업종(금융·건설 등 구조적 고부채) 보정은
  본 ADR 범위 밖 — 단순 임계로 시작하고 forward-outcome 관측 후 업종 보정은 후속 ADR.
- **scoreCap 30(WEAK) / 15(CRITICAL).** `scoreStatus`(gate2ConfluenceScore.ts) 기준 score<45=WEAK.
  cap 30 은 WEAK 대역 진입, cap 15 는 심층 WEAK(2건 동시 = 부실 강도 가산). 하드차단(0)이 아닌
  이유: 불변식 #6(데이터 해석 ≠ market signal) + 다축 confluence 가 위험을 상쇄할 여지 보존.

---

## 불변식 #6 보존 논거 (Provider 장애 ≠ market signal, 재무 위험 ≠ bearish)

- 재무 위험(ICR<1·부채과다)은 **확정된 재무 사실의 해석**이지 provider 장애도 약세 시장 신호도
  아니다. 본 평가는 `marketSignal=false` / `executionImpact='NONE'` literal 을 강제하고
  `entryHardBlock=false`(점수 cap 만)로 묶어 매매 의사결정/engineMode 를 직접 바꾸지 못하게 한다.
- **결손(graceful):** ICR/부채비율 입력이 null 이면 해당 trigger 평가를 skip 하고 페널티를
  적용하지 않는다 — *결손 ≠ 위험 ≠ bearish*. 결손을 강등으로 변환하면 불변식 #6 위반이다.
- Gate2 score-cap 은 SourceSnapshot 을 바꾸지 않으며(불변식 #3/#9), Policy/Confidence/
  ExecutionPermission 도 직접 바꾸지 않는다 — FUNDAMENTAL_QUALITY 한 축의 입력 점수만 누른다.

---

## flag OFF = byte-identical 논거

- OFF(미설정·임의값) 시 `buildFundamentalAxis` 는 현행 score 산출 경로를 100% 유지
  (scoreCap 미적용). cap 호출 분기 자체가 flag gate 뒤에 있다.
- ON 이어도 위험 trigger 0개 종목은 `scoreCap=null` → `Math.min(score, null)` 미적용
  → byte-identical.
- ON + 위험 종목만 score 가 이동한다. ENV `GATE2_FINANCIAL_RISK_PENALTY_ENABLED` 제거(또는
  미설정)로 1줄 즉시 롤백.

---

## Consequences

- (+) 이자 미충당·고부채 부실 종목이 Gate2 FUNDAMENTAL_QUALITY 에서 강등 → Gate2 통과
  종목 재무 건전성 향상(forward-outcome 으로 검증 예정).
- (+) ICR 출처 혼선 정정(KIS 미가용·DART 잔존 의존) 문서화 — 향후 dev 가 KIS 로 ICR 을
  복구하려다 실패하는 회귀 방지.
- (−) ON 시 FUNDAMENTAL_QUALITY score 분포 이동 → Gate2 pass 율 일부 감소(의도). flip 전
  shadow 관측 필수.
- (−) ICR trigger 는 DART 커버리지에 의존 — DART 결손 종목은 ICR trigger 미발동(부채 trigger 만).
  graceful 이므로 안전하나 ICR 선별 커버리지는 DART 가용성에 비례.

---

## Alternatives Considered

1. **하드차단/태그(entryHardBlock=true).** 기각 — 불변식 #6 위반 위험 + 다축 confluence 상쇄
   여지 제거. 사용자 승인 스코프(점수 페널티)와 불일치.
2. **KIS 로 ICR 산출(bsop_non_expn 사용).** 기각 — 영업외비용은 이자비용 외 항목(환차손 등)을
   포함해 ICR 근사가 부정확. DART interestExpense(L2) 잔존 유지가 정확.
3. **gate2ConfluenceScore.ts 인라인 구현.** 기각 — 현 1185줄, 1500 한계 근접. 별도 순수
   모듈로 분리(ARCHITECTURE.md 복잡도 정책).
4. **부채비율 단일 trigger.** 기각 — ICR 은 부도 직접 신호(이자 미충당)라 부채비율과 직교한
   위험 차원. 둘 다 trigger 로 두되 동시 발생 시 CRITICAL 가산.

---

## Rollback

ENV `GATE2_FINANCIAL_RISK_PENALTY_ENABLED` 미설정/제거 → flag OFF → byte-identical.
타입 추가(`interestCoverageRatio`/`fieldSources`)는 additive optional 계약이라 OFF 동작 무영향.

---

## References

- 정본 KIS 필드: `open-trading-api-main/.../finance_stability_ratio/chk_finance_stability_ratio.py`,
  `.../finance_profit_ratio/chk_finance_profit_ratio.py`,
  `.../finance_income_statement/chk_finance_income_statement.py`,
  `.../finance_financial_ratio/chk_finance_financial_ratio.py`.
- 타입 SSOT: `server/trading/gate2/gate2FinancialRiskTypes.ts`.
- flag SSOT: `server/trading/gateConfig.ts` `isGate2FinancialRiskPenaltyEnabled()`.
- 소비 지점: `server/quant/gate2ConfluenceScore.ts` `buildFundamentalAxis` (engine-dev 구현).
- 정책: `docs/ai/05-provider-policy.md`(KIS Primary·불변식 #6), ADR-0529/0532(canonical 재무).
- engine-dev 인계: `_workspace/2026-06-26_gate2-financial-risk-screen/architect/handoff.md`.
