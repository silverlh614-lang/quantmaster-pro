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
  it('keeps five connected rules readable with samples, results and learning within one message budget', () => {
    const current = view(), adaptive = current.strategy!.adaptive!;
    adaptive.candidates = ['rsi14', 'pbr', 'currentRatio'].map(feature => ({ ...candidate,
      rule: { ...candidate.rule, feature: feature as 'rsi14' | 'pbr' | 'currentRatio' } }));
    adaptive.exploration = { version: 'shadow-exploration-v1', sequence: 2,
      rules: [1, 2].map(index => ({ id: `trial-${index}`, registeredAt: at,
        candidate: { ...invented, active: false, reason: 'FORWARD_OBSERVATION' } })) };
    adaptive.policy.maturityModel = 'per-horizon-v1';
    adaptive.horizonSamples = [1, 3, 5].map(horizon => ({ horizon: horizon as 1 | 3 | 5,
      matureSampleCount: 6526, matureDateCount: 7, trainingSampleCount: 2688, trainingDateCount: 3,
      validationSampleCount: 2896, validationDateCount: 3 }));
    const original = structuredClone(current);
    const result = formatPaperAdaptiveSummary(current, now).join('\n');
    for (const heading of ['✅ <b>검증 지표', '🧪 <b>탐색 가상매수', '🧬 <b>새 지표 연구', '📚 <b>학습·검증 표본', '📊 <b>가상 매매 결과']) {
      expect(result).toContain(`\n\n${heading}`);
    }
    expect(result).toContain('연결 2개/최대 2개');
    expect(result).toContain('<b>• PBR (주가순자산비율)</b>\n조건');
    expect(result).not.toContain('N(RSI');
    expect(result).toContain('조합값 0 이상 1 미만 · D3 성과 비교');
    expect(result).toContain('<b>D5</b> · 학습 2,688건/3일 · 검증 2,896건/3일');
    expect(result).toContain('탐색 진입(검증 전): 보유 0건 · 청산 0건 · 평균 미집계');
    expect(result).not.toContain('… 상세');
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(validateTelegramHtml(result).valid).toBe(true);
    expect(current).toEqual(original);
  });

  it('reports real research counts and separates current-policy completed results from legacy and future exits', () => {
    const current = view();
    current.strategy!.trades = [closed('news-trend-v2', 99), closed('adaptive-features-v1', 2), closed('adaptive-features-v1', 80, '2026-10-05T07:00:00Z')];
    current.strategy!.totalCount = 3;
    current.strategy!.adaptive!.candidates.push({ ...invented, rule: { ...invented.rule, feature: 'pbr', invention: undefined }, active: false, reason: 'MISSING_INPUT' });
    const result = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(result).toContain('발명 2차 · 이번 회차 검토 1개 · 보관 1개');
    expect(result).toContain('<b>검증 지표 자동 연결 2개/최대 3개</b>\n이 중 발명 지표 1개');
    expect(result).toContain('생성 후 검증 12건/3일');
    expect(result).toContain('학습에 쓸 지표 표본 없음 1개');
    expect(result).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 1건 · 평균 순수익률 +2.00% (구전략 제외)');
    expect(result).not.toContain('+99.00%'); expect(result).not.toContain('+80.00%');
    expect(result.length).toBeLessThanOrEqual(1900);
  });

  it('reports per-horizon learning counts and preserves realized performance within the message limit', () => {
    const current = view(), adaptive = current.strategy!.adaptive!;
    adaptive.policy.maturityModel = 'per-horizon-v1';
    adaptive.horizonSamples = [
      { horizon: 1, matureSampleCount: 100, matureDateCount: 20, trainingSampleCount: 60, trainingDateCount: 12, validationSampleCount: 20, validationDateCount: 4 },
      { horizon: 3, matureSampleCount: 80, matureDateCount: 16, trainingSampleCount: 0, trainingDateCount: 0, validationSampleCount: 20, validationDateCount: 4 },
      { horizon: 5, matureSampleCount: 0, matureDateCount: 0, trainingSampleCount: 0, trainingDateCount: 0, validationSampleCount: 0, validationDateCount: 0 },
    ];
    const result = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(result).toContain('한 보유기간 이상 확정 표본 100건/20진입일');
    expect(result).toContain('<b>D1</b> · 학습 60건/12일 · 검증 20건/4일');
    expect(result).toContain('<b>D3</b> · 학습 0건/0일 · 검증 20건/4일');
    expect(result).toContain('<b>D5</b> · 학습 0건/0일 · 검증 0건/0일');
    expect(result).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 0건');
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(validateTelegramHtml(result).valid).toBe(true);
    delete adaptive.horizonSamples;
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('보유기간별 표본 집계 확인 대기');
    delete adaptive.policy.maturityModel;
    const legacy = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(legacy).toContain('성숙 관측 100건/20진입일');
    expect(legacy).not.toContain('<b>D1</b> · 학습');
  });

  it('does not substitute all-strategy performance for an unaggregated current policy', () => {
    const current = view(); current.strategy!.totalCount = 400;
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 성과 미집계');
    current.strategy!.performanceByVersion = { 'adaptive-features-v1': { closedCount: 4, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0 } };
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 4건 · 평균 순수익률 0.00%');
    current.strategy!.lastRun!.asOf = '2026-10-05T07:00:00Z';
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('현행 자율 전략 성과 미집계');
  });

  it('separates dated validated and exploration trade results using original entry purpose', () => {
    const current = view(), exploratory = closed('adaptive-features-v1', -1);
    exploratory.entryDecision.explorationEvidence = { ...decision('BUY').adaptiveEvidence!, trialId: 'trial', registeredAt: '2026-09-18T00:59:00Z' };
    const future = structuredClone(exploratory);
    future.exit!.observedAt = '2026-10-05T07:00:00Z'; future.exit!.decisionAt = future.exit!.observedAt;
    current.strategy!.trades = [closed('adaptive-features-v1', 2), exploratory, future, closed('news-trend-v2', 99)];
    current.strategy!.totalCount = 4;
    current.strategy!.adaptive!.exploration = { version: 'shadow-exploration-v1', sequence: 1,
      rules: [{ id: 'trial', registeredAt: at, candidate: { ...invented, active: false, reason: 'FORWARD_OBSERVATION' } }] };
    const result = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(result).toContain('<b>탐색 가상매수 · 검증 전</b>\n연결 1개/최대 2개');
    expect(result).toContain('검증 지표 자동 연결 2개/최대 3개');
    expect(result).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 2건 · 평균 순수익률 +0.50%');
    expect(result).toContain('검증 통과 진입: 보유 0건 · 청산 1건 · 평균 +2.00%');
    expect(result).toContain('탐색 진입(검증 전): 보유 1건 · 청산 1건 · 평균 -1.00%');
    expect(result).not.toContain('+99.00%');
    expect(result.length).toBeLessThanOrEqual(1900);
  });

  it('uses only purpose-specific aggregates for partial ledgers and marks missing or future data unavailable', () => {
    const current = view(); current.strategy!.totalCount = 400;
    current.strategy!.performanceByVersion = { 'adaptive-features-v1': { closedCount: 99, meanNetReturnPct: 90, winRatePct: 50, totalNetPnl: 1 } };
    expect(formatPaperAdaptiveSummary(current, now).join('\n')).toContain('탐색 진입(검증 전): 목적별 성과 미집계');
    current.strategy!.performanceByPurpose = {
      VALIDATED: { openCount: 5, closedCount: 3, meanNetReturnPct: 2, winRatePct: 100, totalNetPnl: 20 },
      EXPLORATION: { openCount: 2, closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
    };
    const currentResult = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(currentResult).toContain('검증 통과 진입: 보유 5건 · 청산 3건 · 평균 +2.00%');
    expect(currentResult).toContain('탐색 진입(검증 전): 보유 2건 · 청산 0건 · 평균 미집계');
    current.strategy!.lastRun!.asOf = '2026-10-05T01:00:00Z';
    const futureResult = formatPaperAdaptiveSummary(current, now).join('\n');
    expect(futureResult).toContain('검증 통과 진입: 목적별 성과 미집계');
    expect(futureResult).not.toContain('보유 5건');
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
  it('prioritizes buy and exit decisions before holds, retaining recorded counts and frozen evidence', () => {
    const current = view();
    current.strategy!.latestDecisions = [decision('BUY', '000001'), decision('HOLD', '000002'), decision('HOLD', '000003'),
      decision('HOLD', '000004'), decision('WAIT', '000005'), decision('WAIT', '000006'), decision('EXIT', '000007')];
    Object.assign(current.strategy!.lastRun!, { openedCount: 1, holdingCount: 3, waitingCount: 2, closedCount: 1 });
    const result = formatPaperIntraday(current, date, now);
    expect(result).toContain('매수 1 · 매도 1 · 보유 3 · 대기 2');
    expect(result).toContain('대기 2종목: 연결된 규칙의 진입 구간 불일치');
    expect(result).toContain('종목000001'); expect(result).toContain('종목000007'); expect(result).toContain('종목000002');
    expect(result).not.toContain('종목000003'); expect(result).not.toContain('종목000004');
    expect(result.indexOf('<b>매도 ·')).toBeLessThan(result.indexOf('<b>보유 ·'));
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
    expect(result).toContain('최신 판단 일부 확인 1/3종목'); expect(result).toContain('매수 0 · 매도 0');
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
