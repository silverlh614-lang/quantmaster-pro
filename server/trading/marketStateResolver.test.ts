import { describe, expect, it } from 'vitest';
import { formatMarketStateNow, type MarketStateSnapshot } from './marketStateResolver.js';

function baseSnapshot(overrides: Partial<MarketStateSnapshot> = {}): MarketStateSnapshot {
  return {
    snapshotId: 'mkt_test',
    asOf: '2026-05-18T07:00:00.000Z',
    ttlSec: 300,
    biasScore: -23.9,
    biasLabel: 'BEAR',
    mhs: 70,
    mhsLabel: 'GREEN',
    detectedRegime: 'R4_NEUTRAL',
    rawTrend: 'GREEN',
    riskOverride: 'NONE',
    effectiveRegime: 'R6_CONFIRMATION_WAIT',
    liveNewBuyAllowed: false,
    liveSellAllowed: true,
    positionManagementAllowed: true,
    shadowLearningAllowed: true,
    shadowScanAllowed: true,
    shadowPaperFillAllowed: true,
    executionMode: 'SELL_ONLY',
    displaySeverity: 'DEFENSE',
    displayTitle: 'R6_CONFIRMATION_WAIT',
    displayEmoji: '🔴',
    reasonCodes: ['R6_SHOCK_LATCH', 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION'],
    stale: false,
    staleSources: [],
    macroState: {
      stale: false,
      freshness: 'FRESH',
      ageSec: 10,
      ttlSec: 300,
      softStaleSec: 900,
      hardStaleSec: 900,
      staleReason: 'NONE',
      executionImpact: 'NONE',
    },
    r6Latch: {
      active: true,
      triggerType: 'KOSPI_INTRADAY_LOW_SHOCK',
      triggeredAt: '2026-05-18T06:00:00.000Z',
      releaseEligibleAt: '2026-05-18T08:18:00.000Z',
      expiresAt: '2026-05-18T23:18:00.000Z',
      severity: -3.4,
      decayLevel: 0,
      decayBlockedReason: 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION',
      activeTriggers: [],
      previousTriggers: ['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK'],
    },
    ...overrides,
  };
}

describe('formatMarketStateNow', () => {
  it('shows R6 confirmation wait diagnostics without reopening live buys', () => {
    const text = formatMarketStateNow(baseSnapshot());

    expect(text).toContain('🔴 R6_CONFIRMATION_WAIT');
    expect(text).toContain('상태: 급락 shock 이후 종가/다음 거래일 확인 대기');
    expect(text).toContain('Live buy: BLOCKED');
    expect(text).toContain('Shadow: ON');
    expect(text).toContain('activeR6Triggers: none');
    expect(text).toContain('previousR6Triggers: KOSPI_INTRADAY_LOW_SHOCK,KOSPI_CLOSE_SHOCK');
    expect(text).toContain('releaseEligibleAt: 17:18 KST');
    expect(text).toContain('expiresAt: next day 08:18 KST');
    expect(text).toContain('다음 조건: 추가 저점 이탈 없음 + 종가 안정 + macro fresh');
  });
});
