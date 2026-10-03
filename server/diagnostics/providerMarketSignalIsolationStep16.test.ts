import { describe, expect, it } from 'vitest';

import { normalizeDataSignal } from '../data/dataConfidenceRouter.js';
import { resolveSimpleTradeDecision, formatSimpleDecisionFinalLog } from '../trading/gates/simpleDecision.js';
import {
  buildMarketSignal,
  classifyDataVacuumAsDataGap,
  classifyProviderHealthSnapshot,
  formatDataVacuumClassifiedAsDataGapLog,
  formatDiagnosticProviderIssueIsolatedLog,
  formatEmptyResponseClassifiedAsNoDataLog,
  formatProviderIssueIsolatedFromMarketSignalLog,
  isolateDiagnosticProviderIssue,
} from './providerMarketSignalIsolationStep16.js';

describe('Simplification Step 16 provider health / market signal isolation', () => {
  it('A. KIS 500 is a provider issue, not a bearish market signal', () => {
    const signal = normalizeDataSignal({
      source: 'KIS',
      rawStatus: 'HTTP_500',
      requestedMarketSignal: true,
      missingFields: ['supply'],
    });
    const marketSignal = buildMarketSignal({
      source: 'KIS',
      requestedDirection: 'BEARISH',
      providerHealth: signal.providerHealthSnapshot,
    });
    const log = formatProviderIssueIsolatedFromMarketSignalLog({
      snapshotId: 'scan_1',
      symbol: '005930',
      health: signal.providerHealthSnapshot!,
    });

    expect(signal.providerIssue).toBe(true);
    expect(signal.marketSignal).toBe(false);
    expect(signal.providerIssueMarketImpact).toBe('NONE');
    expect(signal.providerHealthSnapshot).toMatchObject({
      provider: 'KIS',
      status: 'ERROR',
      issueType: 'SERVER_ERROR',
      marketSignalImpact: 'NONE',
    });
    expect(marketSignal.direction).not.toBe('BEARISH');
    expect(marketSignal.derivedFromProviderIssue).toBe(false);
    expect(log).toContain('[PROVIDER_ISSUE_ISOLATED_FROM_MARKET_SIGNAL]');
    expect(log).toContain("marketSignalImpact='NONE'");
  });

  it('B. KRX accepted-empty is no data, not bearish', () => {
    const signal = normalizeDataSignal({
      source: 'KRX',
      rawStatus: 'ACCEPTED_EMPTY',
      requestedMarketSignal: true,
    });
    const log = formatEmptyResponseClassifiedAsNoDataLog({
      snapshotId: 'scan_2',
      provider: 'KRX',
      rawStatus: 'ACCEPTED_EMPTY',
    });

    expect(signal.providerIssue).toBe(false);
    expect(signal.marketSignal).toBe(false);
    expect(signal.providerHealthSnapshot?.status).toBe('EMPTY_VALID');
    expect(signal.providerHealthSnapshot?.marketSignalImpact).toBe('NONE');
    expect(log).toContain("newStatus='EMPTY_VALID'");
    expect(log).toContain('bearishSignalCreated=false');
  });

  it('C. missing optional supply data can still allow BUY_ALLOWED when verified scores are sufficient', () => {
    const provider = classifyProviderHealthSnapshot({
      provider: 'KIS',
      rawStatus: 'HTTP_500',
      missingFields: ['supply'],
    });
    const decision = resolveSimpleTradeDecision({
      snapshotId: 'scan_3',
      symbol: '000660',
      dataUsable: true,
      executionScore: 74,
      finalScore: 74,
      riskRewardOk: true,
      slotAvailable: true,
      providerIssuePresent: provider.isProviderIssue,
      providerIssueMarketImpact: 'NONE',
      missingFields: provider.missingFields,
      excludedFeatures: ['supply'],
    });

    expect(decision.decision).toBe('BUY_ALLOWED');
    expect(decision.blockReasons).not.toContain('PROVIDER_ISSUE');
    expect(decision.missingFields).toContain('supply');
    expect(formatSimpleDecisionFinalLog(decision)).toContain('providerIssueMarketImpact=NONE');
  });

  it('D. missing price is a Data Gate gap, not a provider bearish reason', () => {
    const decision = resolveSimpleTradeDecision({
      snapshotId: 'scan_4',
      symbol: '035420',
      dataUsable: false,
      executionScore: 90,
      finalScore: 90,
      missingFields: ['price'],
      providerIssuePresent: true,
      providerIssueMarketImpact: 'NONE',
    });
    const vacuum = classifyDataVacuumAsDataGap({
      snapshotId: 'scan_4',
      symbol: '035420',
      missingFields: ['price'],
    });

    expect(decision.decision).toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(decision.blockReasons).toContain('DATA_INCOMPLETE');
    expect(decision.blockReasons).not.toContain('PROVIDER_ISSUE');
    expect(vacuum.marketSignal).toBe('NOT_EVALUATED');
    expect(vacuum.executionImpact).toBe('DATA_REQUIRED_MISSING');
    expect(formatDataVacuumClassifiedAsDataGapLog(vacuum)).toContain('[DATA_VACUUM_CLASSIFIED_AS_DATA_GAP]');
  });

  it('E. P3 diagnostic budget exceeded has no execution or market impact', () => {
    const isolated = isolateDiagnosticProviderIssue({
      priority: 'P3_SCAN_DIAGNOSTIC',
      reason: 'BUDGET_EXCEEDED',
    });

    expect(isolated.executionImpact).toBe('NONE');
    expect(isolated.marketSignalImpact).toBe('NONE');
    expect(isolated.confidenceAdjustment).toBe(0);
    expect(formatDiagnosticProviderIssueIsolatedLog(isolated)).toContain('[DIAGNOSTIC_PROVIDER_ISSUE_ISOLATED]');
  });


});
