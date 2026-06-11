// @responsibility outcome ledger 성숙 우선 eviction 회귀 — PENDING 보존·캡 절대 준수·강등 경로.
import { describe, expect, it } from 'vitest';
import { evictOutcomeSeedsWithMaturityPriority } from './outcomeLedgerEviction.js';

function seed(id: number, outcomeStatus: string) {
  return { id, outcomeStatus };
}

describe('evictOutcomeSeedsWithMaturityPriority', () => {
  it('캡 이내면 무변경', () => {
    const seeds = [seed(1, 'PENDING'), seed(2, 'LABELED')];
    expect(evictOutcomeSeedsWithMaturityPriority(seeds, 5)).toEqual(seeds);
  });

  it('초과분은 성숙 종료(LABELED/EXPIRED/DATA_INSUFFICIENT) 행을 오래된 순으로 먼저 제거 — PENDING/PARTIAL 보존', () => {
    const seeds = [
      seed(1, 'LABELED'), seed(2, 'PENDING'), seed(3, 'EXPIRED'),
      seed(4, 'PARTIAL'), seed(5, 'DATA_INSUFFICIENT'), seed(6, 'PENDING'),
    ];
    const kept = evictOutcomeSeedsWithMaturityPriority(seeds, 3);
    expect(kept.map((s) => s.id)).toEqual([2, 4, 6]);
  });

  it('성숙 행만으로 부족하면 최고령 행 강등 제거 — 캡 절대 초과 금지', () => {
    const seeds = [seed(1, 'PENDING'), seed(2, 'PENDING'), seed(3, 'LABELED'), seed(4, 'PENDING')];
    const kept = evictOutcomeSeedsWithMaturityPriority(seeds, 2);
    expect(kept).toHaveLength(2);
    expect(kept.map((s) => s.id)).toEqual([2, 4]);
  });
});
