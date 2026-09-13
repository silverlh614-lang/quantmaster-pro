// @responsibility Verify retired regime access cannot reactivate via old environment switches or macro values.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import { RetiredRegimeError, resolveCanonicalRegimeLevel, isCanonicalR6Defense } from './canonicalRegimeAccess.js';
import { resolveRegimeSnapshot } from './regimeResolver.js';

const boundary = vi.hoisted(() => ({ load: vi.fn(), warn: vi.fn() }));
vi.mock('../../persistence/macroStateRepo.js', () => ({ loadMacroState: boundary.load }));
vi.mock('../../observability/operationalWarn.js', () => ({ emitOperationalWarn: boundary.warn }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('retired canonical regime API', () => {
  it.each([undefined, 'true', 'false', '1'])('old kill switch %s cannot restore either regime engine', (value) => {
    vi.stubEnv('GATE0_CANONICAL_REGIME_DISABLED', value);
    for (const macro of [null, { regime: 'R6_DEFENSE', mhs: 0 }, { regime: 'GREEN', mhs: 100 }]) {
      expect(() => resolveCanonicalRegimeLevel(macro as MacroState | null)).toThrowError(RetiredRegimeError);
      expect(() => isCanonicalR6Defense(macro as MacroState | null)).toThrowError(RetiredRegimeError);
      expect(() => resolveRegimeSnapshot({ macroState: macro as MacroState | null })).toThrowError('REGIME_RETIRED');
    }
    expect(boundary.load).not.toHaveBeenCalled();
    expect(boundary.warn).not.toHaveBeenCalled();
  });

  it('rejects the no-argument snapshot API without reading persisted state or emitting regime warnings', () => {
    expect(() => resolveRegimeSnapshot()).toThrowError(expect.objectContaining({ code: 'REGIME_RETIRED' }));
    expect(boundary.load).not.toHaveBeenCalled();
    expect(boundary.warn).not.toHaveBeenCalled();
  });
});
