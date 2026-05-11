import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSanitizedSupplySnapshotAdr0491,
  compareSupplySnapshotsAdr0491,
  formatSupplySnapshotCompactAdr0491,
  formatSupplySnapshotDetailAdr0491,
  recordSupplySnapshotAdr0491,
  replaySupplySnapshotsAdr0491,
  readLatestSupplySnapshotBySymbolSourceDomainAdr0491,
  findLatestInvestorFlowSnapshotAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491 } from './investorFlowSnapshotKeyNormalizerAdr0491.js';
import { buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import { buildProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';

const tempFiles: string[] = [];
function tempFile(): string {
  const file = path.join(os.tmpdir(), `adr0491-${Date.now()}-${Math.random()}.json`);
  tempFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try { fs.rmSync(file, { force: true }); } catch { /* noop */ }
    for (const candidate of fs.readdirSync(path.dirname(file))) {
      if (candidate.startsWith(path.basename(file) + '.corrupt.')) {
        try { fs.rmSync(path.join(path.dirname(file), candidate), { force: true }); } catch { /* noop */ }
      }
    }
  }
});

describe('ADR-0491 supply snapshot store and replay', () => {
  it('builds sanitized snapshots with guardrails pinned to diagnostic-only', () => {
    const snapshot = buildSanitizedSupplySnapshotAdr0491({
      scanId: 'scan-1',
      recordedAt: '2026-05-09T00:00:00.000Z',
      tradingDate: '2026-05-09',
    });
    expect(snapshot.domains).toEqual(['SUPPLY']);
    expect(snapshot.executionImpact).toBe('NONE');
    expect(snapshot.liveExecutionAllowed).toBe(false);
    expect(snapshot.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(snapshot.operatorApprovalRequired).toBe(true);
    expect(snapshot.rawProviderPayloadPersisted).toBe(false);
    expect(snapshot.marketSignal).toBe(false);
  });

  it('does not advertise absent SECTOR/PROGRAM domains', () => {
    const snapshot = buildSanitizedSupplySnapshotAdr0491({
      scanId: 'scan-supply-only',
      recordedAt: '2026-05-09T00:00:00.000Z',
      tradingDate: '2026-05-09',
    });

    expect(snapshot.domains).toEqual(['SUPPLY']);
    expect(snapshot.domains).not.toContain('SECTOR');
    expect(snapshot.domains).not.toContain('PROGRAM');
    expect(snapshot.executionImpact).toBe('NONE');
    expect(snapshot.liveExecutionAllowed).toBe(false);
    expect(snapshot.rawProviderPayloadPersisted).toBe(false);
    expect(snapshot.marketSignal).toBe(false);
  });

  it('includes SECTOR only when sectorEnergySupplyUnknownAdr0488 exists', () => {
    const sectorReport = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: '2026-05-09T00:00:00.000Z',
      sectorMasterRecords: [],
    });

    const snapshot = buildSanitizedSupplySnapshotAdr0491({
      scanId: 'scan-sector',
      recordedAt: '2026-05-09T00:00:00.000Z',
      tradingDate: '2026-05-09',
      sectorEnergySupplyUnknownAdr0488: sectorReport,
    });

    expect(snapshot.domains).toEqual(['SUPPLY', 'SECTOR']);
    expect(snapshot.domains).toContain('SECTOR');
    expect(snapshot.domains).not.toContain('PROGRAM');
  });

  it('includes PROGRAM only when programTradingAdr0490 exists', () => {
    const programReport = buildProgramTradingDataLineReportAdr0490({
      generatedAt: '2026-05-09T00:00:00.000Z',
      rows: [],
    });

    const snapshot = buildSanitizedSupplySnapshotAdr0491({
      scanId: 'scan-program',
      recordedAt: '2026-05-09T00:00:00.000Z',
      tradingDate: '2026-05-09',
      programTradingAdr0490: programReport,
    });

    expect(snapshot.domains).toEqual(['SUPPLY', 'PROGRAM']);
    expect(snapshot.domains).not.toContain('SECTOR');
    expect(snapshot.domains).toContain('PROGRAM');
  });

  it('includes SECTOR and PROGRAM when both input reports exist', () => {
    const sectorReport = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: '2026-05-09T00:00:00.000Z',
      sectorMasterRecords: [],
    });
    const programReport = buildProgramTradingDataLineReportAdr0490({
      generatedAt: '2026-05-09T00:00:00.000Z',
      rows: [],
    });

    const snapshot = buildSanitizedSupplySnapshotAdr0491({
      scanId: 'scan-both',
      recordedAt: '2026-05-09T00:00:00.000Z',
      tradingDate: '2026-05-09',
      sectorEnergySupplyUnknownAdr0488: sectorReport,
      programTradingAdr0490: programReport,
    });

    expect(snapshot.domains).toEqual(['SUPPLY', 'SECTOR', 'PROGRAM']);
  });

  it('records bounded JSON snapshots and supports all replay modes', () => {
    const filePath = tempFile();
    recordSupplySnapshotAdr0491({ filePath, maxSnapshots: 2, scanId: 'scan-1', recordedAt: '2026-05-07T00:00:00.000Z', tradingDate: '2026-05-07' });
    recordSupplySnapshotAdr0491({ filePath, maxSnapshots: 2, scanId: 'scan-2', recordedAt: '2026-05-08T00:00:00.000Z', tradingDate: '2026-05-08' });
    const latestRecord = recordSupplySnapshotAdr0491({ filePath, maxSnapshots: 2, scanId: 'scan-3', recordedAt: '2026-05-09T00:00:00.000Z', tradingDate: '2026-05-09' });
    expect(latestRecord.retained).toBe(2);
    expect(replaySupplySnapshotsAdr0491({ filePath, mode: 'LATEST' }).snapshots[0]?.scanId).toBe('scan-3');
    expect(replaySupplySnapshotsAdr0491({ filePath, mode: 'PREVIOUS_TRADING_DAY', tradingDate: '2026-05-09' }).snapshots[0]?.scanId).toBe('scan-2');
    expect(replaySupplySnapshotsAdr0491({ filePath, mode: 'BY_SCAN_ID', scanId: 'scan-2' }).snapshots).toHaveLength(1);
    expect(replaySupplySnapshotsAdr0491({ filePath, mode: 'BY_DATE', tradingDate: '2026-05-09' }).snapshots[0]?.scanId).toBe('scan-3');
    expect(replaySupplySnapshotsAdr0491({ filePath, mode: 'WINDOW', fromDate: '2026-05-08', toDate: '2026-05-09' }).snapshots).toHaveLength(2);
  });



  it('looks up retained sanitized supply snapshots by symbol/source/domain and distinguishes stale hits from cache empty', () => {
    const filePath = tempFile();
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: '2026-05-08T00:00:00.000Z',
      samples: [{ symbol: '005930', provider: 'NAVER', sourceDate: '2026-05-08', foreignNetBuy: 100, institutionNetBuy: 50, status: 'SAMPLE_READY' }],
    });
    recordSupplySnapshotAdr0491({
      filePath,
      scanId: 'scan-supply-sample',
      recordedAt: '2026-05-08T00:00:00.000Z',
      tradingDate: '2026-05-08',
      investorFlowSampleAdr0489: report,
    });

    const staleHit = readLatestSupplySnapshotBySymbolSourceDomainAdr0491({
      filePath,
      symbol: '005930',
      source: 'NAVER',
      domain: 'SUPPLY',
      tradingDate: '2026-05-11',
    });
    expect(staleHit.status).toBe('CACHE_STALE_HIT');
    expect(staleHit.cacheRaw?.foreignNetBuy).toBe(100);
    expect(staleHit.liveExecutionAllowed).toBe(false);
    expect(staleHit.rawPayloadPersistenceAllowed).toBe(false);

    const miss = readLatestSupplySnapshotBySymbolSourceDomainAdr0491({
      filePath,
      symbol: '000660',
      source: 'NAVER',
      domain: 'SUPPLY',
      tradingDate: '2026-05-11',
    });
    expect(miss.status).toBe('CACHE_KEY_MISMATCH');
    expect(miss.reason).toBe('KEY_MISMATCH_OR_SYMBOL_SOURCE_DATE_DOMAIN_NOT_FOUND');
  });

  it('recovers corrupt JSON without throwing and exposes compact/detail formatters', () => {
    const filePath = tempFile();
    fs.writeFileSync(filePath, '{not-json');
    const result = replaySupplySnapshotsAdr0491({ filePath, mode: 'LATEST' });
    expect(result.status).toBe('CORRUPT_RECOVERED');
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(formatSupplySnapshotCompactAdr0491(result)).toContain('EMPTY');
    expect(formatSupplySnapshotDetailAdr0491(result)).toContain('diagnosticOnly=true executionImpact=NONE');
  });

  it('compares snapshots without feeding replay into live Gate decisions', () => {
    const baseline = buildSanitizedSupplySnapshotAdr0491({ scanId: 'a' });
    const candidate = { ...baseline, scanId: 'b', supplyStatus: 'PROVIDER_ERROR' };
    const comparison = compareSupplySnapshotsAdr0491(baseline, candidate);
    expect(comparison.changedDomains).toEqual(['SUPPLY']);
    expect(comparison.diagnosticOnly).toBe(true);
    expect(comparison.executionImpact).toBe('NONE');
    expect(comparison.liveExecutionAllowed).toBe(false);
  });
  it('normalizes InvestorFlow snapshot lookup keys across code/source/route/domain aliases', () => {
    const naver = normalizeInvestorFlowSnapshotKeyAdr0491({ symbol: '012200.KS', source: 'NAVER', route: 'investor_flow', tradingDate: '2026-05-11', now: new Date('2026-05-11T00:00:00.000Z') });
    const semantic = normalizeInvestorFlowSnapshotKeyAdr0491({ code: '012200', provider: 'Semantic NetBuy', domain: 'SUPPLY', tradingDate: '2026-05-11', now: new Date('2026-05-11T00:00:00.000Z') });

    expect(naver.normalizedCode).toBe('012200');
    expect(naver.normalizedSource).toBe('NAVER_INVESTOR_TREND');
    expect(semantic.normalizedSource).toBe('SEMANTIC_NETBUY');
    expect(naver.normalizedDomain).toBe('SUPPLY');
    expect(naver.route).toBe('investor_flow');
    expect(naver.tradingDateCandidates).toContain('2026-05-08');
  });

  it('finds latest investor flow snapshots and distinguishes hit, stale, mismatch, and empty', () => {
    const filePath = tempFile();
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: '2026-05-08T00:00:00.000Z',
      samples: [{ symbol: '012200.KS', provider: 'NAVER', sourceDate: '2026-05-08', foreignNetBuy: 100, institutionNetBuy: 50, status: 'SAMPLE_READY' }],
    });
    recordSupplySnapshotAdr0491({ filePath, scanId: 'scan-key', recordedAt: '2026-05-08T00:00:00.000Z', tradingDate: '2026-05-08', investorFlowSampleAdr0489: report });

    expect(findLatestInvestorFlowSnapshotAdr0491({ filePath, code: '012200', sourceCandidates: ['NAVER_INVESTOR_TREND'], tradingDateCandidates: ['2026-05-08'], requireNormalized: true }).status).toBe('CACHE_HIT');
    expect(findLatestInvestorFlowSnapshotAdr0491({ filePath, code: '012200', sourceCandidates: ['NAVER_INVESTOR_TREND'], tradingDateCandidates: ['2026-05-11'], allowStale: true, requireNormalized: true }).status).toBe('CACHE_STALE_HIT');
    const mismatch = findLatestInvestorFlowSnapshotAdr0491({ filePath, code: '012200', sourceCandidates: ['SEMANTIC_NETBUY'], tradingDateCandidates: ['2026-05-08'], requireNormalized: true });
    expect(mismatch.status).toBe('CACHE_KEY_MISMATCH');
    expect(mismatch.debug?.mismatchHints.join(' ')).toContain('source=NAVER_INVESTOR_TREND');
    expect(findLatestInvestorFlowSnapshotAdr0491({ filePath: tempFile(), code: '012200', sourceCandidates: ['NAVER_INVESTOR_TREND'], tradingDateCandidates: ['2026-05-08'] }).status).toBe('CACHE_EMPTY');
  });

});
