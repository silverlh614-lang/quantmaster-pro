import { describe, expect, it } from 'vitest';
import { formatRegimeTelegramNow } from './regimeTelegramPresenter.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';
import type { MarketStateNowContext } from '../marketStateResolver.js';

function r6Snapshot(overrides: Partial<ResolvedRegimeSnapshot> = {}): ResolvedRegimeSnapshot {
  const marketState = {
    snapshotId: 'mkt_r6',
    asOf: '2026-05-19T00:00:00.000Z',
    ttlSec: 300,
    biasScore: 22.4,
    biasLabel: 'BULL',
    mhs: 70,
    mhsLabel: 'GREEN',
    rawMhs: 70,
    rawMhsLabel: 'GREEN',
    mhsDisplayLabel: 'GREEN',
    detectedRegime: 'R3_EARLY',
    rawTrend: 'GREEN',
    riskOverride: 'NONE',
    effectiveRegime: 'R6_DEFENSE',
    liveNewBuyAllowed: false,
    liveSellAllowed: true,
    positionManagementAllowed: true,
    shadowLearningAllowed: true,
    shadowScanAllowed: true,
    shadowPaperFillAllowed: true,
    executionMode: 'SELL_ONLY',
    displayRegime: 'R6_DEFENSE',
    displaySeverity: 'DEFENSE',
    displayTitle: 'R6_DEFENSE',
    displayEmoji: 'R6',
    displayLabel: 'R6 R6_DEFENSE',
    reasonCodes: ['R6_SHOCK_LATCH'],
    stale: false,
    staleSources: [],
    macroState: {
      stale: false,
      freshness: 'POST_CLOSE_VALID',
      ageSec: 6332,
      ttlSec: 300,
      softStaleSec: 900,
      hardStaleSec: 900,
      staleReason: 'NONE',
      updatedAt: '2026-05-19T06:00:00.000Z',
      lastRefreshAttemptAt: '2026-05-19T06:00:00.000Z',
      lastRefreshSuccessAt: '2026-05-19T06:00:00.000Z',
      refreshJobLastRunAt: '2026-05-19T06:00:00.000Z',
      fallbackUsed: false,
      writeSucceeded: true,
      updatedAtChanged: false,
      executionImpact: 'NONE',
    },
    r6Latch: {
      active: true,
      triggerType: 'KOSPI_INTRADAY_LOW_SHOCK',
      triggeredAt: '2026-05-19T05:00:00.000Z',
      expiresAt: '2026-05-19T18:25:00.000Z',
      severity: 1,
      decayLevel: 0,
      decayBlockedReason: 'WAITING_NEXT_TRADING_DAY_CONFIRMATION',
      releaseEligibleAt: '2026-05-19T03:25:00.000Z',
      activeTriggers: [],
      previousTriggers: ['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK'],
    },
  } as unknown as ResolvedRegimeSnapshot['marketState'];

  return {
    snapshotId: 'regime_r6',
    asOf: marketState.asOf,
    ttlSec: 300,
    detectedRegime: 'R3_EARLY',
    effectiveRegime: 'R6_DEFENSE',
    displayRegime: 'R6_DEFENSE',
    riskOverride: 'R6_DEFENSE',
    engineMode: 'SELL_ONLY',
    biasScore: 22.4,
    mhs: 70,
    dataHealth: { macroState: 'STALE' },
    sourceHealth: 'STALE',
    stale: true,
    providerIssue: true,
    marketSignal: false,
    conflicts: [],
    macroState: null,
    marketState,
    diagnostics: {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R6_DEFENSE',
    } as unknown as ResolvedRegimeSnapshot['diagnostics'],
    ...overrides,
  };
}

const shadowContext: MarketStateNowContext = {
  activePositions: 2,
  maxPositions: 8,
  lastSignalLabel: '15:10 KST',
  shadowActivity: {
    scanAllowed: true,
    evaluatedCount: 0,
    candidateCount: 0,
    buySignalCount: 0,
    sellCheckCount: 3,
    paperFillCount: 1,
    openShadowPositions: 3,
    candidateScanStatus: 'NOT_RUN',
    candidateScanTrigger: 'SCHEDULED',
    candidateSkipReason: 'SCHEDULER_NOT_TRIGGERED',
  },
};

describe('formatRegimeTelegramNow', () => {
  it('renders compact NOW by default without raw detail fields', () => {
    const text = formatRegimeTelegramNow(r6Snapshot(), shadowContext);

    expect(text).toContain('[NOW]');
    expect(text).toContain('Display regime: R3_EARLY');
    expect(text).toContain('Effective regime: R3_EARLY');
    expect(text).toContain('Live Buy: GATE_DATA_ONLY');
    expect(text).toContain('Shadow: ON');
    expect(text).toContain('MHS: 70 GREEN');
    expect(text).toContain('Legacy defense policy: disabled');
    expect(text).not.toContain('Legacy R6/SELL_ONLY');
    expect(text).not.toContain('engineMode=SELL_ONLY');
    expect(text).toContain('providerIssue isolated');
    expect(text).toContain('candidate scan: DEFERRED_POST_CLOSE');
    expect(text).toContain('raw detail: /now_debug');
    expect(text).not.toContain('rawData:');
    expect(text).not.toContain('macroState:');
    expect(text).not.toContain('writeSucceeded');
    expect(text).not.toContain('updatedAtChanged');
    expect(text).not.toContain('fallbackUsed');
    expect(text).not.toContain('activeR6Triggers:');
    expect(text).not.toContain('previousR6Triggers:');
    expect(text).not.toContain('candidateEvaluated');
  });

  it('keeps R6 latch summary in compact NOW without raw latch internals', () => {
    const text = formatRegimeTelegramNow(r6Snapshot(), shadowContext);

    expect(text).toContain('R6 latch:');
    expect(text).toContain('state: COOLDOWN_WAITING_CONFIRMATION');
    expect(text).toContain('retained: KOSPI_INTRADAY_LOW_SHOCK, KOSPI_CLOSE_SHOCK');
    expect(text).toContain('releaseEligibleAt: 12:25 KST');
    expect(text).not.toContain('decayBlockedReason');
    expect(text).not.toContain('trigger: KOSPI_INTRADAY_LOW_SHOCK');
  });

  it('renders DEBUG mode with rawData, macroState and release block details', () => {
    const snapshot = r6Snapshot({
      macroReleaseBlockMessage: 'Macro snapshot is HARD_STALE, R6 release is deferred.',
      macroReleaseBlockDetails: {
        ageSec: 3600,
        lastRefreshAttemptAt: '2026-05-18T06:00:00.000Z',
        refreshJobLastRunAt: '2026-05-18T05:00:00.000Z',
        executionImpact: 'REGIME_RELEASE_BLOCKED_ONLY',
      },
    });
    const text = formatRegimeTelegramNow(snapshot, shadowContext, { mode: 'DEBUG', includeRaw: true });

    expect(text).toContain('[NOW DEBUG]');
    expect(text).toContain('DEBUG VIEW - raw fields included');
    expect(text).toContain('rawData:');
    expect(text).toContain('R6 latch raw:');
    expect(text).toContain('Shadow raw:');
    expect(text).toContain('macroState raw:');
    expect(text).toContain('rawData: dataHealth=STALE providerIssue=true marketSignal=false');
    expect(text).toContain('conflicts=none - provider issue isolated from market signal');
    expect(text).toContain('macroState:');
    expect(text).toContain('writeSucceeded');
    expect(text).toContain('updatedAtChanged');
    expect(text).toContain('activeR6Triggers:');
    expect(text).toContain('previousR6Triggers:');
    expect(text).toContain('Macro snapshot is HARD_STALE, R6 release is deferred.');
    expect(text).toContain('refreshJobLastRunAt=2026-05-18T05:00:00.000Z');
  });
});
