// @responsibility regimeBridge passiveActiveBoth null → false 변환 회귀 가드 — ADR-0136
//
// MacroState.passiveActiveBoth: boolean | null (격상)
// RegimeVariables.passiveActiveBoth: boolean (클라이언트 공유 타입, 시그니처 보존)
// → buildRegimeVars 가 `?? false` 패턴으로 null 자동 흡수.
//
// regimeEngine.ts:207 `!v.passiveActiveBoth` / :219 `v.passiveActiveBoth` 본체 0줄 변경 보장.
import { describe, expect, it } from 'vitest';
import { buildRegimeVars } from './regimeBridge.js';
import type { MacroState } from '../persistence/macroStateRepo.js';

const baseState: MacroState = {
  mhs: 60,
  regime: 'GREEN',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('regimeBridge.buildRegimeVars passiveActiveBoth (ADR-0136)', () => {
  it('passiveActiveBoth=true → RegimeVariables.passiveActiveBoth=true 그대로', () => {
    const vars = buildRegimeVars({ ...baseState, passiveActiveBoth: true });
    expect(vars.passiveActiveBoth).toBe(true);
  });

  it('passiveActiveBoth=false → false 그대로', () => {
    const vars = buildRegimeVars({ ...baseState, passiveActiveBoth: false });
    expect(vars.passiveActiveBoth).toBe(false);
  });

  it('passiveActiveBoth=null → false 자동 fallback (?? 패턴)', () => {
    const vars = buildRegimeVars({ ...baseState, passiveActiveBoth: null });
    expect(vars.passiveActiveBoth).toBe(false);
  });

  it('passiveActiveBoth=undefined → false fallback (기존 동작 보존)', () => {
    const vars = buildRegimeVars({ ...baseState });
    expect(vars.passiveActiveBoth).toBe(false);
  });

  it('RegimeVariables.passiveActiveBoth 시그니처 = boolean (null/undefined 누출 안 됨)', () => {
    // null/undefined 모두 false 로 좁혀지는지 typeof 검증
    const fromNull = buildRegimeVars({ ...baseState, passiveActiveBoth: null });
    expect(typeof fromNull.passiveActiveBoth).toBe('boolean');

    const fromUndef = buildRegimeVars({ ...baseState });
    expect(typeof fromUndef.passiveActiveBoth).toBe('boolean');
  });
});
