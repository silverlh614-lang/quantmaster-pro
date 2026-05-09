import { describe, expect, it } from 'vitest';
import { buildProgramTradingDataLineReportAdr0490, formatProgramTradingDataLineCompactAdr0490 } from './programTradingDataLineAdr0490.js';

describe('ADR-0490 program trading data line', () => {
  it('normalizes program trading rows as diagnostic-only evidence', () => {
    const report = buildProgramTradingDataLineReportAdr0490({
      generatedAt: '2026-05-09T00:00:00.000Z',
      rows: [{ symbol: '005930', provider: 'KIS', programNetBuy: 1_000 }],
    });
    expect(report.status).toBe('READY');
    expect(report.rows[0]?.signal).toBe('BULLISH');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.policyPromotionMode).toBe('OBSERVE');
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.rawPayloadPersistenceAllowed).toBe(false);
    expect(formatProgramTradingDataLineCompactAdr0490(report)).toContain('impact=NONE');
  });

  it('does not treat provider-empty data as bearish', () => {
    const report = buildProgramTradingDataLineReportAdr0490({ rows: [{ symbol: '000000', provider: 'UNKNOWN' }] });
    expect(report.status).toBe('DATA_UNAVAILABLE');
    expect(report.rows[0]?.signal).toBe('UNKNOWN');
  });
});
