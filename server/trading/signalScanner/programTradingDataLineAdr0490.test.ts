// @responsibility ADR-0490 program trading data-line sample normalization smoke tests.
import { describe, expect, it } from 'vitest';
import { buildProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';

describe('ADR-0490 program trading data line', () => {
  it('builds sanitized diagnostic-only normalized report', () => {
    const report = buildProgramTradingDataLineReportAdr0490([{ code: '005930', provider: 'KIS', status: 'OK', signal: 'UNKNOWN', confidence: 'LOW', coverageRatio: 0.5, programNetBuy: 0 }]);
    expect(report.status).toBe('NORMALIZED');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });
});
