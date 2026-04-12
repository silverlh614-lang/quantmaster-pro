/**
 * behavioralMirrorEngine.ts — 투자자 행동 교정 미러 대시보드 엔진
 *
 * 5개 패널:
 *   1. 시스템 vs 직관 매매 수익률 비교 (6개월 누적)
 *   2. 손절 실행 충실도 트래커
 *   3. Gate 조건별 기여도 히트맵 (3개월)
 *   4. 포트폴리오 레짐 적합도 스코어 (0~100, 60 이하 경고)
 *   5. 30일 이벤트 타임라인
 */

import type { TradeRecord } from '../../types/portfolio';
import { ALL_CONDITIONS } from './evolutionEngine';
import type {
  BehavioralMirrorResult,
  BehavioralMirrorInput,
  BehavioralSystemVsIntuition,
  StopLossFidelity,
  GateContributionHeatmap,
  GateConditionContribution,
  RegimeFitnessScore,
  EventTimeline,
  UpcomingEvent,
} from '../../types/behavioralMirror';

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
const THREE_MONTHS_MS = 3 * 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** 레짐 적합도 경고 임계값 */
const REGIME_FITNESS_WARNING_THRESHOLD = 60;

/** Gate 조건을 "노이즈"로 판정하는 최소 트레이드 수 */
const NOISE_MIN_TRADES = 3;

/** 손절 충실도 HIGH/MID 임계값 */
const FIDELITY_HIGH = 80;
const FIDELITY_MID = 60;

// ─── 패널 1: 시스템 vs 직관 ───────────────────────────────────────────────────

function calcSystemVsIntuition(
  closedTrades: TradeRecord[],
): BehavioralSystemVsIntuition {
  const cutoff = Date.now() - SIX_MONTHS_MS;
  const recent = closedTrades.filter(
    (t) => t.sellDate && new Date(t.sellDate).getTime() >= cutoff,
  );

  const sys = recent.filter((t) => t.followedSystem);
  const int_ = recent.filter((t) => !t.followedSystem);

  const calcStats = (trades: TradeRecord[]) => {
    if (trades.length === 0) return { winRate: 0, avgReturn: 0, cumReturn: 0, wins: 0 };
    const wins = trades.filter((t) => (t.returnPct ?? 0) > 0).length;
    const returns = trades.map((t) => t.returnPct ?? 0);
    const avgReturn = returns.reduce((s, r) => s + r, 0) / trades.length;
    // 누적 수익률 = 복리 합산
    const cumReturn = returns.reduce((acc, r) => acc * (1 + r / 100), 1) - 1;
    return {
      wins,
      winRate: parseFloat(((wins / trades.length) * 100).toFixed(1)),
      avgReturn: parseFloat(avgReturn.toFixed(2)),
      cumReturn: parseFloat((cumReturn * 100).toFixed(2)),
    };
  };

  const sStats = calcStats(sys);
  const iStats = calcStats(int_);

  return {
    systemCount: sys.length,
    intuitionCount: int_.length,
    systemCumulativeReturn: sStats.cumReturn,
    intuitionCumulativeReturn: iStats.cumReturn,
    systemWinRate: sStats.winRate,
    intuitionWinRate: iStats.winRate,
    systemEdge: parseFloat((sStats.winRate - iStats.winRate).toFixed(1)),
    systemAvgReturn: sStats.avgReturn,
    intuitionAvgReturn: iStats.avgReturn,
  };
}

// ─── 패널 2: 손절 충실도 ──────────────────────────────────────────────────────

function calcStopLossFidelity(closedTrades: TradeRecord[]): StopLossFidelity {
  // 손실 종료 건만 대상
  const lossTrades = closedTrades.filter((t) => (t.returnPct ?? 0) < 0);

  if (lossTrades.length === 0) {
    return {
      totalStopCases: 0,
      mechanicalStops: 0,
      hesitantStops: 0,
      fidelityRate: 100,
      avgExtraLossOnHesitation: 0,
      trustLevel: 'HIGH',
    };
  }

  const mechanical = lossTrades.filter((t) => t.sellReason === 'STOP_LOSS');
  const hesitant = lossTrades.filter((t) => t.sellReason !== 'STOP_LOSS');

  const fidelityRate = parseFloat(
    ((mechanical.length / lossTrades.length) * 100).toFixed(1),
  );

  // 망설임 손절 시 평균 손실 vs 기계적 손절 평균 손실
  const mechAvgLoss =
    mechanical.length > 0
      ? mechanical.reduce((s, t) => s + (t.returnPct ?? 0), 0) / mechanical.length
      : 0;
  const hesAvgLoss =
    hesitant.length > 0
      ? hesitant.reduce((s, t) => s + (t.returnPct ?? 0), 0) / hesitant.length
      : 0;
  const avgExtraLossOnHesitation = parseFloat(
    Math.max(0, mechAvgLoss - hesAvgLoss).toFixed(2),
  );

  const trustLevel: StopLossFidelity['trustLevel'] =
    fidelityRate >= FIDELITY_HIGH ? 'HIGH' : fidelityRate >= FIDELITY_MID ? 'MID' : 'LOW';

  return {
    totalStopCases: lossTrades.length,
    mechanicalStops: mechanical.length,
    hesitantStops: hesitant.length,
    fidelityRate,
    avgExtraLossOnHesitation,
    trustLevel,
  };
}

// ─── 패널 3: Gate 조건별 기여도 히트맵 ────────────────────────────────────────

function calcGateContributionHeatmap(
  closedTrades: TradeRecord[],
): GateContributionHeatmap {
  const cutoff = Date.now() - THREE_MONTHS_MS;
  const fromDate = new Date(cutoff).toISOString();
  const recent = closedTrades.filter(
    (t) => t.sellDate && new Date(t.sellDate).getTime() >= cutoff,
  );

  const conditionIds = Object.keys(ALL_CONDITIONS).map(Number);

  const contributions: GateConditionContribution[] = conditionIds.map((id) => {
    const cond = ALL_CONDITIONS[id as keyof typeof ALL_CONDITIONS];
    // 해당 조건 점수 ≥ 7인 최근 거래
    const relevant = recent.filter(
      (t) => (t.conditionScores[id as keyof typeof t.conditionScores] ?? 0) >= 7,
    );
    const wins = relevant.filter((t) => (t.returnPct ?? 0) > 0);
    const winRate =
      relevant.length > 0
        ? parseFloat(((wins.length / relevant.length) * 100).toFixed(1))
        : 0;
    const avgReturnContrib =
      relevant.length > 0
        ? parseFloat(
            (relevant.reduce((s, t) => s + (t.returnPct ?? 0), 0) / relevant.length).toFixed(2),
          )
        : 0;

    const isNoise =
      relevant.length < NOISE_MIN_TRADES || Math.abs(avgReturnContrib) < 0.5;

    return {
      conditionId: id,
      conditionName: cond?.name ?? `조건 ${id}`,
      tradeCount: relevant.length,
      avgReturnContrib,
      isNoise,
      winRate,
    };
  });

  const effectiveCount = contributions.filter((c) => !c.isNoise).length;
  const noiseCount = contributions.filter((c) => c.isNoise).length;

  return {
    contributions,
    effectiveCount,
    noiseCount,
    fromDate,
  };
}

// ─── 패널 4: 레짐 적합도 스코어 ───────────────────────────────────────────────

function calcRegimeFitness(
  input: BehavioralMirrorInput,
): RegimeFitnessScore {
  const { openPositions, currentRegime } = input;

  if (openPositions.length === 0) {
    return {
      score: 100,
      isWarning: false,
      fitCount: 0,
      misfitCount: 0,
      currentRegimeLabel: currentRegime,
      misfitNames: [],
      recommendation: '보유 포지션 없음. 신규 진입 시 레짐 적합도를 확인하세요.',
    };
  }

  const fitPositions = openPositions.filter((p) => p.regimeFit);
  const misfitPositions = openPositions.filter((p) => !p.regimeFit);
  const fitRatio = fitPositions.length / openPositions.length;
  const score = Math.round(fitRatio * 100);
  const isWarning = score <= REGIME_FITNESS_WARNING_THRESHOLD;

  const misfitNames = misfitPositions.map((p) => p.stockName);

  let recommendation: string;
  if (score >= 80) {
    recommendation = '포트폴리오가 현재 레짐에 적합합니다. 포지션 유지.';
  } else if (score >= 60) {
    recommendation = `일부 포지션(${misfitNames.join(', ')})이 현재 레짐과 맞지 않습니다. 비중 축소 검토.`;
  } else {
    recommendation = `⚠️ 포트폴리오 레짐 부적합 경고! ${misfitNames.join(', ')} 등 부적합 포지션 즉시 점검 및 청산 고려.`;
  }

  return {
    score,
    isWarning,
    fitCount: fitPositions.length,
    misfitCount: misfitPositions.length,
    currentRegimeLabel: currentRegime,
    misfitNames,
    recommendation,
  };
}

// ─── 패널 5: 30일 이벤트 타임라인 ─────────────────────────────────────────────

function calcEventTimeline(
  input: BehavioralMirrorInput,
): EventTimeline {
  const now = Date.now();
  const cutoff = now + THIRTY_DAYS_MS;
  const fromDate = new Date(now).toISOString();
  const toDate = new Date(cutoff).toISOString();

  const events: UpcomingEvent[] = input.upcomingEvents
    .map((e) => {
      const eventMs = new Date(e.date).getTime();
      const daysUntil = Math.max(
        0,
        Math.round((eventMs - now) / (1000 * 60 * 60 * 24)),
      );
      return {
        date: e.date,
        stockCode: e.stockCode,
        stockName: e.stockName,
        eventType: e.eventType,
        description: e.description,
        riskLevel: e.riskLevel,
        daysUntil,
      } satisfies UpcomingEvent;
    })
    .filter((e) => {
      const eventMs = new Date(e.date).getTime();
      return eventMs >= now && eventMs <= cutoff;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const highRiskCount = events.filter((e) => e.riskLevel === 'HIGH').length;

  return {
    events,
    highRiskCount,
    fromDate,
    toDate,
  };
}

// ─── 메인 평가 함수 ────────────────────────────────────────────────────────────

export function evaluateBehavioralMirror(
  closedTrades: TradeRecord[],
  input: BehavioralMirrorInput,
): BehavioralMirrorResult {
  const systemVsIntuition = calcSystemVsIntuition(closedTrades);
  const stopLossFidelity = calcStopLossFidelity(closedTrades);
  const gateContributionHeatmap = calcGateContributionHeatmap(closedTrades);
  const regimeFitnessScore = calcRegimeFitness(input);
  const eventTimeline = calcEventTimeline(input);

  // 전체 요약 메시지 생성
  const warnings: string[] = [];
  if (systemVsIntuition.systemEdge < 0) {
    warnings.push('시스템 대비 직관 매매 우위 — 규칙 재점검 필요');
  }
  if (stopLossFidelity.trustLevel === 'LOW') {
    warnings.push('손절 충실도 낮음 — 기계적 손절 훈련 필요');
  }
  if (regimeFitnessScore.isWarning) {
    warnings.push(`레짐 부적합 포지션 ${regimeFitnessScore.misfitCount}건 — 점검 요망`);
  }
  if (eventTimeline.highRiskCount > 0) {
    warnings.push(`30일 내 고위험 이벤트 ${eventTimeline.highRiskCount}건 예정`);
  }

  const summary =
    warnings.length > 0
      ? `⚠️ 행동 교정 경고: ${warnings.join(' / ')}`
      : '✅ 행동 지표 정상 — 시스템 신뢰도 양호';

  return {
    systemVsIntuition,
    stopLossFidelity,
    gateContributionHeatmap,
    regimeFitnessScore,
    eventTimeline,
    summary,
    calculatedAt: new Date().toISOString(),
  };
}
