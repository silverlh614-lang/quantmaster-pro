import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetIntradayProgramFlowSnapshotRepoForTests,
  buildIntradayProgramFlowSnapshotFromRuntimeContext,
  captureLatestIntradayProgramFlowSnapshotFromRuntimeContext,
  hasLatestIntradayProgramFlowSnapshot,
  loadLatestIntradayProgramFlowSnapshot,
  saveLatestIntradayProgramFlowSnapshot,
} from './intradayProgramFlowSnapshotRepo.js';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-program-flow-'));
const NOW = new Date('2026-05-15T06:00:00.000Z');

describe('intradayProgramFlowSnapshotRepo', () => {
  beforeEach(() => {
    process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE = path.join(
      testDir,
      `latest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    __resetIntradayProgramFlowSnapshotRepoForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetIntradayProgramFlowSnapshotRepoForTests();
    delete process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE;
  });

  it('builds a sanitized diagnostic-only snapshot from runtime stock and market program values', () => {
    const snapshot = buildIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{
        stockCode: '005930',
        name: 'Samsung',
        programNetBuyAmount: '1,234',
        source: 'KIS_API',
        token: 'secret-token',
      }],
      marketProgram: {
        combinedProgramNetBuy: 10000,
        sourceProvider: 'KIS_API',
        authorization: 'Bearer secret',
      },
    }, NOW);

    expect(snapshot.snapshotKind).toBe('INTRADAY_PROGRAM_FLOW_SNAPSHOT');
    expect(snapshot.replayOnly).toBe(true);
    expect(snapshot.diagnosticOnly).toBe(true);
    expect(snapshot.executionImpact).toBe('NONE');
    expect(snapshot.stockRows[0]?.symbol).toBe('005930');
    expect(snapshot.stockRows[0]?.programNetBuyAmount).toBe(1234);
    expect(snapshot.marketProgram.available).toBe(true);
    expect(snapshot.marketProgram.combinedProgramNetBuy).toBe(10000);
    expect(snapshot.summary.providerCallsAdded).toBe(0);
    expect(snapshot.sanitize.rawPayloadStored).toBe(false);
    expect(snapshot.sanitize.removedSensitiveFields).toEqual(['authorization', 'token']);
  });

  it('saves and loads the latest snapshot with atomic overwrite semantics', () => {
    const saved = saveLatestIntradayProgramFlowSnapshot(
      buildIntradayProgramFlowSnapshotFromRuntimeContext({
        stockRows: [{ symbol: '005930', programNetBuyAmount: 500, sourceProvider: 'KIS_API' }],
      }, NOW),
    );

    expect(hasLatestIntradayProgramFlowSnapshot()).toBe(true);
    const loaded = loadLatestIntradayProgramFlowSnapshot();
    expect(loaded?.snapshotId).toBe(saved.snapshotId);
    expect(loaded?.summary.stockRowsWithProgramValue).toBe(1);
    expect(loaded?.summary.marketProgramAvailable).toBe(false);
  });

  it('skips capture when runtime context has no program values', () => {
    const result = captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{ symbol: '005930', programNetBuyAmount: null }],
      marketProgram: { marketProgramNetBuy: null },
    }, NOW);

    expect(result.status).toBe('SKIPPED');
    expect(result.reason).toBe('NO_PROGRAM_FLOW_VALUES_IN_RUNTIME_CONTEXT');
    expect(hasLatestIntradayProgramFlowSnapshot()).toBe(false);
  });

  it('merges later stock captures with an existing market snapshot', () => {
    const marketCapture = captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({
      marketProgram: { combinedProgramNetBuy: 10000, sourceProvider: 'KIS_API' },
    }, NOW);
    expect(marketCapture.status).toBe('CAPTURED');

    const stockCapture = captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{ symbol: '005930', programNetBuyAmount: 777, sourceProvider: 'KIS_API' }],
    }, new Date('2026-05-15T06:01:00.000Z'));

    expect(stockCapture.status).toBe('CAPTURED');
    const loaded = loadLatestIntradayProgramFlowSnapshot();
    expect(loaded?.summary.stockRowsWithProgramValue).toBe(1);
    expect(loaded?.summary.marketProgramAvailable).toBe(true);
    expect(loaded?.marketProgram.combinedProgramNetBuy).toBe(10000);
  });

  it('preserves the previous snapshot when atomic rename fails', () => {
    saveLatestIntradayProgramFlowSnapshot(
      buildIntradayProgramFlowSnapshotFromRuntimeContext({
        stockRows: [{ symbol: '005930', programNetBuyAmount: 111, sourceProvider: 'KIS_API' }],
      }, NOW),
    );
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    const result = captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({
      stockRows: [{ symbol: '000660', programNetBuyAmount: 222, sourceProvider: 'KIS_API' }],
    }, new Date('2026-05-15T06:02:00.000Z'));

    expect(result.status).toBe('FAILED');
    expect(result.previousSnapshotPreserved).toBe(true);
    const loaded = loadLatestIntradayProgramFlowSnapshot();
    expect(loaded?.stockRows.some((row) => row.symbol === '005930')).toBe(true);
    expect(loaded?.stockRows.some((row) => row.symbol === '000660')).toBe(false);
  });
});
