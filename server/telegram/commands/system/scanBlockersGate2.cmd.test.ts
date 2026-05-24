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
let mockGate2Cache: any = {
  version: 1,
  updatedAt: null,
  records: [],
};

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

vi.mock('../../../trading/gate2/gate2ExternalCache.js', () => ({
  loadGate2ExternalCache: () => mockGate2Cache,
}));

describe('/scan_blockers_gate2 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = baseMockSummary();
    mockGate2Cache = {
      version: 1,
      updatedAt: null,
      records: [],
    };
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
      asOf: '2026-05-24T00:00:00.000Z',
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: '005930',
            gate2ExternalDataCoverage: {
              stageStatus: 'OLD_SCAN_PROJECTION',
              dartFinancials: { status: 'MISSING', source: 'NONE', reason: 'DART_FINANCIALS_MISSING' },
              valuation: { per: { status: 'UNAVAILABLE', source: 'NONE', reason: 'PER_MISSING' } },
              earningsQuality: { status: 'UNAVAILABLE', source: 'NONE', reason: 'EARNINGS_QUALITY_UNAVAILABLE' },
              highConvictionImpact: 'BLOCK_STRONG_BUY_UPGRADE',
              entryHardBlockImpact: 'NO',
              shadowObservablePreserved: true,
              counterfactualAllowed: true,
              blockingDetails: 'PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1',
              externalDataBlockReason: 'GATE2_EXTERNAL_PARTIAL',
              externalDataBlockedDetails: 'PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1',
              fundamentalQualityFailReason: 'NONE',
              qualityFailDetails: 'NONE',
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
    mockGate2Cache = {
      version: 1,
      updatedAt: '2026-05-24T00:10:00.000Z',
      lastRefresh: {
        asOf: '2026-05-24T00:10:00.000Z',
        blockingDetails: 'PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1',
        strongBuyBlockedDetails: 'PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1',
        externalDataBlockReason: 'GATE2_EXTERNAL_PARTIAL',
        externalDataBlockedDetails: 'PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1',
        fundamentalQualityFailReason: 'NONE',
        qualityFailDetails: 'NONE',
        excludedDetails: 'DART_NOT_APPLICABLE_2',
        excludedCount: 2,
        traces: [{ symbol: '005930' }, { symbol: '000660' }],
      },
      records: [
        {
          symbol: '005930',
          updatedAt: '2026-05-24T00:10:00.000Z',
          projection: {
            financialSnapshot: {
              confidence: 'VERIFIED',
              source: 'DART',
              fiscalPeriod: '2026Q1',
              rawStatus: 'OK_WITH_DATA',
              lastUpdated: '2026-05-24T00:10:00.000Z',
            },
            valuation: { per: { status: 'PASS', source: 'KIS', value: 12, per: 12, reason: 'PER_ACCEPTABLE' } },
            profitability: { roe: 0.2, opm: 0.12, netMargin: 0.1, source: 'DART' },
            stability: { icr: 5, debtRatio: 0.4, currentRatio: 1.2, source: 'DART' },
            earningsQuality: { status: 'FAIL', source: 'DART', score: 0.8, reason: 'OCF_BELOW_NET_INCOME' },
            conditionResults: {
              earnings_quality: { status: 'FAIL', value: 0.8, source: 'DART', reason: 'OCF_BELOW_NET_INCOME' },
              per: { status: 'PASS', value: 12, source: 'KIS', reason: 'PER_ACCEPTABLE' },
              roe: { status: 'PASS', value: 0.2, source: 'DART', reason: 'NONE' },
              opm: { status: 'PASS', value: 0.12, source: 'DART', reason: 'NONE' },
              icr: { status: 'PASS', value: 5, source: 'DART', reason: 'NONE' },
            },
            highConvictionImpact: 'BLOCK_STRONG_BUY_UPGRADE',
            entryHardBlockImpact: 'NO',
            shadowObservablePreserved: true,
            counterfactualAllowed: true,
          },
        },
        {
          symbol: '000660',
          updatedAt: '2026-05-24T00:10:00.000Z',
          projection: {
            financialSnapshot: {
              confidence: 'VERIFIED',
              source: 'DART',
              fiscalPeriod: '2026Q1',
              rawStatus: 'OK_WITH_DATA',
              lastUpdated: '2026-05-24T00:10:00.000Z',
            },
            valuation: { per: { status: 'UNAVAILABLE', source: 'KIS', value: null, per: null, reason: 'PER_MISSING' } },
            profitability: { roe: 0.1, opm: 0.08, netMargin: 0.06, source: 'DART' },
            stability: { icr: 3, debtRatio: 0.5, currentRatio: 1.1, source: 'DART' },
            earningsQuality: { status: 'UNAVAILABLE', source: 'DART', score: null, reason: 'EARNINGS_QUALITY_UNAVAILABLE' },
            conditionResults: {
              earnings_quality: { status: 'UNAVAILABLE', value: null, source: 'DART', reason: 'EARNINGS_QUALITY_UNAVAILABLE' },
              per: { status: 'UNAVAILABLE', value: null, source: 'KIS', reason: 'PER_MISSING' },
              roe: { status: 'PASS', value: 0.1, source: 'DART', reason: 'NONE' },
              opm: { status: 'PASS', value: 0.08, source: 'DART', reason: 'NONE' },
              icr: { status: 'PASS', value: 3, source: 'DART', reason: 'NONE' },
            },
            highConvictionImpact: 'BLOCK_STRONG_BUY_UPGRADE',
            entryHardBlockImpact: 'NO',
            shadowObservablePreserved: true,
            counterfactualAllowed: true,
          },
        },
      ],
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
    expect(text).toContain('gate2CacheAsOf=2026-05-24T00:10:00.000Z lastScanSummaryAsOf=2026-05-24T00:00:00.000Z projectionStale=true');
    expect(text).toContain('note=SCAN_SUMMARY_OLDER_THAN_GATE2_REFRESH');
    expect(text).toContain('strongBuyBlockedDetails=PER_PROVIDER_MISSING_1|TRUE_CORP_CODE_NOT_FOUND_1');
    expect(text).toContain('externalDataBlockReason=GATE2_EXTERNAL_PARTIAL');
    expect(text).toContain('qualityFailDetails=NONE');
    expect(text).toContain('equityFinancialCoverage=0/0');
    expect(text).toContain('excludedDetails=DART_NOT_APPLICABLE_2');
  });
});
