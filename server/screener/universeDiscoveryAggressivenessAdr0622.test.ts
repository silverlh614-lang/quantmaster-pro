// @responsibility Verify current leader preservation keeps score ordering without a custom comparator.
import { describe, expect, it } from 'vitest';
import type { CandidateStock } from './pipelineHelpers.js';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import { applyLeaderPreservation } from './leaderUniverseInjectionAdr0617.js';

function candidate(
  code: string,
  stage1Score: number,
  return20d?: number,
  source?: DynamicStock['source'],
): CandidateStock {
  return {
    code,
    name: code,
    symbol: code,
    sector: '반도체',
    stage1Score,
    ...(source !== undefined ? { source } : {}),
    quote: { price: 1000, return20d } as unknown as CandidateStock['quote'],
  };
}

const NOW = new Date('2026-06-16T01:00:00Z'); // KST 2026-06-16 10:00

describe('leader preservation default ordering', () => {
  it('비교자 미주입(현행) === stage1Score desc 단독', () => {
    const cands = [candidate('A', 30, 10), candidate('B', 90, -10), candidate('C', 60, 5)];
    // 비교자 미주입 → 현행 stage1Score desc (RS 무관).
    const { result } = applyLeaderPreservation(cands, 60, NOW, false, undefined);
    expect(result.map((c) => c.code)).toEqual(['B', 'C', 'A']); // 90 > 60 > 30
  });

});
