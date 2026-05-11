// @responsibility ADR-0483 supply source freshness dual-clock regression tests.
import { describe, expect, it } from 'vitest';
import {
  buildSupplySourceFreshnessReportAdr0483,
  formatSupplySourceFreshnessCompactAdr0483,
  tradingDayDistanceAdr0483,
} from './supplySourceFreshnessAdr0483.js';

describe('supplySourceFreshnessAdr0483', () => {
  it('separates fresh cache from stale source data', () => {
    const report = buildSupplySourceFreshnessReportAdr0483({
      now: new Date('2026-05-08T03:00:00Z'),
      staleSourceTradingDays: 2,
      staleCacheMinutes: 60,
      sources: [{ source: 'FSS', cacheUpdatedAt: '2026-05-08T02:45:00Z', sourceDate: '2026-05-01', providerStatus: 'OK' }],
    });

    expect(report.status).toBe('REFRESH_RECOMMENDED');
    expect(report.rows[0]?.cacheState).toBe('FRESH');
    expect(report.rows[0]?.sourceState).toBe('STALE');
    expect(report.rows[0]?.expectedFreshnessDays).toBe(2);
    expect(report.rows[0]?.usableForLive).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('keeps non-trading-day refresh recommendations diagnostic-only', () => {
    const report = buildSupplySourceFreshnessReportAdr0483({
      now: new Date('2026-05-09T03:00:00Z'),
      sources: [{ source: 'NAVER', cacheUpdatedAt: '2026-05-09T02:50:00Z', sourceDate: '2026-05-01', providerStatus: 'STALE' }],
    });

    expect(report.status).toBe('NON_TRADING_DAY');
    expect(report.refreshStatus).toBe('SKIPPED_NON_TRADING_DAY');
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(formatSupplySourceFreshnessCompactAdr0483(report)).toContain('impact=NONE');
  });

  it('counts trading-day source age without weekends', () => {
    expect(tradingDayDistanceAdr0483('2026-05-01', '2026-05-08')).toBe(4);
  });
});
