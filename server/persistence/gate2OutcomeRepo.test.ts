import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadGate2OutcomeSeeds,
  updateGate2OutcomeForwardReturns,
  upsertGate2OutcomeSeeds,
} from './gate2OutcomeRepo.js';
import type { Gate2OutcomeSeed } from '../quant/gate2OutcomeSeed.js';

const TMP = join(tmpdir(), `gate2-outcome-repo-test-${process.pid}.json`);

function seed(partial: Partial<Gate2OutcomeSeed>): Gate2OutcomeSeed {
  return {
    id: 'gate2-outcome:2026-05-29:A:scan-1',
    symbol: 'A',
    sourceSnapshotId: 'scan-1',
    tradeDate: '2026-05-29',
    asOf: '2026-05-29T07:00:00.000Z',
    gate2Status: 'GATE2_PASS_WEAK',
    gate2CoverageAdjustedScore: 72,
    gate2ConfluenceLevel: 'MODERATE',
    entryReferencePrice: 10000,
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    outcomeStatus: 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    ...partial,
  } as Gate2OutcomeSeed;
}

describe('counterfacture_gate Phase G — gate2OutcomeRepo', () => {
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP);
  });

  it('upsert appends new seeds and dedups (preserves existing matured)', () => {
    upsertGate2OutcomeSeeds([seed({ symbol: 'A' })], TMP);
    const result = upsertGate2OutcomeSeeds([seed({ symbol: 'A', gate2CoverageAdjustedScore: 99 })], TMP);
    expect(result.created).toBe(0);
    expect(result.duplicateSuppressed).toBe(1);
    const loaded = loadGate2OutcomeSeeds(TMP);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].gate2CoverageAdjustedScore).toBe(72); // 기존 보존(성숙 데이터 덮어쓰기 방지)
  });

  it('matures forward returns for seeds with entryReferencePrice; skips priceless', async () => {
    const seeds = [
      seed({ symbol: 'A', entryReferencePrice: 10000, tradeDate: '2026-05-01' }),
      seed({ symbol: 'B', entryReferencePrice: null, outcomeStatus: 'DATA_INSUFFICIENT', tradeDate: '2026-05-01' }),
    ];
    const res = await updateGate2OutcomeForwardReturns({
      now: new Date('2026-06-01T07:00:00.000Z'),
      seeds, // 주입 → 디스크 I/O 없음
      priceFetcher: () => 10500, // +5%
    });
    expect(res.updated).toBeGreaterThan(0);
    expect(seeds[0].forwardReturns.d5).toBe(5);
    expect(seeds[0].outcomeStatus).toBe('LABELED');
    expect(seeds[1].forwardReturns.d5).toBeNull(); // entryReferencePrice 없음 → skip
  });

  it('NOT_MATURED when no horizon due yet', async () => {
    const res = await updateGate2OutcomeForwardReturns({
      now: new Date('2026-05-01T07:00:00.000Z'),
      seeds: [seed({ tradeDate: '2026-05-01', entryReferencePrice: 10000 })],
      priceFetcher: () => 10500,
    });
    expect(res.reason).toBe('NOT_MATURED');
    expect(res.updated).toBe(0);
  });
});
