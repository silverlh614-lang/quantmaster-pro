import { describe, expect, it } from 'vitest';
import {
  buildWeightFeedbackReport,
  formatWeightFeedbackCompact,
  formatWeightFeedbackDetail,
  formatWeightFeedbackFull,
} from './dynamicWeightFeedback.js';
import { repeatSamples, sampleSeed } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0524 weight feedback report', () => {
  it('builds a report-only package from labeled samples without mutating weights', () => {
    const report = buildWeightFeedbackReport({
      seeds: [
        ...repeatSamples('WIN', 100, {
          gate2AxisScores: { SUPPLY_CONFLUENCE: 94, TECHNICAL_TREND: 70 },
        }),
        ...repeatSamples('LOSS', 15, {
          gate2AxisScores: { VOLUME_CONFIRMATION: 90 },
        }),
        sampleSeed('WIN', { pending: true }),
      ],
      createdAt: '2026-06-01T00:00:00.000Z',
    });

    expect(report.reportId).toBe('weight-feedback-2026-06-01');
    expect(report.totalValidSamples).toBe(115);
    expect(report.excludedSamples).toBe(1);
    expect(report.executionImpact).toBe('NONE');
    expect(report.governanceStatus).toBe('PENDING_REVIEW');
    expect(report.suggestedActions.some(action => action.factorName === 'SUPPLY_CONFLUENCE')).toBe(true);
    expect(report.suggestedActions.every(action => action.currentWeight === action.currentWeight)).toBe(true);
  });

  it('renders compact, detail, and full forensic output with governance boundaries', () => {
    const report = buildWeightFeedbackReport({
      seeds: [
        ...repeatSamples('WIN', 100, { gate2AxisScores: { SUPPLY_CONFLUENCE: 94 } }),
        ...repeatSamples('MISSED_WIN', 30, { engineMode: 'SELL_ONLY' }),
      ],
      createdAt: '2026-06-01T00:00:00.000Z',
    });

    const compact = formatWeightFeedbackCompact(report);
    expect(compact).toContain('[Weight Feedback]');
    expect(compact).toContain('status: REPORT_ONLY');
    expect(compact).toContain('impact: NONE');

    const detail = formatWeightFeedbackDetail(report);
    expect(detail).toContain('Factor Contribution:');
    expect(detail).toContain('Suggested Actions:');
    expect(detail).toContain('OverBlock:');

    const full = formatWeightFeedbackFull(report);
    expect(full).toContain('Governance Handoff:');
    expect(full).toContain('"autoApplyAllowed": false');
  });
});
