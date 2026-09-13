// @responsibility Verify retired market-state APIs cannot restore regime-derived execution permissions even with supplied diagnostics.
import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ load: vi.fn(), diagnostics: vi.fn(), warn: vi.fn() }));
vi.mock('../persistence/macroStateRepo.js', () => ({ loadMacroState: boundary.load }));
vi.mock('./regimeBridge.js', () => ({ getRegimeDiagnostics: boundary.diagnostics }));
vi.mock('../observability/operationalWarn.js', () => ({ emitOperationalWarn: boundary.warn }));

import { resolveMarketState, RegimeResolver } from './marketStateResolver.js';
import { resolveMarketState as resolveBaseMarketState } from './marketStateResolver.base.js';

describe('retired market-state regime policy', () => {
  it.each([resolveMarketState, RegimeResolver.resolveMarketState, resolveBaseMarketState])('rejects without loading or classifying', (resolve) => {
    expect(() => resolve()).toThrowError('REGIME_RETIRED');
    expect(() => resolve(new Date(), { diagnostics: { rawRegime: 'R1_TURBO' } as never })).toThrowError('REGIME_RETIRED');
    for (const dependency of Object.values(boundary)) expect(dependency).not.toHaveBeenCalled();
  });
});
