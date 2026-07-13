// @responsibility ADR-0655 Gate2 FUNDAMENTAL_QUALITY 재무위험 평가 타입 계약 SSOT — riskLevel/triggers/score-cap 규약 (engine-dev 구현 입력, executionImpact=NONE).

/**
 * gate2FinancialRiskTypes.ts — Gate2 재무 위험종목 선별 타입 계약 (ADR-0655)
 *
 * 목적: Gate2 FUNDAMENTAL_QUALITY 축이 재무 위험종목(ICR<1 이자 미충당 / 부채비율 과다)을
 *       점수 페널티(하드차단 아님)로 강등하기 위한 입력/출력 인터페이스를 고정한다.
 *
 * 불변식 #6 보존: 재무 위험/결손은 데이터 *해석*이며 bearish market signal 이 아니다.
 *   - entryHardBlock 은 항상 false (점수 cap 만, Gate2 pass 경계는 score 로만 판정).
 *   - marketSignal=false / executionImpact='NONE' literal 강제.
 *   - 결손(임계 입력 null) 시 페널티 미적용(graceful) — 결손 ≠ 위험 ≠ bearish.
 *
 * 본 파일은 타입만 정의한다 (값/판정/외부호출 0). 구현은 engine-dev (별도 순수 모듈
 * gate2FinancialRiskPenaltyAdr0655.ts). flag SSOT = gateConfig.isGate2FinancialRiskPenaltyEnabled().
 */

/**
 * 재무 위험 등급. score-cap 강도를 결정한다.
 * - NONE: 위험 trigger 0개 (또는 임계 입력 결손으로 평가 불가 → 페널티 미적용).
 * - ELEVATED: 위험 trigger 1개 (ICR<1 단독 또는 부채비율 과다 단독).
 * - CRITICAL: 위험 trigger 2개 (ICR<1 AND 부채비율 과다).
 */
type Gate2FinancialRiskLevel = 'NONE' | 'ELEVATED' | 'CRITICAL';

/**
 * 위험 trigger 종류 (관측 trace·텔레그램 표시용 토큰).
 * - ICR_BELOW_1: 이자보상배율 < 1 (영업이익으로 이자비용을 충당하지 못함).
 * - DEBT_RATIO_EXCESS: 부채비율 > 200% (한국 시장 통념상 과다 — ADR-0655 §임계근거).
 */
export type Gate2FinancialRiskTrigger = 'ICR_BELOW_1' | 'DEBT_RATIO_EXCESS';

/**
 * 임계 입력의 가용성 분류 — graceful 판정의 trace.
 * - PRESENT: 값이 평가에 사용됨.
 * - MISSING: 값 null (결손 — 해당 trigger 평가 skip, 페널티 미적용).
 */
export type Gate2RiskInputAvailability = 'PRESENT' | 'MISSING';

/**
 * 재무 위험 평가 입력. gate2ConfluenceScore.buildFundamentalAxis 가 이미 resolve 한
 * stability 슬롯 값(ADR-0529 canonical merge)에서 파생한 두 임계 metric 만 받는다.
 * 신규 fetch 0 — 기존 Gate2ExternalProjection.stability.{icr,debtRatio} 재사용.
 */
export interface Gate2FinancialRiskInput {
  /** 이자보상배율 (DART interestCoverageRatio residual — KIS 이자비용 미분리, ADR-0655 §데이터). null=결손. */
  interestCoverageRatio: number | null;
  /** 부채비율 % (KIS stability-ratio lblt_rate, L1). null=결손. */
  debtRatio: number | null;
}

/**
 * 재무 위험 평가 결과. FUNDAMENTAL_QUALITY 축의 evidence·score-cap 적용에 사용.
 *
 * score-cap 규약 (ADR-0655 §페널티 baseline — engine-dev 가 본 cap 을 buildFundamentalAxis
 * 산출 score 에 Math.min 으로 적용; cap 은 *상한*이라 정상 종목 score 를 올리지 않는다):
 *   - NONE     → scoreCap=null  (cap 미적용, 현행 score 그대로 byte-identical when flag ON & risk none).
 *   - ELEVATED → scoreCap=30    (WEAK 대역으로 강등 — score = min(currentScore, 30)).
 *   - CRITICAL → scoreCap=15    (심층 WEAK — score = min(currentScore, 15)).
 *
 * entryHardBlock=false 불변 — Gate2 pass 경계는 coverageAdjustedScore 로만 판정하며 본 축은
 * 가중 15점 기여. cap 은 해당 축 점수만 누른다(전체 차단 아님). 불변식 #6.
 */
export interface Gate2FinancialRiskAssessment {
  riskLevel: Gate2FinancialRiskLevel;
  triggers: Gate2FinancialRiskTrigger[];
  /** FUNDAMENTAL_QUALITY 축 score 상한 (Math.min 적용). NONE=null(미적용). */
  scoreCap: number | null;
  /** ICR 임계 입력 가용성 — graceful trace. */
  icrAvailability: Gate2RiskInputAvailability;
  /** 부채비율 임계 입력 가용성 — graceful trace. */
  debtRatioAvailability: Gate2RiskInputAvailability;
  /** 관측 trace 문자열 (evidence 배열 append·텔레그램 표시용). */
  evidence: string[];
  /** 항상 false — 재무 위험은 entry 를 하드차단하지 않는다(점수 cap 만). */
  entryHardBlock: false;
  /** 항상 false — 재무 위험/결손 ≠ bearish market signal (불변식 #6). */
  marketSignal: false;
  /** 항상 'NONE' — 본 평가는 LIVE 매매 의사결정을 직접 바꾸지 않는다. */
  executionImpact: 'NONE';
}

/** 부채비율 과다 임계 (%) — 한국 시장 통념상 과다 경계 (ADR-0655 §임계근거). */
export const GATE2_DEBT_RATIO_EXCESS_THRESHOLD = 200;

/** ICR 미충당 임계 — 영업이익 < 이자비용 (이자 미충당) 경계 (ADR-0655 §임계근거). */
export const GATE2_ICR_DISTRESS_THRESHOLD = 1;

/** ELEVATED(위험 1건) 시 FUNDAMENTAL_QUALITY 축 score 상한 (WEAK 대역). */
export const GATE2_RISK_ELEVATED_SCORE_CAP = 30;

/** CRITICAL(위험 2건) 시 FUNDAMENTAL_QUALITY 축 score 상한 (심층 WEAK). */
export const GATE2_RISK_CRITICAL_SCORE_CAP = 15;
