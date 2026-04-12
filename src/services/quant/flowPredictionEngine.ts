/**
 * flowPredictionEngine.ts — 수급 예측 선행 모델 (Flow Prediction Engine)
 *
 * 핵심 개념:
 *   외국인·기관의 과거 수급 패턴을 분석해
 *   "특정 종목에서 대량 매수가 발생할 가능성"을 Gate 필터보다 1~3일 앞서 포착한다.
 *
 * 3대 선행 신호:
 *   1. 거래량 마름 (Volume Dry-Up) — 최근 5일 거래량 ≤ 20일 평균의 60%
 *   2. 호가 저항 약화 (Resistance Weakening) — bid-ask 스프레드 비율 낮아짐
 *   3. 프로그램 비차익 소폭 유입 (Program Non-Arb Inflow) — 비차익 순매수 양수
 *
 * 추가 인텔리전스:
 *   - DART 의무보유 해제 / 블록딜 일정 수급 왜곡 사전 경고
 *   - 외국인 보유 비중 < 임계값 + 양호한 펀더멘털 → "외국인 재진입 대기 종목"
 */

import type {
  FlowPredictionInput,
  FlowPredictionResult,
  FlowPredictionSignal,
  VolumeDryUpSignal,
  ProgramInflowSignal,
  ResistanceWeakeningSignal,
  DistortionWarning,
  ForeignReentrySignal,
  SupplyDistortionSchedule,
} from '../../types/flowPrediction';

// ─── 임계값 상수 ──────────────────────────────────────────────────────────────

/** 거래량 마름 판단 기준: 5일 평균이 20일 평균의 이 비율 이하이면 마름 */
const VOLUME_DRY_UP_RATIO = 0.60;

/** 프로그램 비차익 "소폭 유입" 상한 (억원). 이 값 이하의 양수를 소폭 유입으로 판단 */
const PROGRAM_INFLOW_UPPER = 200;

/** 호가 저항 약화 기준 스프레드 비율 */
const SPREAD_WEAK_THRESHOLD = 0.003; // 0.3% 이하

/** 외국인 재진입 기본 임계값 (%) */
const DEFAULT_FOREIGN_THRESHOLD = 15;

/** 외국인 재진입 후보의 최소 펀더멘털 점수 */
const MIN_FUNDAMENTAL_FOR_REENTRY = 60;

// ─── 서브 신호 계산 함수 ──────────────────────────────────────────────────────

function calcVolumeDryUp(
  recentVolume5dAvg: number,
  avgVolume20d: number,
): VolumeDryUpSignal {
  if (avgVolume20d <= 0) {
    return {
      detected: false,
      volumeRatio: 1,
      description: '20일 평균 거래량 데이터 없음',
    };
  }
  const ratio = recentVolume5dAvg / avgVolume20d;
  const detected = ratio <= VOLUME_DRY_UP_RATIO;
  return {
    detected,
    volumeRatio: parseFloat(ratio.toFixed(3)),
    description: detected
      ? `거래량 마름 감지 — 최근 5일 평균이 20일 평균의 ${(ratio * 100).toFixed(0)}% (기준: ≤${VOLUME_DRY_UP_RATIO * 100}%)`
      : `거래량 정상 — 최근 5일 평균이 20일 평균의 ${(ratio * 100).toFixed(0)}%`,
  };
}

function calcProgramInflow(netBuyAmount: number): ProgramInflowSignal {
  const detected = netBuyAmount > 0 && netBuyAmount <= PROGRAM_INFLOW_UPPER;
  return {
    detected,
    netBuyAmount,
    description: detected
      ? `프로그램 비차익 소폭 유입 — ${netBuyAmount.toFixed(0)}억원 (기준: 0 < x ≤ ${PROGRAM_INFLOW_UPPER}억원)`
      : netBuyAmount > PROGRAM_INFLOW_UPPER
      ? `프로그램 비차익 대규모 유입 — ${netBuyAmount.toFixed(0)}억원 (선행 신호로 취급하지 않음)`
      : `프로그램 비차익 유입 없음 — ${netBuyAmount.toFixed(0)}억원`,
  };
}

function calcResistanceWeakening(spreadRatio: number): ResistanceWeakeningSignal {
  const detected = spreadRatio <= SPREAD_WEAK_THRESHOLD && spreadRatio >= 0;
  return {
    detected,
    spreadRatio: parseFloat(spreadRatio.toFixed(5)),
    description: detected
      ? `호가 저항 약화 감지 — 스프레드 비율 ${(spreadRatio * 100).toFixed(3)}% (기준: ≤${SPREAD_WEAK_THRESHOLD * 100}%)`
      : `호가 저항 정상 — 스프레드 비율 ${(spreadRatio * 100).toFixed(3)}%`,
  };
}

function calcDistortionWarning(
  schedules: SupplyDistortionSchedule[] | undefined,
): DistortionWarning {
  if (!schedules || schedules.length === 0) {
    return {
      active: false,
      schedules: [],
      description: '향후 5거래일 내 의무보유 해제 / 블록딜 일정 없음',
    };
  }
  const active = schedules.length > 0;
  const names = schedules.map((s) => `${s.stockName}(${s.eventType === 'LOCKUP_RELEASE' ? '의무보유해제' : '블록딜'} ${s.scheduledDate})`).join(', ');
  return {
    active,
    schedules,
    description: active
      ? `⚠️ 수급 왜곡 경고 — 향후 ${schedules.length}건 이벤트: ${names}`
      : '향후 5거래일 내 의무보유 해제 / 블록딜 일정 없음',
  };
}

function calcForeignReentry(
  foreignOwnershipRatio: number,
  threshold: number,
  fundamentalScore: number,
): ForeignReentrySignal {
  const belowThreshold = foreignOwnershipRatio < threshold;
  const goodFundamentals = fundamentalScore >= MIN_FUNDAMENTAL_FOR_REENTRY;
  const isCandidate = belowThreshold && goodFundamentals;
  return {
    isCandidate,
    currentOwnershipRatio: foreignOwnershipRatio,
    threshold,
    fundamentalScore,
    description: isCandidate
      ? `외국인 재진입 대기 종목 — 보유 비중 ${foreignOwnershipRatio.toFixed(1)}% (임계값 ${threshold}% 미만) + 펀더멘털 점수 ${fundamentalScore}/100`
      : belowThreshold
      ? `외국인 보유 비중 낮으나 펀더멘털 점수 미달 (${fundamentalScore}/100 < ${MIN_FUNDAMENTAL_FOR_REENTRY})`
      : `외국인 보유 비중 ${foreignOwnershipRatio.toFixed(1)}% — 임계값(${threshold}%) 초과`,
  };
}

// ─── 종합 점수 계산 ───────────────────────────────────────────────────────────

function calcPatternScore(
  volumeDryUp: VolumeDryUpSignal,
  programInflow: ProgramInflowSignal,
  resistanceWeakening: ResistanceWeakeningSignal,
  foreignNetBuy5d: number,
  institutionalNetBuy5d: number,
): number {
  let score = 0;

  // 거래량 마름: 핵심 선행 패턴 (+35)
  if (volumeDryUp.detected) score += 35;

  // 프로그램 비차익 소폭 유입 (+25)
  if (programInflow.detected) score += 25;

  // 호가 저항 약화 (+20)
  if (resistanceWeakening.detected) score += 20;

  // 기관 소량 순매수 (+15)
  if (institutionalNetBuy5d > 0) score += 15;

  // 외국인 순매수 전조 (소량 유입, 대규모 아님) (+5)
  if (foreignNetBuy5d > 0 && foreignNetBuy5d < 500000) score += 5;

  return Math.min(100, score);
}

function determineSignal(
  patternScore: number,
  distortionWarning: DistortionWarning,
  foreignReentry: ForeignReentrySignal,
): FlowPredictionSignal {
  if (distortionWarning.active) return 'DISTORTION_WARNING';
  if (foreignReentry.isCandidate) return 'FOREIGN_REENTRY_CANDIDATE';
  if (patternScore >= 55) return 'BUY_PRECURSOR';
  return 'NEUTRAL';
}

function calcLeadDays(patternScore: number): number {
  if (patternScore >= 80) return 3;
  if (patternScore >= 55) return 2;
  if (patternScore >= 35) return 1;
  return 0;
}

function buildSummary(
  signal: FlowPredictionSignal,
  patternScore: number,
  estimatedLeadDays: number,
  distortionWarning: DistortionWarning,
  foreignReentry: ForeignReentrySignal,
): string {
  switch (signal) {
    case 'BUY_PRECURSOR':
      return `선행 매수 신호 포착 — 패턴 점수 ${patternScore}/100, Gate 필터 대비 약 ${estimatedLeadDays}일 선행`;
    case 'DISTORTION_WARNING':
      return `수급 왜곡 경고 — ${distortionWarning.schedules.length}건의 의무보유 해제/블록딜 일정 감지`;
    case 'FOREIGN_REENTRY_CANDIDATE':
      return `외국인 재진입 대기 — 보유 비중 ${foreignReentry.currentOwnershipRatio.toFixed(1)}% (임계값 미만) + 펀더멘털 양호`;
    default:
      return `특이 수급 신호 없음 — 패턴 점수 ${patternScore}/100`;
  }
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 수급 예측 선행 모델 계산.
 *
 * 3대 선행 신호(거래량 마름 + 호가 저항 약화 + 프로그램 비차익 유입)를
 * 종합해 BUY_PRECURSOR / DISTORTION_WARNING / FOREIGN_REENTRY_CANDIDATE 중
 * 하나를 반환한다.
 */
export function evaluateFlowPrediction(
  input: FlowPredictionInput,
): FlowPredictionResult {
  const threshold = input.foreignOwnershipThreshold ?? DEFAULT_FOREIGN_THRESHOLD;

  const volumeDryUp = calcVolumeDryUp(
    input.recentVolume5dAvg,
    input.avgVolume20d,
  );
  const programInflow = calcProgramInflow(input.programNonArbitrageNetBuy);
  const resistanceWeakening = calcResistanceWeakening(input.bidAskSpreadRatio);
  const distortionWarning = calcDistortionWarning(input.distortionSchedules);
  const foreignReentry = calcForeignReentry(
    input.foreignOwnershipRatio,
    threshold,
    input.fundamentalScore,
  );

  const patternScore = calcPatternScore(
    volumeDryUp,
    programInflow,
    resistanceWeakening,
    input.foreignNetBuy5d,
    input.institutionalNetBuy5d,
  );
  const signal = determineSignal(patternScore, distortionWarning, foreignReentry);
  const estimatedLeadDays = calcLeadDays(patternScore);

  return {
    signal,
    patternScore,
    estimatedLeadDays,
    volumeDryUp,
    programInflow,
    resistanceWeakening,
    distortionWarning,
    foreignReentry,
    summary: buildSummary(signal, patternScore, estimatedLeadDays, distortionWarning, foreignReentry),
    calculatedAt: new Date().toISOString(),
  };
}
