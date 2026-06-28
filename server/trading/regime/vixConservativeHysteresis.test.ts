// @responsibility vixConservativeHysteresis — VIX 보수모드 Schmitt trigger 회귀(진입/해제/밴드/null·ENV)
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveVixConservativeTransition,
  resolveVixConservativeThresholds,
  type VixConservativeThresholds,
} from './vixConservativeHysteresis.js';

const T: VixConservativeThresholds = { on: 3, off: 1.5 };

describe('resolveVixConservativeTransition — 히스테리시스 전이', () => {
  it('비보수 + pct≥on → ENTER', () => {
    expect(resolveVixConservativeTransition(3.5, false, T)).toBe('ENTER');
    expect(resolveVixConservativeTransition(3.0, false, T)).toBe('ENTER'); // 경계 ≥
  });

  it('비보수 + pct<on → HOLD (진입 안 함)', () => {
    expect(resolveVixConservativeTransition(2.9, false, T)).toBe('HOLD');
  });

  it('보수 + pct<off → EXIT', () => {
    expect(resolveVixConservativeTransition(1.0, true, T)).toBe('EXIT');
  });

  it('보수 + 밴드[off,on) → HOLD (해제 안 함 = flapping 억제)', () => {
    expect(resolveVixConservativeTransition(2.0, true, T)).toBe('HOLD');
    expect(resolveVixConservativeTransition(1.5, true, T)).toBe('HOLD'); // off 경계 strict <
    expect(resolveVixConservativeTransition(2.9, true, T)).toBe('HOLD');
  });

  it('보수 + pct≥on → HOLD (이미 보수, 유지)', () => {
    expect(resolveVixConservativeTransition(3.5, true, T)).toBe('HOLD');
  });

  it('데이터 부재(null) → HOLD (불변식 #6: provider issue ≠ market signal)', () => {
    expect(resolveVixConservativeTransition(null, true, T)).toBe('HOLD');  // 레거시는 EXIT 였음
    expect(resolveVixConservativeTransition(null, false, T)).toBe('HOLD');
    expect(resolveVixConservativeTransition(Number.NaN, true, T)).toBe('HOLD');
  });

  it('+3% 경계 출렁임은 토글되지 않는다 (2.9↔3.1)', () => {
    // 진입(3.1) 후 2.9 로 내려와도 밴드 안이라 해제 안 됨 → 알림 0건
    expect(resolveVixConservativeTransition(3.1, false, T)).toBe('ENTER');
    expect(resolveVixConservativeTransition(2.9, true, T)).toBe('HOLD');
    expect(resolveVixConservativeTransition(3.1, true, T)).toBe('HOLD');
  });
});

describe('resolveVixConservativeThresholds — ENV 해석', () => {
  const origOn = process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT;
  const origOff = process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT;
  afterEach(() => {
    if (origOn === undefined) delete process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT;
    else process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT = origOn;
    if (origOff === undefined) delete process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT;
    else process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT = origOff;
  });

  it('미설정 → {on:3, off:1.5}', () => {
    delete process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT;
    delete process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT;
    expect(resolveVixConservativeThresholds()).toEqual({ on: 3, off: 1.5 });
  });

  it('커스텀 on=4, off=2', () => {
    process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT = '4';
    process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT = '2';
    expect(resolveVixConservativeThresholds()).toEqual({ on: 4, off: 2 });
  });

  it('off>on → off=on 으로 clamp (히스테리시스 무효 방지)', () => {
    process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT = '3';
    process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT = '5';
    expect(resolveVixConservativeThresholds()).toEqual({ on: 3, off: 3 });
  });

  it('레거시 롤백 off=on=3 → 해제 <3 단일임계', () => {
    process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT = '3';
    process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT = '3';
    const t = resolveVixConservativeThresholds();
    expect(t).toEqual({ on: 3, off: 3 });
    expect(resolveVixConservativeTransition(2.9, true, t)).toBe('EXIT'); // <3 즉시 해제(레거시)
  });

  it('비유효 ENV → 기본값', () => {
    process.env.VIX_CONSERVATIVE_ON_THRESHOLD_PCT = 'abc';
    process.env.VIX_CONSERVATIVE_OFF_THRESHOLD_PCT = '';
    expect(resolveVixConservativeThresholds()).toEqual({ on: 3, off: 1.5 });
  });
});
