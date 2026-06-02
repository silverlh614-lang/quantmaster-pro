import { describe, expect, it } from 'vitest';
import { buildGate2OutcomeSeeds, gate2OutcomeDuplicateKey } from './gate2OutcomeSeed.js';
import type { Gate2EvaluationResult } from './gate2ConfluenceScore.js';

function result(partial: Partial<Gate2EvaluationResult>): Gate2EvaluationResult {
  return {
    symbol: '005930',
    gate2Status: 'GATE2_PASS_WEAK',
    coverageAdjustedScore: 70,
    confluenceLevel: 'MODERATE',
    ...partial,
  } as unknown as Gate2EvaluationResult;
}

describe('counterfacture_gate Phase G — gate2OutcomeSeed', () => {
  it('builds seeds with scalar/regime/entryReferencePrice from gate2 results + price map', () => {
    const seeds = buildGate2OutcomeSeeds(
      [
        result({ symbol: 'A', coverageAdjustedScore: 72, gate2Status: 'GATE2_PASS_WEAK' }),
        result({ symbol: 'B', coverageAdjustedScore: 55, gate2Status: 'GATE2_WATCH' }),
      ],
      new Map([['A', 10000], ['B', 20000]]),
      { sourceSnapshotId: 'scan-1', tradeDate: '2026-05-29', asOf: '2026-05-29T07:00:00.000Z', regime: 'R2_BULL' },
    );
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatchObject({
      symbol: 'A',
      gate2CoverageAdjustedScore: 72,
      entryReferencePrice: 10000,
      regime: 'R2_BULL',
      outcomeStatus: 'PENDING',
      executionImpact: 'NONE',
    });
  });

  it('excludes SKIPPED_BY_GATE1 and marks DATA_INSUFFICIENT when no price', () => {
    const seeds = buildGate2OutcomeSeeds(
      [
        result({ symbol: 'A', gate2Status: 'SKIPPED_BY_GATE1' }), // 미평가 → 제외
        result({ symbol: 'B', coverageAdjustedScore: 70 }), // 가격 없음 → DATA_INSUFFICIENT
      ],
      new Map<string, number>(),
      { sourceSnapshotId: 'scan-1', tradeDate: '2026-05-29' },
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0].symbol).toBe('B');
    expect(seeds[0].entryReferencePrice).toBeNull();
    expect(seeds[0].outcomeStatus).toBe('DATA_INSUFFICIENT');
  });

  it('dedup key is symbol|tradeDate|sourceSnapshotId', () => {
    expect(gate2OutcomeDuplicateKey({ symbol: 'A', tradeDate: '2026-05-29', sourceSnapshotId: 'scan-1' })).toBe('A|2026-05-29|scan-1');
  });
});
