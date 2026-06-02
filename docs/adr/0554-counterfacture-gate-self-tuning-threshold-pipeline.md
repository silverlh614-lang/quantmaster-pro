# ADR-0554: counterfacture-gate self-tuning threshold pipeline

@responsibility learning — counterfactual outcome 데이터로 Gate1/2/3 임계를 operator-gated 자기조정하는 read-only 파이프라인 경계 SSOT

## Status

Accepted (Phase A–H 머지 완료, commits 6a9fe644→9e266f08, 2026-06-02~03). LIVE 적용은 flag OFF 기본 — 데이터 성숙 + operator 승인 전까지 휴면.

## Context

게이트 임계(Gate1 minimum-signal 70 / Gate2 confluence 65 / Gate3 RRR 2)는 ADR-0008 Kelly Half-Life 와 같은 원리로 *데이터 기반 자가 진화* 대상이다. 두 반쪽이 이미 존재했으나 끊겨 있었다:

- **분석기** (ADR-0325) — `gateThresholdAutoTuning.evaluateThresholdShift` (Youden's J ROC). 호출자 0건 dead code.
- **outcome board** (counterfactualOutcomeBoard) + dry-run/counterfactual ledger.

진단 결과 진짜 블로커는 *데이터*였다. `gate1DryRunObservationLedger` 66행 중 forward-return 보유 0행 / mature 0행 — 근본원인은 `rowFromSnapshot` 이 `entryReferencePrice` 를 미stamp 해 `updateGate1DryRunObservationOutcomes`(entryPrice null→continue)가 실관측 전 행을 skip 한 것. "충분한 데이터 + 끊긴 연결"이 아니라 **첫 연결(write)이 끊겨 데이터가 0이었고, 그 위 분석 모듈도 따로 끊겨 있었다.**

또한 게이트는 순차구조라 selection bias 가 게이트마다 다르다 — Gate2/3 는 Gate1 생존자만 평가(조건화 정합), Gate1 은 near-miss 밴드만 관측(절단 표본). 비정상성(레짐 의존)·WIN 정의·overfitting 위험도 설계가 흡수해야 한다.

## Decision

5층 파이프라인을 신설하되, **기존 조각을 한 계약·한 분석기·한 적용 seam 으로 잇는다.** 전 단계 `executionImpact=NONE`, LIVE 적용은 flag OFF = byte-identical.

| 층 | 모듈 | 역할 |
|----|------|------|
| **A** 기록 | `gate1DryRunObservationLedgerAdr0476.rowFromSnapshot` | snapshot 가격 → `entryReferencePrice` stamp (keystone — 미stamp 시 전 단계 빈 출력). gate3 seed·gate2 seed 도 동일 원칙(scalar+entryReferencePrice+regime+forwardReturns) |
| **B** 투영 | `gateScoredOutcomeProjection` | 기존 ledger 위 on-demand 뷰(제3 영속파일 미신설). WIN 정의 SSOT `GATE_OUTCOME_WIN_RETURN_PCT=3`/`HORIZON=D5`. `(gate, scalar, WIN/LOSS, regime)` 튜플 |
| **C** 권고 | `gateThresholdRecommendation` | B 를 gate×regime 그룹핑 → `evaluateThresholdShift`(ADR-0325) ROC. read-only. ADR-0546 regime-aware verdict 패턴 일반화 |
| **D** 적용 | `gateLearnedThresholdRepo` + `gateLearnedThresholdApply` + `gateConfig` provider 역주입 | operator 승인분만 영속 → flag-gated·window-clamp 후 `gateConfig.registerLearnedGate1ThresholdProvider` 경유 적용 |
| **E** 관찰 | `/gate_threshold_reco` (별칭 `/counterfacture_gate`) | C 권고 read-only 텔레그램 노출 |

게이트별 스칼라/임계 (전부 실 SSOT 경유, 하드코딩 금지):
- **Gate1** — `dryRunScore`(×10) / `resolveGate1RequiredScore(regime)`=70, 레짐 stratify (F: gate1 행 regime 기존 보유)
- **Gate2** — `coverageAdjustedScore`(0~100) / `GATE2_PASS_WEAK_MIN_SCORE`=65, 레짐 stratify (G+H)
- **Gate3** — `rrr`(×1) / `DEFAULT_GATE3_THRESHOLD_CONFIG.rrrPassMin`=2, 레짐 stratify (F)

후속 보강: **F** Gate3/Gate2 레짐 stratify(UNKNOWN 풀링 제거, 비정상성 위험 해소), **G** Gate2 outcome subsystem(gate3 미러 — seed/repo/capture/성숙/투영), **H** Gate2 임계 SSOT 통합(미러 제거, drift 불가).

### 절대 불변식 (변경 시 본 ADR 갱신 의무)

1. **requiredScore=70 anchor 보존** — Gate1 학습 임계는 `[getRegimeAwareGate1RequiredScore(regime), 70]` 으로 clamp. 바닥(레짐값) 아래·anchor 위로 못 감.
2. **3중 적용 잠금** — ENV `COUNTERFACTURE_GATE_APPLY_ENABLED=true` + operator 승인분(`approveGateLearnedThreshold`, 권고 엔진 자동기록 안 함) + 명시 `registerCounterfactureGateApply()` 배선. 셋 중 하나라도 미충족 → `resolveGate1RequiredScore` byte-identical.
3. **순환 회피** — `gateConfig` 는 learning 을 import 하지 않는다(provider 역주입).
4. **selection bias 정합** — Gate2 seed 는 `SKIPPED_BY_GATE1` 제외(Gate1 생존자만).
5. **read-only 권고** — C/E 는 `liveThresholdAutoChanged=false`, `operatorApprovalRequired=true`.

## Consequences

**가능해진 것** — 데이터 성숙 후 gate×regime 별 임계 이동 권고(tighten/loosen/hold/insufficient_sample)를 `/gate_threshold_reco` 로 관찰, operator 승인 시 flag-gated 적용.

**현 상태(휴면)** — write 가 방금 고쳐졌으므로 관측이 이제부터 누적된다. ROC 가 유의미하려면 **gate×regime 당 mature D5 표본 ≥30**(ROC_MIN_SAMPLE) 이 필요 — 대략 2~3주. 그 전까지 권고는 `insufficient_sample`, 적용은 flag OFF 휴면.

**의존성** — 성숙은 `unifiedForwardOutcomeLabeler`(daily cron + startup)가 수행. 운영 환경에서 해당 cron 이 실제로 도는지(`unified-forward-outcome-labeler-status.json` lastLabelingRunAt 전진)가 데이터 누적의 전제.

**알려진 한계** — (1) Gate1 near-miss 표본은 절단 분포(완화 방향 편향) — 권고는 `[regimeAwareRequired,70)` 창으로 제한. (2) coverageAdjustedScore 가 좋은 Gate2 ROC 대상인지는 데이터로 검증 필요(Gate2 범주형 성격). (3) WIN 정의(+3%/D5)는 단일 SSOT 고정값 — 민감도/walk-forward 검증은 적용 전 operator 책임.

**롤백** — ENV `GATE_THRESHOLD_AUTO_TUNING_DISABLED=true`(분석기 전체) / `COUNTERFACTURE_GATE_APPLY_ENABLED` 미설정(적용) → byte-equivalent.

## Guardrails

- No live trading path change. (전 단계 executionImpact=NONE; D 적용도 flag OFF=byte-identical)
- No KIS/order import or invocation. (learning/persistence/quant 한정)
- No Gate/Kelly/STRONG_BUY behavior change. (H 의 gate2 status 리팩터는 byte-equivalent 값 보존; requiredScore=70/RRR/STRONG_BUY 불변)
- No Shadow policy change. (불변식 #2 shadow always-on 보존)
- No provider fetch behavior change. (성숙은 기존 priceFetcher 재사용)
- No data promotion behavior change.
