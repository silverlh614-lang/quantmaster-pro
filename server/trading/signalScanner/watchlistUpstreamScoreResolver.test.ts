import { describe, expect, it } from 'vitest';
import { resolveWatchlistUpstreamScore } from './watchlistUpstreamScoreResolver.js';

describe('watchlist upstream score resolver', () => {
  it('normalizes gateScore 18 from 0~27 scale', () => {
    const resolved = resolveWatchlistUpstreamScore({ gateScore: 18 });
    expect(resolved.sourceField).toBe('gateScore');
    expect(resolved.normalized100).toBe(66.7);
    expect(resolved.confidence).toBe('VERIFIED');
  });

  it('normalizes GateSnap-like 6.4 from 0~10 scale', () => {
    const resolved = resolveWatchlistUpstreamScore({ stage2Score: 6.4 });
    expect(resolved.sourceField).toBe('stage2Score');
    expect(resolved.normalized100).toBe(64);
  });

  it('normalizes stage2Score 8.5 as 0~10 scale', () => {
    const resolved = resolveWatchlistUpstreamScore({ stage2Score: 8.5 });
    expect(resolved.normalized100).toBe(85);
  });

  it('preserves 0~100 score and caps above 100', () => {
    expect(resolveWatchlistUpstreamScore({ score: 72 }).normalized100).toBe(72);
    expect(resolveWatchlistUpstreamScore({ score: 150 }).normalized100).toBe(100);
  });

  it('returns WATCHLIST_SCORE_MISSING for null, undefined, and NaN', () => {
    expect(resolveWatchlistUpstreamScore({ score: null }).confidence).toBe('MISSING');
    expect(resolveWatchlistUpstreamScore({ score: undefined }).reason).toBe('WATCHLIST_SCORE_MISSING');
    expect(resolveWatchlistUpstreamScore({ score: Number.NaN }).message).toBe('WATCHLIST_SCORE_MISSING');
  });

  it('treats raw zero as a verified explicit score, not missing', () => {
    const resolved = resolveWatchlistUpstreamScore({ gateScore: 0 });
    expect(resolved.confidence).toBe('VERIFIED');
    expect(resolved.normalized100).toBe(0);
  });

  it('uses code-path priority from totalGateScore before lower-priority fields', () => {
    const resolved = resolveWatchlistUpstreamScore({ totalGateScore: 18, score: 72 });
    expect(resolved.sourceField).toBe('totalGateScore');
    expect(resolved.normalized100).toBe(66.7);
  });
});
