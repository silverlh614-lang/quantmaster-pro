# ADR-0656 — Gate2 재무위험 페널티 default-ON flip — `isGate2FinancialRiskPenaltyEnabled` `=== 'true'` → `!== 'false'`

@responsibility ADR-0655(Gate2 재무위험 페널티, default OFF byte-identical 출하)가 도입한 FUNDAMENTAL_QUALITY score-cap 의 코드 default 를 OFF→ON 으로 flip 하는 경계·정책·SSOT 계약 SSOT — `gateConfig.ts` 의 `isGate2FinancialRiskPenaltyEnabled` ENV 비교를 `=== 'true'`(default OFF)에서 `!== 'false'`(default ON, explicit `=false` kill-switch 보존)로 전환. 운영자 승인 하 default ON 승격. 의미론 ADR-0655 그대로(ICR<1·부채>200%→scoreCap 30/15·graceful·불변식 #6)·requiredScore=70 무접촉·현 engineMode=SHADOW_ONLY live 주문 0 안전창.

- **Status:** Accepted (운영자 silverlh614 default-on 승인 — ADR-0655 가 OFF byte-identical 로 출하한 Gate2 재무위험 페널티를 default ON 으로 승격. 현 engineMode=SHADOW_ONLY 라 live 주문 0 안전창에서 flip, shadow forward-outcome 으로 강등 타당성 지속 관측.)
- **Date:** 2026-06-26
- **Branch:** claude/gate1-scoring-analysis-gr9y33
- **Supersedes / Extends:** ADR-0655(Gate2 재무위험 페널티 도입 — 본 ADR 이 그 "운영자 승인 후 default-ON flip" 단계를 충족·supersede)·ADR-0649(pullback-entry-lane default-ON flip — 동일 `=== 'true'`→`!== 'false'` 패턴 직전 선례)·ADR-0647(VOLUME_LIQUIDITY default-ON flip)·ADR-0645(SECTOR_RS default-ON flip)·ADR-0644(safe-lever 3종 default-ON flip — opt-OUT 패턴 원형)·ADR-0529(DART canonical merge — stability.{icr,debtRatio} 입력)·ADR-0532(KIS finance primary)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0641(flag-lifecycle governance — 본 ADR 이 0655 status SHADOW_OFF→ON flip)·ADR-0157(ENV 정확 비교 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`)·ADR-0146(byte-equivalent·ENV 1줄 롤백)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 정책 — default OFF→ON flip = ENV 계약 변경, flag-lifecycle status 전환). INDEX.md 0656→0657 갱신 의무.

---

## Context

ADR-0655 가 Gate2 FUNDAMENTAL_QUALITY 재무위험 페널티(ICR<1 이자 미충당 / 부채비율>200% 과다 → score-cap)를 별도 순수 모듈(`gate2FinancialRiskPenaltyAdr0655.ts`)로 구현하되 default OFF(`=== 'true'`)로 byte-identical 출하했다. ADR-0655 §flag OFF=byte-identical 논거와 nextAction 은 "운영자 ENV `=true` 활성 → 강등 종목 forward-outcome 관측 → 운영자 승인 후 default-ON flip(후속 ADR)"을 명시했다.

본 ADR 이 그 후속 flip 을 충족한다 — 운영자(silverlh614)가 재무위험 페널티의 default-ON 승격을 승인했다.

- 현 engineMode=SHADOW_ONLY 라 live 주문 0 안전창 — default ON 으로 실 채점 경로에서 재무위험 강등을 점화하되 live 집행은 없다(불변식 #8 실거래 차단 ≠ Shadow 차단).
- 저위험 — 본체(평가 모듈 `assessGate2FinancialRisk`·`buildFundamentalAxis` score-cap seam) 0줄 변경, default 해석만 전환. 위험 trigger 0건/임계 결손 종목은 ON 이어도 byte-identical(scoreCap=null·graceful).

이는 ADR-0641 거버넌스가 제도화한 "flip 강제"(SHADOW_OFF flag 는 reviewBy 만료 전 flip/sunset/연장 중 하나)에 부합하는 운영자 승인 기반 flip 이다. ADR-0649(pullback-entry-lane)·ADR-0647(VOLUME_LIQUIDITY)·ADR-0645(SECTOR_RS)가 `=== 'true'`→`!== 'false'` 로 flip 한 것과 정확히 같은 패턴이다.

## Decision

**D1.** `server/trading/gateConfig.ts` 의 `isGate2FinancialRiskPenaltyEnabled` ENV 비교를 `=== 'true'`(default OFF) → `!== 'false'`(default ON)로 전환. 미설정/임의값 → ON, 정확히 `'false'` 만 OFF(ADR-0157 opt-IN 의 거울 대칭, explicit kill-switch 한정). reader 1줄 변경, OFF=`=false` 1줄.

**D2.** flag ON 의미론은 ADR-0655 그대로: ICR<1 단독 또는 부채>200% 단독 → ELEVATED scoreCap 30(WEAK), ICR<1 AND 부채>200% → CRITICAL scoreCap 15. 입력은 기존 `Gate2ExternalProjection.stability.{icr,debtRatio}`(ADR-0529 canonical merge) 재사용·신규 fetch 0·신규 공식 0. 임계 입력 결손(ICR/부채 null) → 페널티 미적용 graceful(결손≠위험). 위험 trigger 0건 → scoreCap=null byte-identical. 평가 모듈·seam·kisFinance 배선 무변경.

**D3.** flag-lifecycle 레지스트리(`scripts/gate_flag_lifecycle.json`)의 0655 status SHADOW_OFF→ON(ADR-0641 거버넌스 flip 충족). `.env.example` 주석 default ON·`=false` 롤백 정합.

**D4.** requiredScore=70 리터럴 불변·ADR-0471 Gate1 weighted curve FREEZE 무접촉·ADR-0532 KIS primary 무접촉·9대 불변식 무위반·현 engineMode=SHADOW_ONLY 라 live 주문 0 안전창(#8 실거래 차단 ≠ Shadow 차단). explicit `GATE2_FINANCIAL_RISK_PENALTY_ENABLED=false` 1줄 즉시 byte-equivalent 롤백.

## Consequences

- **executionImpact:** flag OFF(`=false`)=byte-identical(cap 미적용·FUNDAMENTAL_QUALITY 현행 score·LIVE 본체 0줄·KIS/KRX quota 0). default ON=gate2-scoring-adjacent(위험종목 FUNDAMENTAL_QUALITY WEAK/CRITICAL 강등·Gate2 pass 분포 일부 감소·의도). 현 SHADOW_ONLY 라 live 주문 0줄·autoTradeEngine/kisClient/order/SourceSnapshot 0줄·신규 fetch 0. entryHardBlock=false(점수 cap 만·Gate2 pass 는 coverageAdjustedScore 로만 판정)·marketSignal=false·executionImpact=NONE(불변식 #6).
- **byte-identical 깨짐(의도적 behavior change):** 기존 "default OFF byte-identical" 단언 테스트는 explicit `=false` pin 으로 의도 보존(단언 약화 0). default(미설정)=ON 신규 케이스 추가(위험종목 cap 적용 확인). 위험 0건/결손 graceful 케이스는 ON 이어도 byte-identical 유지.
- **Rollback:** `GATE2_FINANCIAL_RISK_PENALTY_ENABLED=false` ENV 1줄 → cap 미적용·FUNDAMENTAL_QUALITY 현행 score byte-equivalent 복귀.

## ADR-0146 PR 자가 review (5 카테고리)

1. **LIVE 매매 안전성** — requiredScore=70 SSOT·ADR-0471 Gate1 곡선·ADR-0532 KIS primary 무접촉·KIS/KRX quota 0·신규 fetch 0·현 SHADOW_ONLY live 0줄·ENV `=false` 1줄 롤백. entryHardBlock=false(점수 cap 만)·executionImpact=NONE 불변. 운영자 default-on 승인 후 승격.
2. **wiring 완료 vs 인프라만** — reader default 1줄 flip(engine-dev) + lifecycle status + 문서 정합. ADR-0655 이 이미 score-cap seam·평가 모듈 배선 완료, 본 ADR 은 default 만 전환(인프라만 두지 않음). 죽은 OFF 분기는 ENV 롤백 보존 위해 유지.
3. **ADR 발급 무결성** — INDEX 다음 발급 0656→0657, 표 0656 행, 최대 발급 0656. 단일 발급 통로 준수.
4. **회귀 테스트 적정성** — gate2ConfluenceScore.test.ts: OFF byte-identical 케이스 explicit `=false` pin(의도 보존) + default(미설정)=ON 위험종목 CRITICAL cap ≤15 신규 + default ON+위험0건 byte-identical graceful 신규. gate2FinancialRiskPenaltyAdr0655.test.ts(순수 평가, flag 무관) 무회귀 유지. signalScanner baseline 무회귀.
5. **정책 위반 baseline 무회귀** — Yahoo-first 0(입력은 KIS L1 debtRatio·DART L2 ICR 파생·신규 fetch 0)·SourceSnapshot 우회 0(불변식 #3/#9)·silent catch 0·복잡도 무관(reader 1줄)·9대 불변식 무위반.

## Patch Scope Guard (ADR-530)

- **targetDomain:** gate2-scoring (1 도메인).
- **allowedFiles:** `server/trading/gateConfig.ts`(reader 1줄) · `server/quant/gate2ConfluenceScore.test.ts`(OFF pin + default-ON 신규) · `.env.example`(0655 flag 주석) · `scripts/gate_flag_lifecycle.json`(0655 status) · `docs/adr/0656-*.md`(신규) · `docs/adr/INDEX.md` · `docs/ai/10-patch-history-index.md`.
- **forbiddenFiles:** `gate2FinancialRiskPenaltyAdr0655.ts`(평가 모듈 본체) · `gate2ConfluenceScore.ts` buildFundamentalAxis score-cap seam 산식 · `gate2FinancialRiskTypes.ts` · kisFinanceClient 배선 · autoTradeEngine · buyPipeline · kisClient · SourceSnapshot 생성기 · requiredScore=70 calibration SSOT · ADR-0471 Gate1 weighted curve · `src/**`.
- **expectedBehaviorChange:** default(미설정)에서 재무위험종목(ICR<1·부채>200%) FUNDAMENTAL_QUALITY score-cap 적용(WEAK/CRITICAL 강등). **sourceSnapshotImpact:** 없음(stability.{icr,debtRatio} 입력만 소비·불변식 #3/#9). **executionImpact:** flag OFF=NONE byte-identical / default ON=gate2-scoring-adjacent(현 SHADOW_ONLY live 0). **shadowLearningImpact:** 위험종목 점수 분포 하향(의도)·forward-outcome 으로 강등 타당성 관측. **telegramImpact:** /scan_blockers·gate2 evidence 에 gate2FinancialRisk trace 노출(ON). **providerImpact:** 없음(신규 fetch 0·기존 canonical merge 재사용·KIS/KRX quota 0). **testsRequired:** OFF `=false` pin + default-ON 위험종목 cap + default-ON 위험0건 graceful(engine-dev). **rollbackPlan:** ENV `=false` 1줄.

## Alternatives Considered

1. **Railway ENV `=true` 수동설정 유지** — 기각. 운영자 "코드 default flip" 의도 미충족·무덤 안티패턴 잔존(ADR-0641 D4). 운영자 승인 완료라 default 전환이 정도.
2. **하드코딩 ON(ENV 게이트 제거)** — 기각. kill-switch 상실(ADR-0146 롤백 위반). `!== 'false'` 가 default ON + explicit `=false` 1줄 롤백을 동시 보존.
3. **임계 동시 재보정(ICR 1.0↔1.5)** — 기각. default 전환과 임계 calibration 은 독립 레버. flip 후 forward-outcome ROC 로 별건 재보정(ADR-0655 §임계근거).
4. **requiredScore 70 동시 하향** — 기각(절대 보존, ADR-0467/0471). score-cap default 전환과 임계 완화는 독립.
5. **ADR-0655 에 병합 재발급** — 기각. 이미 머지됨, 신규 발급이 단일 통로 정합(ADR-0649 가 ADR-0648 에 병합하지 않은 것과 동일).

## 9대 불변식 영향

- **#3/#9 (SourceSnapshot SSOT·우회 금지):** 위반 없음 — score-cap 은 기존 stability.{icr,debtRatio}(ADR-0529 canonical) 입력만 소비, SourceSnapshot 미변경·Gate 내부 provider 직접 조회 0.
- **#6 (provider 장애 ≠ market signal):** 위반 없음 — 재무 위험은 확정된 재무 사실의 해석이지 provider 장애도 약세 시장 신호도 아니다. marketSignal=false·executionImpact=NONE·entryHardBlock=false literal 강제. 임계 결손(ICR/부채 null)=페널티 미적용 graceful(결손≠위험≠bearish). default 전환은 trigger 가 있는 종목의 강등에 한정.
- **#8 (실거래 차단 ≠ Shadow 차단):** 위반 없음 — explicit `=false`=byte-identical, 위험 trigger 0건/결손 graceful 은 ON 이어도 byte-identical. 현 engineMode=SHADOW_ONLY live 주문 0 안전창에서 flip.

## Rollback

ENV `GATE2_FINANCIAL_RISK_PENALTY_ENABLED=false` → flag OFF → cap 미적용 byte-identical. 평가 모듈·seam·타입 무변경이라 OFF 동작은 ADR-0655 OFF 와 byte-equivalent.

## References

ADR-0655 · 0649 · 0647 · 0645 · 0644 · 0529 · 0532 · 0471 · 0641 · 0157 · 0146 · 0530.
