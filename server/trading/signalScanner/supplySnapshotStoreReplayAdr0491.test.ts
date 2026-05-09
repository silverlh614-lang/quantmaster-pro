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
} from './supplySnapshotStoreReplayAdr0491.js';

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
    expect(snapshot.domains).toEqual(['SUPPLY', 'SECTOR', 'PROGRAM']);
    expect(snapshot.executionImpact).toBe('NONE');
    expect(snapshot.liveExecutionAllowed).toBe(false);
    expect(snapshot.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(snapshot.operatorApprovalRequired).toBe(true);
    expect(snapshot.rawProviderPayloadPersisted).toBe(false);
    expect(snapshot.marketSignal).toBe(false);
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
});
