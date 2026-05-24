// @responsibility Gate2 ExternalData refresh/status command registration tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => ({
    entryFilterDecomposition: {
      candidateTraces: [{ symbol: '005930' }, { symbol: '000660' }],
    },
  }),
}));

vi.mock('../../../trading/gate2/gate2ExternalCache.js', () => ({
  loadGate2ExternalCache: () => ({
    version: 1,
    updatedAt: '2026-05-24T00:00:00.000Z',
    lastRefresh: {
      asOf: '2026-05-24T00:00:00.000Z',
      rootCause: 'DART_FINANCIALS_MISSING',
      counters: {
        providerRequestsAttempted: 2,
        corpCodeResolved: 1,
        corpCodeMissing: 1,
        dartNotApplicableCount: 0,
        trueCorpCodeNotFound: 1,
        corpCodeLookupFailed: 0,
        fiscalPeriodResolved: 1,
        fiscalPeriodMissing: 1,
        dartResponsesOk: 1,
        dartResponsesError: 1,
        dartRowsFetched: 12,
        normalizedRowsBuilt: 1,
        derivedMetricsComputed: 1,
        kisPerAttempted: 0,
        kisPerAvailable: 0,
        kisPerUnavailable: 2,
        dartEpsComputed: 0,
        perComputedFromPriceAndEps: 0,
        perCacheHit: 0,
        unavailableDueToPER: 1,
        unavailableDueToCorpCodeMissing: 5,
        unavailableDueToFiscalPeriodMissing: 0,
        unavailableDueToFinancialRowsEmpty: 0,
        unavailableDueToNormalizationFailed: 0,
        unavailableCountRaw: 6,
        unavailableCountActionable: 6,
        unavailableExcludingExcluded: 6,
        excludedCount: 0,
        excludedUnavailableEquivalent: 0,
      },
      strongBuyBlockedDetails: 'PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1',
      blockingDetails: 'PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1',
      excludedDetails: 'NONE',
      excludedCount: 0,
      excludedSymbols: [],
      excludedReason: 'NONE',
      unavailableCountRaw: 6,
      unavailableCountActionable: 6,
      unavailableExcludingExcluded: 6,
      excludedUnavailableEquivalent: 0,
      corpCodeMissingSymbols: ['000660'],
      dartNotApplicableSymbols: [],
      trueCorpCodeNotFoundSymbols: ['000660'],
      corpCodeLookupFailedSymbols: [],
      nonEquitySymbols: [],
      traces: [],
      providerHealth: {
        apiKeyPresent: true,
        corpCodeCacheLoaded: true,
        corpCodeCacheCount: 1,
        lastCorpCodeCacheUpdatedAt: '2026-05-24T00:00:00.000Z',
        requestEnabled: true,
        lastHttpStatus: 200,
        lastErrorCode: null,
        rateLimitState: 'OK',
        cacheWritable: true,
        executionImpact: 'NONE',
      },
    },
    records: [{
      symbol: '005930',
      updatedAt: '2026-05-24T00:00:00.000Z',
      projection: {
        unavailableCount: 1,
        financialSnapshot: {
          source: 'DART',
          confidence: 'VERIFIED',
          fiscalPeriod: '2025',
        },
        profitability: { roe: 0.2, opm: 0.12 },
        stability: { icr: 6 },
      },
    }],
  }),
  summarizeGate2ExternalCache: () => ({
    recordCount: 1,
    latestUpdatedAt: '2026-05-24T00:00:00.000Z',
    verifiedCount: 1,
    staleCount: 0,
    missingCount: 0,
    unavailableCount: 1,
    executionImpact: 'NONE',
  }),
}));

const refreshGate2ExternalData = vi.fn(async () => ({
  asOf: '2026-05-24T00:00:00.000Z',
  requestedSymbols: ['005930', '000660'],
  refreshedCount: 2,
  verifiedCount: 1,
  staleCount: 0,
  missingCount: 1,
  rowsProjected: 2,
  unavailableCount: 4,
  counters: {
    providerRequestsAttempted: 2,
    corpCodeResolved: 1,
    corpCodeMissing: 1,
    dartNotApplicableCount: 0,
    trueCorpCodeNotFound: 1,
    corpCodeLookupFailed: 0,
    fiscalPeriodResolved: 1,
    fiscalPeriodMissing: 1,
    dartResponsesOk: 1,
    dartResponsesError: 1,
    dartRowsFetched: 12,
    normalizedRowsBuilt: 1,
    derivedMetricsComputed: 1,
    kisPerAttempted: 0,
    kisPerAvailable: 0,
    kisPerUnavailable: 2,
    dartEpsComputed: 0,
    perComputedFromPriceAndEps: 0,
    perCacheHit: 0,
    unavailableDueToPER: 1,
    unavailableDueToCorpCodeMissing: 5,
    unavailableDueToFiscalPeriodMissing: 0,
    unavailableDueToFinancialRowsEmpty: 0,
    unavailableDueToNormalizationFailed: 0,
    unavailableCountRaw: 6,
    unavailableCountActionable: 6,
    unavailableExcludingExcluded: 6,
    excludedCount: 0,
    excludedUnavailableEquivalent: 0,
  },
  rootCause: 'DART_FINANCIALS_MISSING',
  traces: [{
    symbol: '005930',
    corpCodeResolveStatus: 'FOUND',
    corpCode: '00126380',
    fiscalPeriodStatus: 'RESOLVED',
    fiscalPeriod: '2025_ANNUAL',
    corpCodeRequestAttempted: true,
    dartRequestAttempted: true,
    dartHttpStatus: 200,
    dartRawRows: 12,
    normalizedRows: 1,
    derivedMetricsComputed: true,
    kisPerRequestAttempted: false,
    perNormalized: null,
    perSource: 'NONE',
    perReason: 'PER_MISSING',
    epsComputed: null,
    currentPrice: null,
    listedShares: null,
    dartEpsComputed: false,
    perComputedFromPriceAndEps: false,
    perCacheHit: false,
    corpCodeMissingReason: 'NONE',
    instrumentType: 'KOSPI',
    finalConfidence: 'VERIFIED',
    unavailableConditions: ['per'],
    executionImpact: 'NONE',
  }],
  providerHealth: {
    apiKeyPresent: true,
    corpCodeCacheLoaded: true,
    corpCodeCacheCount: 1,
    lastCorpCodeCacheUpdatedAt: '2026-05-24T00:00:00.000Z',
    requestEnabled: true,
    lastHttpStatus: 200,
    lastErrorCode: null,
    rateLimitState: 'OK',
    cacheWritable: true,
    executionImpact: 'NONE',
  },
  strongBuyBlockedReason: 'GATE2_EXTERNAL_PARTIAL',
  strongBuyBlockedDetails: 'PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1',
  blockingDetails: 'PER_UNAVAILABLE_1|TRUE_CORP_CODE_NOT_FOUND_1',
  excludedDetails: 'NONE',
  excludedCount: 0,
  excludedSymbols: [],
  excludedReason: 'NONE',
  unavailableCountRaw: 6,
  unavailableCountActionable: 6,
  unavailableExcludingExcluded: 6,
  excludedUnavailableEquivalent: 0,
  corpCodeMissingSymbols: ['000660'],
  dartNotApplicableSymbols: [],
  trueCorpCodeNotFoundSymbols: ['000660'],
  corpCodeLookupFailedSymbols: [],
  nonEquitySymbols: [],
  executionImpact: 'NONE',
  records: [{
    symbol: '005930',
    unavailableCount: 1,
    financialSnapshot: {
      confidence: 'VERIFIED',
      source: 'DART',
      fiscalPeriod: '2025',
    },
  }],
}));

vi.mock('../../../trading/gate2/gate2ExternalDataProvider.js', () => ({
  refreshGate2ExternalData,
  getGate2DartProviderHealth: () => ({
    apiKeyPresent: true,
    corpCodeCacheLoaded: true,
    corpCodeCacheCount: 1,
    lastCorpCodeCacheUpdatedAt: '2026-05-24T00:00:00.000Z',
    requestEnabled: true,
    lastHttpStatus: 200,
    lastErrorCode: null,
    rateLimitState: 'OK',
    cacheWritable: true,
    executionImpact: 'NONE',
  }),
}));

const refreshDartCorpCodeMasterCache = vi.fn(async () => ({
  corpCodeCacheLoaded: true,
  corpCodeCacheCount: 2,
  listedStockCodeCount: 2,
  loadedAt: '2026-05-24T00:00:00.000Z',
  ttlExpiresAt: '2026-05-27T00:00:00.000Z',
  source: 'DART_CORPCODE_XML',
  ttlHours: 72,
  expired: false,
  sampleMappings: ['005930 -> Samsung Electronics corp_code=00126380'],
  missingSampleSymbols: [],
  lastError: null,
  lastHttpStatus: 200,
  requestUrlHost: 'opendart.fss.or.kr',
  httpStatus: 200,
  contentType: 'application/zip',
  contentLength: 1024,
  firstBytesHex: '50 4b 03 04',
  firstBytesAscii: 'PK..',
  zipOpenStatus: 'OK',
  zipSignature: 'ZIP_FILE',
  zipEntries: ['CORPCODE.xml'],
  selectedXmlEntry: 'CORPCODE.xml',
  responsePreview: null,
  executionImpact: 'NONE',
  downloaded: true,
  parseStatus: 'OK',
  refreshed: true,
  reason: 'OK',
  cacheFile: 'test-cache',
}));

vi.mock('../../../trading/gate2/dartCorpCodeMasterCache.js', () => ({
  getDartCorpCodeCacheStatus: () => ({
    corpCodeCacheLoaded: true,
    corpCodeCacheCount: 2,
    listedStockCodeCount: 2,
    loadedAt: '2026-05-24T00:00:00.000Z',
    ttlExpiresAt: '2026-05-27T00:00:00.000Z',
    source: 'DART_CORPCODE_XML',
    ttlHours: 72,
    expired: false,
    sampleMappings: ['005930 -> Samsung Electronics corp_code=00126380'],
    missingSampleSymbols: [],
    lastError: null,
    lastHttpStatus: 200,
    requestUrlHost: 'opendart.fss.or.kr',
    httpStatus: 200,
    contentType: 'application/zip',
    contentLength: 1024,
    firstBytesHex: '50 4b 03 04',
    firstBytesAscii: 'PK..',
    zipOpenStatus: 'OK',
    zipSignature: 'ZIP_FILE',
    zipEntries: ['CORPCODE.xml'],
    selectedXmlEntry: 'CORPCODE.xml',
    responsePreview: null,
    executionImpact: 'NONE',
  }),
  refreshDartCorpCodeMasterCache,
}));

describe('Gate2 external commands', () => {
  beforeEach(async () => {
    vi.resetModules();
    refreshGate2ExternalData.mockClear();
    refreshDartCorpCodeMasterCache.mockClear();
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers /gate2_external_status as read-only cache diagnostics', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./gate2ExternalStatus.cmd.js');
    const command = registry.commandRegistry.resolve('/gate2_external_status');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate2_status')).toBe(command);
    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');
    expect(text).toContain('[gate2_external_status]');
    expect(text).toContain('cacheRecords=1');
    expect(text).toContain('lastRefreshRootCause=DART_FINANCIALS_MISSING');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('no provider fetch');
  });

  it('registers /gate2_external_refresh and refreshes latest scan symbols in observe mode', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./gate2ExternalRefresh.cmd.js');
    const command = registry.commandRegistry.resolve('/gate2_external_refresh');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate2_refresh')).toBe(command);
    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');
    expect(refreshGate2ExternalData).toHaveBeenCalledWith({ symbols: ['005930', '000660'] });
    expect(text).toContain('mode=OBSERVE');
    expect(text).toContain('strongBuyBlockedReason=GATE2_EXTERNAL_PARTIAL');
    expect(text).toContain('providerRequestsAttempted=2');
    expect(text).toContain('rootCause=DART_FINANCIALS_MISSING');
    expect(text).toContain('refreshTrace:');
    expect(text).toContain('no broker order');
    expect(text).toContain('executionImpact=NONE');
  });

  it('registers /dart_provider_health as read-only provider diagnostics', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./dartProviderHealth.cmd.js');
    const command = registry.commandRegistry.resolve('/dart_provider_health');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/dart_health')).toBe(command);
    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');
    expect(text).toContain('[dart_provider_health]');
    expect(text).toContain('apiKeyPresent=true');
    expect(text).toContain('cacheWritable=true');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('never printed');
  });

  it('registers DART corpCode status and refresh commands', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./dartCorpCode.cmd.js');
    const status = registry.commandRegistry.resolve('/dart_corpcode_status');
    const refresh = registry.commandRegistry.resolve('/dart_corpcode_refresh');
    expect(status).toBeDefined();
    expect(refresh).toBeDefined();
    expect(registry.commandRegistry.resolve('/dart_corp_status')).toBe(status);

    const statusReplies: string[] = [];
    await status!.execute({ args: ['005930'], reply: async message => { statusReplies.push(message); } });
    expect(statusReplies.join('\n')).toContain('corpCodeCacheLoaded=true');
    expect(statusReplies.join('\n')).toContain('sampleMappings=005930');
    expect(statusReplies.join('\n')).toContain('selectedXmlEntry=CORPCODE.xml');
    expect(statusReplies.join('\n')).toContain('zipSignature=ZIP_FILE');

    const refreshReplies: string[] = [];
    await refresh!.execute({ args: [], reply: async message => { refreshReplies.push(message); } });
    const refreshText = refreshReplies.join('\n');
    expect(refreshDartCorpCodeMasterCache).toHaveBeenCalled();
    expect(refreshText).toContain('parseStatus=OK');
    expect(refreshText).toContain('zipOpenStatus=OK');
    expect(refreshText).toContain('no broker order');
    expect(refreshText).toContain('executionImpact=NONE');
  });
});
