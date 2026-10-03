// @responsibility Verify Telegram analysis uses immutable adaptive entry evidence.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade, PaperTradeMeasurementPoint } from '../../src/types/paperStrategy.js';
import type { PaperAdaptiveEvidence } from '../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../src/types/paperIndicatorFormula.js';
import { formatPaperTradeAnalysis, formatPaperTrades } from './paperBotMessages.js';
import { validateTelegramHtml } from './telegramHtmlSanitizer.js';

const entryAt = '2026-09-21T01:00:00Z';
const adaptiveEvidence: PaperAdaptiveEvidence = {
  cutoffAt: '2026-09-20T15:00:00Z', evaluatedAt: entryAt, validationStartDate: '2026-09-01',
  policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
  candidate: { rule: { feature: 'rsi14', bucket: 1, horizon: 3 }, active: true, reason: 'ACTIVE',
    training: { sampleCount: 20, dateCount: 5, symbolCount: 4, experimentIds: [], meanNetReturnPct: 1.5, meanDailyExcessPct: 0.2 },
    validation: { sampleCount: 12, dateCount: 3, symbolCount: 4, experimentIds: [], meanNetReturnPct: 1.2, meanDailyExcessPct: 0.15 } },
};
const trade: PaperStrategyTrade = {
  id: 'adaptive-features-v1:2026-09-21:005930', strategyVersion: 'adaptive-features-v1', symbol: '005930', name: '<삼성&>',
  status: 'OPEN', entryAt, entrySnapshotId: 's1', tradingDate: '2026-09-21', entryPrice: 10000, quantity: 1,
  entryObservation: { symbol: '005930', name: '<삼성&>', price: 10000, observedAt: entryAt, source: 'KIS',
    news: [], dailyCloses: [], return1dPct: null, return5dPct: null, aboveMa20: null },
  entryDecision: { snapshotId: 's1', decisionAt: entryAt, symbol: '005930', name: '<삼성&>', action: 'BUY',
    reasonCode: 'ADAPTIVE_FEATURE_SELECTED', reason: '후반 검증 통과', cohort: null, evidence: null, adaptiveEvidence,
    tradeId: 'adaptive-features-v1:2026-09-21:005930' },
  policy: { version: 'adaptive-features-v1', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
    horizonSelection: 'FORWARD_VALIDATED_FEATURE', exitModel: 'SCHEDULED_CLOSE' },
  costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
  horizon: 3, scheduledExitDate: '2026-09-28', scheduledExitAt: '2026-09-28T06:30:00Z', exit: null,
};
function measuredExitTrade(): PaperStrategyTrade {
  const point: PaperTradeMeasurementPoint = { snapshotId: 'measure', kind: 'QUOTE', effectiveAt: '2026-09-23T01:00:00Z',
    observedAt: '2026-09-23T01:00:00Z', recordedAt: '2026-09-23T01:01:00Z', price: 10300, source: 'KIS', netReturnPct: 3, netPnl: 300,
    action: 'HOLD', reasonCode: 'HORIZON_PENDING', ruleValue: 35, ruleMatches: true, ruleConnected: true, featureAsOf: '2026-09-23T01:00:00Z' };
  const exitedAt = '2026-09-28T07:01:00Z';
  const latest: PaperTradeMeasurementPoint = { ...point, kind: 'SCHEDULED_CLOSE', effectiveAt: trade.scheduledExitAt,
    observedAt: '2026-09-28T07:00:00Z', recordedAt: exitedAt, price: 10000, netReturnPct: 0, netPnl: 0,
    action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED' };
  return { ...structuredClone(trade), status: 'CLOSED', measurement: { version: 'observed-trade-path-v1', startedAt: point.recordedAt,
    fromEntry: false, pointCount: 3, latest, highest: point, lowest: latest }, exit: { model: 'SCHEDULED_CLOSE', snapshotId: 'exit',
      effectiveAt: trade.scheduledExitAt, observedAt: latest.observedAt, decisionAt: exitedAt, price: 10000,
      grossReturnPct: 0, netReturnPct: 0, netPnl: 0, decision: { ...trade.entryDecision, action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED', decisionAt: exitedAt } } };
}

describe('adaptive trade analysis', () => {
  it('adds sampled path and giveback only to close analysis while preserving zero results and partial-history disclosure', () => {
    const measured = measuredExitTrade(), event = { id: 'exit', at: measured.exit!.decisionAt, trade: measured, side: 'EXIT' as const };
    const report = formatPaperTradeAnalysis([event]);
    expect(report).toContain('보유 중 관측 3개 · 추적 시작');
    expect(report).toContain('진입 후 중간 추적 · 이전 구간 미기록');
    expect(report).toContain('최근 0.00% · 10,000원');
    expect(report).toContain('관측 최고 +3.00% · 10,300원');
    expect(report).toContain('관측 최저 0.00% · 10,000원');
    expect(report).toContain('관측 최고 순수익 − 청산 순수익 3.00%p · 중간 추적 구간 기준');
    expect(report).toMatch(/가격 .*15:30.*관측 .*16:00.*기록 .*16:01/);
    expect(report).toContain('실제 장중 최고·최저나 최적 매도점은 아닙니다');
    expect(formatPaperTrades([event])).not.toContain('관측 최고');
    expect(formatPaperTradeAnalysis([{ ...event, side: 'BUY', at: trade.entryAt }])).not.toContain('관측 최고');
    expect(report.length).toBeLessThanOrEqual(3500);
    expect(validateTelegramHtml(report).valid).toBe(true);
  });

  it('does not substitute zero or future-recorded measurements into an earlier close report', () => {
    const measured = measuredExitTrade(), event = { id: 'exit', at: measured.exit!.decisionAt, trade: measured, side: 'EXIT' as const };
    measured.measurement!.highest.recordedAt = '2026-09-29T01:00:00Z';
    const future = formatPaperTradeAnalysis([event]);
    expect(future).toContain('청산 시점에 확인 가능한 가격 측정 기록 없음');
    expect(future).not.toContain('관측 최고 +3.00%');
    delete measured.measurement;
    const missing = formatPaperTradeAnalysis([event]);
    expect(missing).toContain('보유 중 가격 측정 미기록 · 관측 최고 대비 청산 차이 미집계');
    expect(missing).not.toContain('청산 순수익 0.00%p');
  });

  it('retains an entry extreme based on a quote observed before the actual entry timestamp', () => {
    const measured = measuredExitTrade(), path = measured.measurement!;
    path.fromEntry = true; path.startedAt = measured.entryAt; path.pointCount = 2;
    path.highest = { ...path.highest, snapshotId: measured.entrySnapshotId, kind: 'ENTRY', effectiveAt: measured.entryAt,
      observedAt: '2026-09-21T00:59:00Z', recordedAt: measured.entryAt, price: 10000, netReturnPct: 0, netPnl: 0,
      action: 'BUY', reasonCode: 'ADAPTIVE_FEATURE_SELECTED' };
    Object.assign(path.latest, { price: 9900, netReturnPct: -1, netPnl: -100 });
    path.lowest = path.latest;
    Object.assign(measured.exit!, { price: 9900, netReturnPct: -1, grossReturnPct: -1, netPnl: -100 });
    const report = formatPaperTradeAnalysis([{ id: 'exit', at: measured.exit!.decisionAt, trade: measured, side: 'EXIT' }]);
    expect(report).toContain('관측 최고 0.00% · 10,000원');
    expect(report).toContain('관측 최고 순수익 − 청산 순수익 1.00%p');
    expect(report).not.toContain('경로 비교 미집계');
  });
  it.each(['BUY', 'EXIT'] as const)('labels %s exploration from frozen evidence without claiming successful validation', side => {
    const frozenTrade: PaperStrategyTrade = structuredClone(trade);
    delete frozenTrade.entryDecision.adaptiveEvidence;
    frozenTrade.entryDecision.reasonCode = 'ADAPTIVE_EXPLORATION_SELECTED';
    frozenTrade.entryDecision.explorationEvidence = { ...adaptiveEvidence, validationStartDate: null,
      trialId: 'shadow-exploration-v1:2026-09-21:1:rsi14:1:D3', registeredAt: '2026-09-21T00:59:00Z',
      candidate: { ...adaptiveEvidence.candidate, active: false, reason: 'INSUFFICIENT_VALIDATION',
        validation: { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null } } };
    const events = [{ id: side, at: entryAt, trade: frozenTrade, side }];
    const analysis = formatPaperTradeAnalysis(events), signal = formatPaperTrades(events);
    expect(analysis).toContain('탐색 가상매수 · 검증 전');
    expect(signal).toContain('탐색 가상매수 · 검증 전');
    expect(analysis).toContain('탐색 지표: RSI 14');
    expect(analysis).toContain('후반 시작 누적 대기');
    expect(analysis).toContain('후반 확인 0건/0진입일 · 평균 순수익률 집계 대기');
    expect(analysis).not.toContain('검증 통과 가상매수');
    expect(analysis).not.toContain('진입 당시 학습 근거 미기록');
    expect(analysis.length).toBeLessThanOrEqual(3500);
  });
  it.each(['BUY', 'EXIT'] as const)('keeps %s tied to the original selected feature rather than news cohorts', side => {
    const text = formatPaperTradeAnalysis([{ id: side, at: side === 'BUY' ? entryAt : '2026-09-28T07:00:00Z', trade, side }]);
    expect(text).toContain('자동 연결 지표: RSI 14 · 30 이상 50 미만 · D3');
    expect(text).toContain('학습 20건/5진입일 · 평균 순수익률 +1.50% · 일당 대조군 차이 +0.20%p');
    expect(text).toContain('후반 확인 12건/3진입일 · 평균 순수익률 +1.20% · 일당 대조군 차이 +0.15%p');
    expect(text).toContain('후반 시작 2026-09-01');
    expect(text).toContain('이후 지표 연결 해제는 이 거래의 보유기간을 바꾸지 않습니다');
    expect(text).toContain('&lt;삼성&amp;&gt;');
    expect(text).not.toContain('진입 당시 학습 근거 미기록');
    expect(text).not.toContain('D1·D3·D5 중 거래일당 평균 성과로 보유기간 선택');
    expect(text.length).toBeLessThan(3500);
  });
  it.each(['BUY', 'EXIT'] as const)('preserves the invented formula and its original creation time for %s', side => {
    const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
    const invention = { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-04T01:00:00Z',
      discoveryCutoffAt: '2026-09-03T15:00:00Z', rule: { bucket: 2, horizon: 3 as const },
      training: adaptiveEvidence.candidate.training };
    const frozenTrade = { ...trade, entryDecision: { ...trade.entryDecision,
      adaptiveEvidence: { ...adaptiveEvidence, validationStartDate: '2026-09-07',
        candidate: { ...adaptiveEvidence.candidate, rule: { feature: invention.id, ...invention.rule, invention } } } } };
    const text = formatPaperTradeAnalysis([{ id: side, at: side === 'BUY' ? entryAt : '2026-09-28T07:00:00Z', trade: frozenTrade, side }]);
    expect(text).toContain('자동 연결 지표: 발명 · N(RSI 14) × N(완료일 거래량 / 이전 20일 평균)');
    expect(text).toContain('원본 수식 생성 2026-09-04T01:00:00Z · 발명 자료 기준 2026-09-03T15:00:00Z');
    expect(text).toContain('발명 당시 학습 20건/5진입일');
    expect(text).toContain('생성 후 검증 12건/3진입일');
    expect(text).toContain('생성 후 검증 시작 2026-09-07');
    expect(text).not.toContain('후반 확인');
    expect(text.length).toBeLessThan(3500);
  });
});
