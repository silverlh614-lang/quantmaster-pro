// @responsibility Verify Telegram research reports preserve dated evidence boundaries.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperStrategyDecision, PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import type { PaperAdaptiveCandidate, PaperAdaptiveState } from '../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../src/types/paperIndicatorFormula.js';
import { legacyStrategyLedger } from '../trading/paper/paperStrategyFixtures.js';
import { formatPaperAdaptiveSummary, formatPaperIntraday, formatPaperResearchChanges } from './paperResearchMessages.js';
import { validateTelegramHtml } from './telegramHtmlSanitizer.js';

const date = '2026-10-02', now = new Date(`${date}T04:30:00Z`), at = `${date}T04:20:00Z`;
const candidate: PaperAdaptiveCandidate = {
  rule: { feature: 'rsi14', bucket: 1, horizon: 3 }, active: true, reason: 'ACTIVE',
  training: { sampleCount: 20, dateCount: 5, symbolCount: 4, meanNetReturnPct: 1.5, meanDailyExcessPct: 0.2 },
  validation: { sampleCount: 12, dateCount: 3, symbolCount: 4, meanNetReturnPct: 1.2, meanDailyExcessPct: 0.15 },
};
const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
const invention = { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-04T01:00:00Z',
  discoveryCutoffAt: '2026-09-03T15:00:00Z', rule: { bucket: 2, horizon: 3 as const }, training: candidate.training };
const invented: PaperAdaptiveCandidate = { ...candidate, rule: { feature: invention.id, ...invention.rule, invention } };
const state: PaperAdaptiveState = {
  policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
  tradingDate: date, evaluatedAt: `${date}T01:00:00Z`, cutoffAt: '2026-10-01T15:00:00Z',
  windowStartDate: '2026-08-03', validationStartDate: '2026-09-01', matureSampleCount: 100, matureDateCount: 20,
  candidates: [candidate, invented], changes: [], discovery: { version: 'indicator-discovery-v1', round: 2,
    roundStartedAt: '2026-09-03T15:00:00Z', roundTrainingEndDate: '2026-09-01', attemptedIds: [invention.id], inventions: [invention] },
};
function decision(action: PaperStrategyDecision['action'], symbol = '005930'): PaperStrategyDecision {
  return { snapshotId: 'latest', decisionAt: at, symbol, name: `종목${symbol}`, action, reasonCode: action === 'WAIT' ? 'ADAPTIVE_RULE_NOT_MATCHED' : 'ADAPTIVE_FEATURE_SELECTED',
    reason: action === 'WAIT' ? '연결된 규칙의 진입 구간 불일치' : '기록된 가상 판단', cohort: null, evidence: null, tradeId: null,
    adaptiveEvidence: { cutoffAt: state.cutoffAt, evaluatedAt: state.evaluatedAt, validationStartDate: '2026-09-07', policy: state.policy, candidate: invented } };
}
function view(): PaperExperimentView {
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', lastRun: { snapshotId: 'latest', asOf: at,
    candidateCount: 20, observedCount: 19, openedCount: 5, completedCount: 3, missingPriceCount: 1, marketOpen: true, issues: [] },
    collection: { startedAt: at, lastProgressAt: `${date}T04:29:00Z`, completed: 5, total: 20 },
    totalCount: 0, openCount: 0, completedCount: 0, outcomes: [], groups: [], experiments: [],
    strategy: { mode: 'SHADOW', strategyVersion: 'adaptive-features-v1', policy: { version: 'adaptive-features-v1', newsLookbackHours: 72,
      minimumSamples: 10, minimumEntryDates: 3, horizonSelection: 'FORWARD_VALIDATED_FEATURE', exitModel: 'SCHEDULED_CLOSE' },
    totalCount: 0, openCount: 0, performance: { closedCount: 999, meanNetReturnPct: 99, winRatePct: 99, totalNetPnl: 999 },
    adaptive: structuredClone(state), latestDecisions: [], trades: [], lastRun: { snapshotId: 'latest', asOf: at,
      openedCount: 0, closedCount: 0, holdingCount: 0, waitingCount: 0 } } };
}
function closed(version: PaperStrategyTrade['strategyVersion'], netReturnPct: number, availableAt = '2026-09-23T07:00:00Z'): PaperStrategyTrade {
  const trade = legacyStrategyLedger().trades[0];
  trade.strategyVersion = version; trade.status = 'CLOSED';
  trade.exit = { model: 'SCHEDULED_CLOSE', snapshotId: 'exit', effectiveAt: '2026-09-23T06:30:00Z', observedAt: availableAt, decisionAt: availableAt,
    price: 11000, decision: decision('EXIT'), netReturnPct, grossReturnPct: netReturnPct, netPnl: 1000 };
  return trade;
}

describe('adaptive research summary', () => {
  it('reports real research counts and separates current-policy completed results from legacy and future exits', () => {
    const current = view();
    current.strategy!.trades = [closed('news-trend-v2', 99), closed('adaptive-features-v1', 2), closed('adaptive-features-v1', 80, '2026-10-05T07:00:00Z')];
    current.strategy!.totalCount = 3;
    current.strategy!.adaptive!.candidates.push({ ...invented, rule: { ...invented.rule, feature: 'pbr', invention: undefined }, active: false, reason: 'MISSING_INPUT' });
    const result = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(result).toContain('발명 2차 · 이번 회차 검토 1개 · 보관 1개');
    expect(result).toContain('지표 자동 연결 2개 · 발명 지표 1개');
    expect(result).toContain('생성 후 검증 12건/3일');
    expect(result).toContain('당시 지표 자료 없음 1개');
    expect(result).toContain('현행 자율 전략 가상 청산 1건 · 평균 순수익률 +2.00% (구전략 제외)');
    expect(result).not.toContain('+99.00%'); expect(result).not.toContain('+80.00%');
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  it('does not substitute all-strategy performance for an unaggregated current policy', () => {
    const current = view(); current.strategy!.totalCount = 400;
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 성과 미집계');
    current.strategy!.performanceByVersion = { 'adaptive-features-v1': { closedCount: 4, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0 } };
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 가상 청산 4건 · 평균 순수익률 0.00%');
    current.strategy!.lastRun!.asOf = '2026-10-05T07:00:00Z';
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 성과 미집계');
  });

  it('distinguishes query errors, missing state, and future evaluation instead of reporting zero active rules', () => {
    const current = view(); current.strategy!.error = 'unavailable';
    const unavailable = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(unavailable).toContain('전략 갱신 오류'); expect(unavailable).not.toContain('지표 자동 연결');
    delete current.strategy!.error; delete current.strategy!.adaptive;
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('자율 지표 평가 미기록');
    current.strategy!.adaptive = { ...state, evaluatedAt: '2026-10-05T01:00:00Z' };
    const future = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(future).toContain('미래 또는 잘못된 평가 시각'); expect(future).not.toContain('지표 자동 연결');
  });
});

describe('recorded research changes', () => {
  it('distinguishes invention, observation-driven disconnection, and retirement without attaching later performance', () => {
    const changes: PaperAdaptiveState['changes'] = [
      { at: '2026-09-04T01:00:00Z', feature: invention.id, from: null, to: invented.rule, reason: 'FORWARD_OBSERVATION' },
      { at: '2026-09-07T01:00:00Z', feature: invention.id, from: invented.rule, to: null, reason: 'FORWARD_OBSERVATION' },
      { at: '2026-09-08T01:00:00Z', feature: invention.id, from: invented.rule, to: null, reason: 'DISCOVERY_RETIRED' },
    ];
    const result = formatPaperResearchChanges({ ...state, candidates: [{ ...invented, validation: { ...invented.validation, meanDailyExcessPct: 999 } }] }, changes, now);
    expect(result).toContain('<b>새 지표 생성'); expect(result).toContain('<b>연결 해제'); expect(result).toContain('<b>연구 종료');
    expect(result).toContain('이전: 없음'); expect(result).toContain('이후: 없음');
    expect(result).toContain('N(RSI 14)'); expect(result).toContain('(값−50)/40');
    expect(result).not.toContain('999'); expect(result).not.toContain('평균 순수익률');
    expect(result.length).toBeLessThanOrEqual(3500); expect(validateTelegramHtml(result).valid).toBe(true);
  });

  it('shows adoption and rule replacement while excluding future changes and future formula definitions', () => {
    const changes: PaperAdaptiveState['changes'] = [
      { at, feature: 'rsi14', from: null, to: candidate.rule, reason: 'ACTIVE' },
      { at, feature: 'rsi14', from: candidate.rule, to: { ...candidate.rule, horizon: 5 }, reason: 'ACTIVE' },
      { at: '2026-10-05T01:00:00Z', feature: 'rsi14', from: candidate.rule, to: null, reason: 'NO_VALIDATION_EDGE' },
      { at: '2026-09-01T01:00:00Z', feature: invention.id, from: null, to: invented.rule, reason: 'FORWARD_OBSERVATION' },
    ];
    const result = formatPaperResearchChanges(state, changes, now);
    expect(result).toContain('<b>매수에 채택'); expect(result).toContain('<b>규칙 교체');
    expect(result).toContain('미래·시각 불명 변경 2건 제외'); expect(result).not.toContain('새 지표 생성');
  });
});

describe('intraday actual decisions', () => {
  it('summarizes current recorded decisions, real waits and at most three buy/hold symbols with frozen evidence', () => {
    const current = view();
    current.strategy!.latestDecisions = [decision('BUY', '000001'), decision('HOLD', '000002'), decision('HOLD', '000003'),
      decision('HOLD', '000004'), decision('WAIT', '000005'), decision('WAIT', '000006'), decision('EXIT', '000007')];
    Object.assign(current.strategy!.lastRun!, { openedCount: 1, holdingCount: 3, waitingCount: 2, closedCount: 1 });
    const result = formatPaperIntraday(current, date, now);
    expect(result).toContain('가상 진입(BUY) 1 · 대기(WAIT) 2 · 보유(HOLD) 3 · 청산(EXIT) 1');
    expect(result).toContain('대기 2종목: 연결된 규칙의 진입 구간 불일치');
    expect(result).toContain('종목000001'); expect(result).toContain('종목000003'); expect(result).not.toContain('종목000004');
    expect(result).toContain('진입 당시 고정 지표'); expect(result).toContain('생성 후 검증 12건/3일');
    expect(result).toContain('가격 확인 19/20종목'); expect(result).toContain('수집 진행 기록 5/20종목');
    expect(result.length).toBeLessThanOrEqual(3500); expect(validateTelegramHtml(result).valid).toBe(true);
  });

  it('does not pull a recommendation from trades or stale, future, or mismatched decision snapshots', () => {
    const current = view(); current.strategy!.trades = [{ ...closed('adaptive-features-v1', 2), name: '과거거래종목' }];
    current.strategy!.totalCount = 1;
    current.strategy!.latestDecisions = [decision('WAIT', '000001'), { ...decision('BUY', '000002'), name: '미래종목', decisionAt: '2026-10-05T01:00:00Z' },
      { ...decision('BUY', '000003'), name: '다른스냅샷종목', snapshotId: 'other' }];
    Object.assign(current.strategy!.lastRun!, { openedCount: 2, waitingCount: 1 });
    const result = formatPaperIntraday(current, date, now);
    expect(result).toContain('최신 판단 일부 확인 1/3종목'); expect(result).toContain('가상 진입(BUY) 0');
    expect(result).not.toContain('미래종목'); expect(result).not.toContain('다른스냅샷종목'); expect(result).not.toContain('과거거래종목');
    current.strategy!.lastRun!.asOf = '2026-10-01T04:20:00Z';
    expect(formatPaperIntraday(current, date, now)).toContain('오늘 확인된 최신 전략 판단 미기록');
  });

  it('escapes external names and reasons and bounds long messages without cutting HTML entities or tags', () => {
    const current = view(); current.strategy!.latestDecisions = Array.from({ length: 3 }, (_, index) => ({
      ...decision('BUY', String(index)), name: '<b>&'.repeat(40), reason: '<tag>&'.repeat(100),
    }));
    current.strategy!.lastRun!.openedCount = 3;
    const result = formatPaperIntraday(current, date, now);
    expect(result).toContain('&lt;b&gt;&amp;'); expect(result).toContain('&lt;tag&gt;&amp;');
    expect(result).not.toContain('<tag>'); expect(result.length).toBeLessThanOrEqual(3500);
    expect(validateTelegramHtml(result).valid).toBe(true);
    expect(formatPaperIntraday(current, '2026-02-30', now)).toContain('집계 날짜 확인 필요');
    expect(formatPaperIntraday(current, '2026-10-05', now)).toContain('집계 날짜 확인 필요');
  });
});
