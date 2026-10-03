// @responsibility Verify Telegram analysis uses immutable adaptive entry evidence.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import type { PaperAdaptiveEvidence } from '../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../src/types/paperIndicatorFormula.js';
import { formatPaperTradeAnalysis } from './paperBotMessages.js';

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

describe('adaptive trade analysis', () => {
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
