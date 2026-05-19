import { describe, expect, it } from 'vitest';
import { isEngineBlockQueryException, resolvePositionSource } from './positionSourceResolver.js';

describe('positionSourceResolver', () => {
  it('engineMode=SHADOW_ONLY live=0 shadow=2 -> SHADOW registry selected', () => {
    const r = resolvePositionSource({ engineMode: 'SHADOW_ONLY', liveCount: 0, shadowCount: 2, paperCount: 0, virtualCount: 0 });
    expect(r.mode).toBe('SHADOW_FIRST');
    expect(r.selectedSource).toBe('SHADOW_POSITION_REGISTRY');
  });

  it('R6_DEFENSE query should be allowed as query exception', () => {
    expect(isEngineBlockQueryException('R6_DEFENSE')).toBe(true);
  });

  it('fallbacks to virtual when shadow registry and paper are empty', () => {
    const r = resolvePositionSource({ engineMode: 'SHADOW_ONLY', liveCount: 0, shadowCount: 0, paperCount: 0, virtualCount: 3 });
    expect(r.selectedSource).toBe('VIRTUAL_ACCOUNT');
  });

  it('returns NONE when every source is empty', () => {
    const r = resolvePositionSource({ engineMode: 'SHADOW_ONLY', liveCount: 0, shadowCount: 0, paperCount: 0, virtualCount: 0 });
    expect(r.selectedSource).toBe('NONE');
  });
});
