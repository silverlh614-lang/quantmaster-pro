// @responsibility Project compact dashboard responses.
import type { PaperExperimentView, PaperOverviewView } from '../../../src/types/paperExperiment.js';

const reasonLabels: Record<string, string> = {
  INSUFFICIENT_MATURE_SAMPLES: '완료 표본 누적 중', INSUFFICIENT_ENTRY_DATES: '진입일 누적 중',
  NON_POSITIVE_EXPECTANCY: '양수 기대 성과 없음', TREND_UNKNOWN: '추세 자료 확인 대기',
  MARKET_CLOSED: '장 시작 대기', CURRENT_PRICE_UNAVAILABLE: '현재가 확인 대기',
  OBSERVATION_TIME_INVALID: '관측 시각 확인 필요', ALREADY_ENTERED_TODAY: '오늘 진입 완료',
};

export function buildPaperOverview(view: PaperExperimentView): PaperOverviewView {
  const { experiments: _experiments, groups: _groups, strategy, research, ...baseline } = view;
  const result: PaperOverviewView = { ...baseline };
  if (strategy) {
    const { trades: _trades, latestDecisions, ...stats } = strategy;
    const decisionCounts = { BUY: 0, WAIT: 0, HOLD: 0, EXIT: 0 };
    const reasons = new Map<string, number>();
    for (const decision of latestDecisions) {
      decisionCounts[decision.action]++;
      if (decision.action === 'WAIT') reasons.set(decision.reasonCode, (reasons.get(decision.reasonCode) ?? 0) + 1);
    }
    result.strategy = { ...stats, decisionCounts, waitingReasons: [...reasons].map(([code, count]) => ({ code, count, label: reasonLabels[code] ?? '판단 자료 확인 대기' })).sort((a, b) => b.count - a.count) };
  }
  if (research) {
    const { asOf, symbols, sampleCount, learningSampleCount, newsCount, seriesCount, firstDate, lastDate, error } = research;
    result.research = { asOf, symbols, sampleCount, learningSampleCount, newsCount, seriesCount, firstDate, lastDate, error,
      features: (research.featureStudies ?? []).map(({ feature, label, status, matchedDifferencePct, testCount, testSymbolCount, testDateCount }) => ({ feature, label, status, matchedDifferencePct, testCount, testSymbolCount, testDateCount })),
    };
  }
  return result;
}
