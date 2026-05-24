// @responsibility /scan_blockers_gate2 compact Gate2 ExternalData slice command tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

function baseMockSummary(): any {
  return {
  entryFilterDecomposition: {
    candidateTraces: [
      {
        symbol: '000660',
        gate2ExternalDataCoverage: {
          stageStatus: 'STAGE_OBSERVED',
          dartFinancials: {
            status: 'MISSING',
            source: 'NONE',
            reason: 'DART_FINANCIALS_MISSING',
          },
          valuation: {
            per: {
              status: 'MISSING',
              source: 'NONE',
              reason: 'PER_MISSING',
            },
          },
          earningsQuality: {
            status: 'UNAVAILABLE',
            reason: 'EARNINGS_QUALITY_UNAVAILABLE',
          },
        },
        conditionResultsTrace: [
          { key: 'earnings_quality', status: 'DATA_UNAVAILABLE', score: 0, fired: false, unavailable: true, thresholdNotMet: false, providerDegraded: false, detail: 'DART missing' },
          { key: 'per', status: 'DATA_UNAVAILABLE', score: 0, fired: false, unavailable: true, thresholdNotMet: false, providerDegraded: false, detail: 'PER missing' },
        ],
      },
    ],
  },
};
}

let mockSummary: any = baseMockSummary();

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

describe('/scan_blockers_gate2 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = baseMockSummary();
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers typo and compact aliases and replies with only the Gate2 external data slice', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate2.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate2');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/scan_blokers_gate2')).toBe(command);
    expect(registry.commandRegistry.resolve('/gate2_external')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: [],
      reply: async (message) => {
        replies.push(message);
      },
    });
    const text = replies.join('\n');

    expect(text).toContain('[scan_blockers_gate2] Gate2 ExternalData / DART PER Earnings Quality');
    expect(text).toContain('Gate2ExternalData:');
    expect(text).toContain('dart: status=MISSING source=NONE reason=DART_FINANCIALS_MISSING');
    expect(text).toContain('valuation: perStatusSample=UNAVAILABLE perStatusAggregate=UNAVAILABLE');
    expect(text).toContain('earnings_quality:status=UNAVAILABLE');
    expect(text).toContain('GATE2_EXTERNAL/DART_FINANCIALS');
    expect(text).toContain('highConvictionImpact=BLOCK_STRONG_BUY_UPGRADE');
    expect(text).toContain('no scan execution');
  });

  it('shows partial DART/PER aggregates when some candidates have usable Gate2 data', async () => {
    mockSummary = {
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: '005930',
            gate2ExternalDataCoverage: {
              stageStatus: 'STAGE_OBSERVED',
              dartFinancials: { status: 'VERIFIED', source: 'DART', reason: 'NONE' },
              valuation: { per: { status: 'PASS', source: 'KIS', value: 12, per: 12, reason: 'PER_ACCEPTABLE' } },
              earningsQuality: { status: 'FAIL', source: 'DART', score: 0.8, reason: 'OCF_BELOW_NET_INCOME' },
              highConvictionImpact: 'BLOCK_STRONG_BUY_UPGRADE',
              entryHardBlockImpact: 'NO',
              shadowObservablePreserved: true,
              counterfactualAllowed: true,
              blockingDetails: 'PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1',
              excludedDetails: 'DART_NOT_APPLICABLE_2',
              excludedCount: 2,
            },
            conditionResultsTrace: [
              { key: 'earnings_quality', status: 'FAIL', value: 0.8, source: 'DART', detail: 'OCF_BELOW_NET_INCOME' },
              { key: 'per', status: 'PASS', value: 12, source: 'KIS', detail: 'PER_ACCEPTABLE' },
            ],
          },
          {
            symbol: '000660',
            conditionResultsTrace: [
              { key: 'earnings_quality', status: 'DATA_UNAVAILABLE', source: 'NONE', detail: 'DART missing' },
              { key: 'per', status: 'DATA_UNAVAILABLE', source: 'NONE', detail: 'PER missing' },
            ],
          },
        ],
      },
    };
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate2.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate2');
    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');

    expect(text).toContain('valuation: perStatusSample=PASS perStatusAggregate=PARTIAL');
    expect(text).toContain('earningsQuality: status=FAIL');
    expect(text).toContain('earnings_quality:status=PARTIAL:value=0.8:source=DART:reason=EARNINGS_QUALITY_PARTIAL');
    expect(text).toContain('per:status=PARTIAL:value=12:source=KIS:reason=PER_PARTIAL');
    expect(text).toContain('strongBuyBlockedDetails=PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1');
    expect(text).toContain('excludedDetails=DART_NOT_APPLICABLE_2');
  });
});
