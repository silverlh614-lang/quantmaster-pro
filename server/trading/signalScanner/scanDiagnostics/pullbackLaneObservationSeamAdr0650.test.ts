/**
 * @responsibility ADR-0650 §D1 persist seam 회귀 — flag OFF=row 0 byte-equivalent / flag ON=row 생성 / entryLane carry.
 *
 * 본 테스트는 persistScanResultsMidBlocks W5 블록의 seam 계약(flag 게이트 + buildObservationRowFromStamp +
 * upsertObservation per-candidate 루프)을 동일 형태로 재현해 검증한다. stamp *집계*(force-ON)는 본 seam 무관.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pullback-seam-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let repo: typeof import('../../../persistence/pullbackLaneObservationRepo.js');
let gateConfig: typeof import('../../gateConfig.js');
let stampMod: typeof import('../../../quant/conditions/pullbackLaneShadowObservationAdr0648.js');

const ORIGINAL_FLAG = process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;

beforeEach(async () => {
  vi.resetModules();
  delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;
  repo = await import('../../../persistence/pullbackLaneObservationRepo.js');
  gateConfig = await import('../../gateConfig.js');
  stampMod = await import('../../../quant/conditions/pullbackLaneShadowObservationAdr0648.js');
  repo.__resetPullbackLaneObservationLedgerForTests();
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;
  else process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = ORIGINAL_FLAG;
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
});

/** seam 의 per-candidate 루프 재현 (persistScanResultsMidBlocks W5 블록 계약 동형). */
function runSeam(snapshots: Array<Record<string, unknown>>, scanId: string, asOf: string): void {
  const stamps = snapshots.map((snap) => stampMod.buildPullbackLaneShadowStamp({
    price: snap.price as number | undefined,
    high5d: snap.high5d as number | undefined,
    high20d: snap.high20d as number | undefined,
    ma20: snap.ma20 as number | undefined,
    volume: snap.volume as number | undefined,
    avgVolume: snap.avgVolume as number | undefined,
  }));
  if (!gateConfig.isPullbackLaneForwardObservationEnabled()) return; // flag OFF → append 0
  for (let i = 0; i < snapshots.length; i += 1) {
    const snap = snapshots[i];
    const stamp = stamps[i];
    const symbol = snap.symbol as string | undefined;
    if (!snap || !stamp || !symbol) continue;
    const entryLane = snap.entryLane === 'PULLBACK' ? 'PULLBACK' as const : undefined;
    const rawRrr = (snap.entryRrr ?? snap.rrr) as unknown;
    const entryRrr = typeof rawRrr === 'number' && Number.isFinite(rawRrr) ? rawRrr : undefined;
    repo.upsertObservation(repo.buildObservationRowFromStamp(stamp, { scanId, symbol, asOf, entryLane, entryRrr }));
  }
}

const SNAP_PULLBACK = {
  symbol: '005930', price: 95, high5d: 100, high20d: 100, ma20: 90, volume: 70, avgVolume: 100,
};

describe('ADR-0650 §D1 persist seam', () => {
  it('flag OFF (미설정) → 관측 row 0 (byte-equivalent)', () => {
    runSeam([SNAP_PULLBACK], 'SCAN-OFF', '2026-06-23T00:00:00.000Z');
    expect(repo.loadObservations()).toHaveLength(0);
  });

  it("flag = 임의값('1')도 OFF → row 0", () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = '1';
    runSeam([SNAP_PULLBACK], 'SCAN-X', '2026-06-23T00:00:00.000Z');
    expect(repo.loadObservations()).toHaveLength(0);
  });

  it('flag ON → per-candidate row 생성 + stamp 필드 carry', () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = 'true';
    runSeam([SNAP_PULLBACK], 'SCAN-ON', '2026-06-23T00:00:00.000Z');
    const rows = repo.loadObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].scanId).toBe('SCAN-ON');
    expect(rows[0].symbol).toBe('005930');
    expect(rows[0].maturity).toBe('PENDING');
    expect(rows[0].observationOnly).toBe(true);
    expect(rows[0].pullbackLaneHypotheticalFired).toBe(true); // 0.92≤0.95≤0.99·aboveMA20·0.5≤0.7≤0.9
  });

  it('flag ON → entryLane=PULLBACK + entryRrr carry', () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = 'true';
    runSeam([{ ...SNAP_PULLBACK, entryLane: 'PULLBACK', entryRrr: 2.3 }], 'SCAN-CARRY', '2026-06-23T00:00:00.000Z');
    const row = repo.loadObservations()[0];
    expect(row.entryLane).toBe('PULLBACK');
    expect(row.entryRrr).toBe(2.3);
  });

  it('flag ON → entryLane/rrr 부재 시 undefined carry (계약 정합)', () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = 'true';
    runSeam([SNAP_PULLBACK], 'SCAN-NOLANE', '2026-06-23T00:00:00.000Z');
    const row = repo.loadObservations()[0];
    expect(row.entryLane).toBeUndefined();
    expect(row.entryRrr).toBeUndefined();
  });

  it('flag ON → 동일 scanId:symbol 재실행 멱등 (row 1건 유지)', () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = 'true';
    runSeam([SNAP_PULLBACK], 'SCAN-IDEM', '2026-06-23T00:00:00.000Z');
    runSeam([SNAP_PULLBACK], 'SCAN-IDEM', '2026-06-23T00:00:00.000Z');
    expect(repo.loadObservations()).toHaveLength(1);
  });
});
