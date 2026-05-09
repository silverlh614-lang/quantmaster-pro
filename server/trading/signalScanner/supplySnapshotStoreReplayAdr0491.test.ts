// @responsibility ADR-0491 supply snapshot store/replay regression tests; diagnostic-only guardrails.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildSupplyCoverageReplayBaselineAdr0491,
  buildSupplyReadinessReplayEvidenceAdr0491,
  buildSupplySanitizedSnapshotsAdr0491,
  buildSupplySnapshotObservationRowAdr0491,
  collectOperatorActionSourcesFromSupplySnapshotAdr0491,
  compareSupplySnapshotsAdr0491,
  formatRuntimePipelineSupplySnapshotEvidenceLineAdr0491,
  formatSupplySnapshotStoreCompactAdr0491,
  getSupplySnapshotDetailRegistryEntryAdr0491,
  recordSupplySnapshotsAdr0491,
  replaySupplySnapshotsAdr0491,
  type SupplySanitizedSnapshotAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0491-'));
  return path.join(dir, 'supply-snapshots.json');
}

function sample(overrides: Partial<SupplySanitizedSnapshotAdr0491> = {}): SupplySanitizedSnapshotAdr0491 {
  return {
    id: overrides.id ?? `s-${Math.random()}`,
    scanId: overrides.scanId ?? 'scan-1',
    generatedAt: overrides.generatedAt ?? '2026-05-09T01:00:00.000Z',
    tradingDate: overrides.tradingDate ?? '2026-05-09',
    marketSession: overrides.marketSession ?? 'REGULAR',
    domain: overrides.domain ?? 'SUPPLY',
    code: overrides.code ?? null,
    provider: overrides.provider ?? 'NAVER',
    sourceDate: overrides.sourceDate ?? '2026-05-09',
    status: overrides.status ?? 'RECORDED',
    signal: overrides.signal ?? 'UNKNOWN',
    confidence: overrides.confidence ?? 'LOW',
    coverageRatio: overrides.coverageRatio ?? 0.5,
    sourceAgeTradingDays: overrides.sourceAgeTradingDays ?? 0,
    cacheState: overrides.cacheState ?? 'FRESH',
    sourceState: overrides.sourceState ?? 'FRESH',
    summary: overrides.summary ?? { attemptCount: 1 },
    relatedAdrs: overrides.relatedAdrs ?? ['0491'],
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: overrides.policyPromotionMode ?? 'OBSERVE',
    operatorApprovalRequired: true,
    diagnostics: overrides.diagnostics ?? [],
  };
}

function buildReports() {
  return buildSupplySanitizedSnapshotsAdr0491({
    scanId: 'scan-a', generatedAt: '2026-05-09T01:00:00.000Z', tradingDate: '2026-05-09',
    investorFlowSampleAcquisitionAdr0489: { status: 'SAMPLED', selectedProvider: 'NAVER', samples: [{ code: '005930', provider: 'NAVER', status: 'OK', signal: 'UNKNOWN', confidence: 'MEDIUM', coverageRatio: 0.8, rawPayload: { forbidden: true } }] },
    programTradingDataLineAdr0490: { status: 'NORMALIZED', samples: [{ code: '005930', provider: 'KIS', status: 'OK', signal: 'UNKNOWN', confidence: 'LOW', coverageRatio: 0.7, programNetBuy: 100 }] },
    sectorEnergySupplyUnknownAdr0488: { status: 'OBSERVING', provider: 'KRX', coverageRatio: 0.6, topGapCount: 2 },
    supplySourceFreshnessAdr0483: { status: 'STALE', rows: [{ provider: 'FSS', status: 'STALE', sourceAgeTradingDays: 4, cacheState: 'FRESH', sourceState: 'STALE' }] },
    semanticNetBuyNormalizationAdr0482: { status: 'NORMALIZED', normalizedSamples: [{ code: '005930', provider: 'NAVER', signal: 'UNKNOWN', confidence: 'HIGH', coverageRatio: 1 }] },
    freshDataSupplyAdr0487: { overallStatus: 'PARTIAL', policyPromotionMode: 'OBSERVE', snapshots: [{ sourceId: 'NAVER_INVESTOR_TREND', domain: 'SUPPLY', provider: 'NAVER', status: 'PARTIAL', signal: 'UNKNOWN', confidence: 'LOW', coverageRatio: 0.5, sourceAgeTradingDays: 1, cacheState: 'FRESH', sourceState: 'FRESH' }], domainSummaries: [{ domain: 'SUPPLY', status: 'PARTIAL', averageCoverageRatio: 0.5, sourcesTotal: 1, sourcesFresh: 1, sourcesStale: 0, sourcesMissing: 0, topGaps: [] }] },
    operatorActionQueueAdr0480: { status: 'OBSERVING', allActions: [{ status: 'OPEN', priority: 'P2' }] },
    investorFlowProviderRouterAdr0477: { status: 'ROUTED', selectedProvider: 'NAVER', signal: 'UNKNOWN' },
  });
}

describe('ADR-0491 Supply Snapshot Store & Replay', () => {
  it('1. Builds sanitized snapshots from ADR-0489 investor-flow report.', () => expect(buildReports().some((s) => s.domain === 'INVESTOR_FLOW' && s.relatedAdrs.includes('0489'))).toBe(true));
  it('2. Builds sanitized snapshots from ADR-0490 program trading report.', () => expect(buildReports().some((s) => s.domain === 'PROGRAM_TRADING' && s.relatedAdrs.includes('0490'))).toBe(true));
  it('3. Builds sanitized snapshots from ADR-0488 SectorEnergy report.', () => expect(buildReports().some((s) => s.domain === 'SECTOR_ENERGY')).toBe(true));
  it('4. Builds sanitized snapshots from ADR-0483 freshness report.', () => expect(buildReports().some((s) => s.domain === 'FRESHNESS')).toBe(true));
  it('5. Does not include raw provider payload fields.', () => expect(JSON.stringify(buildReports())).not.toMatch(/rawPayload|forbidden/));
  it('6. Snapshot policy fields are executionImpact=NONE and liveExecutionAllowed=false.', () => expect(buildReports().every((s) => s.executionImpact === 'NONE' && s.liveExecutionAllowed === false)).toBe(true));
  it('7. Store records snapshots successfully.', () => { const r = recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }); expect(r.status).toBe('RECORDED'); expect(r.snapshotsRecorded).toBe(1); });
  it('8. Store caps retained snapshots.', () => { const file = tmpFile(); const rows = Array.from({ length: 7 }, (_, i) => sample({ id: `s${i}`, generatedAt: `2026-05-09T01:0${i}:00.000Z` })); const r = recordSupplySnapshotsAdr0491(rows, { storePath: file, maxSnapshots: 3 }); expect(r.retainedSnapshots).toBe(3); });
  it('9. Store recovers from corrupt JSON.', () => { const file = tmpFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{bad'); const r = recordSupplySnapshotsAdr0491([sample()], { storePath: file }); expect(r.status).toBe('CORRUPT_RECOVERED'); });
  it('10. Store write failure is try/catch isolated.', () => { const r = recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile(), forceWriteFailureForTest: true }); expect(r.status).toBe('WRITE_FAILED'); });
  it('11. Replay latest returns latest snapshots.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491([sample({ tradingDate: '2026-05-08' }), sample({ id: 'latest', tradingDate: '2026-05-09', generatedAt: '2026-05-09T02:00:00.000Z' })], { storePath: file }); expect(replaySupplySnapshotsAdr0491({ mode: 'LATEST', storePath: file }).snapshots[0].tradingDate).toBe('2026-05-09'); });
  it('12. Replay previous trading day returns matching snapshots.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491([sample({ tradingDate: '2026-05-08' }), sample({ id: 'latest', tradingDate: '2026-05-09', generatedAt: '2026-05-09T02:00:00.000Z' })], { storePath: file }); expect(replaySupplySnapshotsAdr0491({ mode: 'PREVIOUS_TRADING_DAY', storePath: file }).snapshots[0].tradingDate).toBe('2026-05-08'); });
  it('13. Replay by scanId returns matching snapshots.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491([sample({ scanId: 'scan-x' })], { storePath: file }); expect(replaySupplySnapshotsAdr0491({ mode: 'BY_SCAN_ID', scanId: 'scan-x', storePath: file }).replayedCount).toBe(1); });
  it('14. Replay by date returns matching snapshots.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491([sample({ tradingDate: '2026-05-07' })], { storePath: file }); expect(replaySupplySnapshotsAdr0491({ mode: 'BY_DATE', tradingDate: '2026-05-07', storePath: file }).replayedCount).toBe(1); });
  it('15. Replay window returns capped result.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491([sample({ id: 'a' }), sample({ id: 'b' })], { storePath: file }); expect(replaySupplySnapshotsAdr0491({ mode: 'WINDOW', limit: 1, storePath: file }).replayedCount).toBe(1); });
  it('16. Replay unavailable returns EMPTY safely.', () => expect(replaySupplySnapshotsAdr0491({ mode: 'LATEST', storePath: tmpFile() }).status).toBe('EMPTY'));
  it('17. Comparison computes coverage delta.', () => expect(compareSupplySnapshotsAdr0491(sample({ coverageRatio: 0.4 }), sample({ coverageRatio: 0.7 }))?.coverageDelta).toBeCloseTo(0.3));
  it('18. Comparison detects status change.', () => expect(compareSupplySnapshotsAdr0491(sample({ status: 'STALE' }), sample({ status: 'OK' }))?.statusChanged).toBe(true));
  it('19. Comparison detects signal change.', () => expect(compareSupplySnapshotsAdr0491(sample({ signal: 'UNKNOWN' }), sample({ signal: 'BULLISH' }))?.signalChanged).toBe(true));
  it('20. Comparison computes freshness delta.', () => expect(compareSupplySnapshotsAdr0491(sample({ sourceAgeTradingDays: 1 }), sample({ sourceAgeTradingDays: 4 }))?.freshnessDeltaTradingDays).toBe(3));
  it('21. ADR-0476 records sanitized ADR-0491 observation row.', () => { const row = buildSupplySnapshotObservationRowAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() })); expect(row.observationType).toBe('SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491'); });
  it('22. ADR-0484 can use replay baseline diagnostically.', () => expect(buildSupplyCoverageReplayBaselineAdr0491(replaySupplySnapshotsAdr0491({ mode: 'LATEST', storePath: tmpFile() })).status).toBe('INSUFFICIENT_DATA'));
  it('23. ADR-0485 can use replayed observations as readiness evidence only.', () => expect(buildSupplyReadinessReplayEvidenceAdr0491({ replayedCount: 3 } as any).proposedPromotionMode).toBe('NONE'));
  it('24. ADR-0487 includes snapshot store status.', () => expect(formatSupplySnapshotStoreCompactAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }))).toContain('ADR-0491 SupplySnapshot'));
  it('25. ADR-0480 creates store write/replay unavailable actions.', () => expect(collectOperatorActionSourcesFromSupplySnapshotAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile(), forceWriteFailureForTest: true }))[0].code).toBe('SUPPLY_SNAPSHOT_STORE_WRITE_FAILED'));
  it('26. ADR-0478 compact output includes ADR-0491 line.', () => expect(formatSupplySnapshotStoreCompactAdr0491(null)).toContain('EMPTY'));
  it('27. ADR-0479 detail registry exposes ADR-0491 trace.', () => expect(getSupplySnapshotDetailRegistryEntryAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() })).adrTraceHint).toBe('/adr_trace 0491'));
  it('28. Runtime Pipeline Audit includes ADR-0491 evidence.', () => expect(formatRuntimePipelineSupplySnapshotEvidenceLineAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }))).toContain('diagnosticOnly=true'));
  it('29. No raw provider payload is persisted.', () => { const file = tmpFile(); recordSupplySnapshotsAdr0491(buildReports(), { storePath: file }); expect(fs.readFileSync(file, 'utf-8')).not.toMatch(/rawPayload|token|cookie/); });
  it('30. No KIS order modules are imported.', () => expect(fs.readFileSync(new URL('./supplySnapshotStoreReplayAdr0491.ts', import.meta.url), 'utf-8')).not.toMatch(/orderExecutor|trancheExecutor|kisOrder|placeOrder/));
  it('31. No live execution modules are imported.', () => expect(fs.readFileSync(new URL('./supplySnapshotStoreReplayAdr0491.ts', import.meta.url), 'utf-8')).not.toMatch(/autoTradeEngine|buyPipeline|createLiveOrder/));
  it('32. requiredScore remains 70.', () => expect(buildSupplySnapshotObservationRowAdr0491(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() })).requiredScore).toBe(70));
  it('33. Gate thresholds, weights, Kelly remain unchanged.', () => expect(fs.readFileSync(new URL('./supplySnapshotStoreReplayAdr0491.ts', import.meta.url), 'utf-8')).not.toMatch(/requiredScore\s*=|kelly|gateThreshold|GateWeight/i));
  it('34. UNKNOWN is never converted to bullish.', () => expect(buildReports().filter((s) => s.signal === 'BULLISH').length).toBe(0));
  it('35. Provider issue is never converted to bearish.', () => expect(JSON.stringify(buildReports())).not.toMatch(/providerIssue.*BEARISH/));
  it('36. executionImpact is always NONE.', () => expect(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }).executionImpact).toBe('NONE'));
  it('37. liveExecutionAllowed is always false.', () => expect(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }).liveExecutionAllowed).toBe(false));
  it('38. policyPromotionMode is OBSERVE or SHADOW_ONLY only.', () => expect(['OBSERVE', 'SHADOW_ONLY']).toContain(recordSupplySnapshotsAdr0491([sample({ policyPromotionMode: 'SHADOW_ONLY' })], { storePath: tmpFile() }).policyPromotionMode));
  it('39. operatorApprovalRequired is always true.', () => expect(recordSupplySnapshotsAdr0491([sample()], { storePath: tmpFile() }).operatorApprovalRequired).toBe(true));
  it('40. Replay never feeds live Gate decisions.', () => expect(fs.readFileSync(new URL('./supplySnapshotStoreReplayAdr0491.ts', import.meta.url), 'utf-8')).not.toMatch(/evaluateServerGate|createLiveOrder|executeBuy|placeOrder/i));
});
