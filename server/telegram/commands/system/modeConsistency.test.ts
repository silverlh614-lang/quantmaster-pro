// @responsibility ADR-0391 P0-A §A-1 /mode_consistency 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  classifyModeConsistency,
  formatModeConsistencyMessage,
  type ModeConsistencyState,
} from './modeConsistency.cmd.js';

describe('classifyModeConsistency (ADR-0391 §A-1)', () => {
  it('env === runtime → CONSISTENT', () => {
    const result = classifyModeConsistency({
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      isReal: false,
      killSwitch: null,
    });
    expect(result).toBe<ModeConsistencyState>('CONSISTENT');
  });

  it('case-insensitive 비교 — env=shadow vs runtime=SHADOW → CONSISTENT', () => {
    const result = classifyModeConsistency({
      envMode: 'shadow',
      runtimeMode: 'SHADOW',
      isReal: false,
      killSwitch: null,
    });
    expect(result).toBe<ModeConsistencyState>('CONSISTENT');
  });

  it('killSwitch.to === runtime → INTENDED_OVERRIDE', () => {
    const result = classifyModeConsistency({
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      isReal: true,
      killSwitch: {
        at: '2026-05-06T00:00:00.000Z',
        from: 'LIVE',
        to: 'SHADOW',
        reason: 'kill switch test',
        triggers: ['test'],
      },
    });
    expect(result).toBe<ModeConsistencyState>('INTENDED_OVERRIDE');
  });

  it('env !== runtime + killSwitch 없음 → UNINTENDED_DIVERGENCE', () => {
    const result = classifyModeConsistency({
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      isReal: true,
      killSwitch: null,
    });
    expect(result).toBe<ModeConsistencyState>('UNINTENDED_DIVERGENCE');
  });

  it('env !== runtime + killSwitch.to !== runtime → UNINTENDED_DIVERGENCE', () => {
    const result = classifyModeConsistency({
      envMode: 'LIVE',
      runtimeMode: 'PAPER',
      isReal: true,
      killSwitch: {
        at: '2026-05-06T00:00:00.000Z',
        from: 'LIVE',
        to: 'SHADOW', // PAPER 와 다름
        reason: 'kill switch test',
        triggers: ['test'],
      },
    });
    expect(result).toBe<ModeConsistencyState>('UNINTENDED_DIVERGENCE');
  });
});

describe('formatModeConsistencyMessage (ADR-0391 §A-1)', () => {
  it('CONSISTENT 시 ✅ 마커', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      isReal: false,
      killSwitch: null,
    });
    expect(msg).toContain('상태: CONSISTENT');
    expect(msg).toContain('✅ 정상');
    expect(msg).toContain('Kill switch: 없음');
  });

  it('UNINTENDED_DIVERGENCE 시 🚨 마커', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      isReal: true,
      killSwitch: null,
    });
    expect(msg).toContain('상태: UNINTENDED_DIVERGENCE');
    expect(msg).toContain('🚨 즉시 동기화 필요');
  });

  it('INTENDED_OVERRIDE 시 ⚠️ 마커 + killSwitch 메타 포함', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      isReal: true,
      killSwitch: {
        at: '2026-05-06T00:00:00.000Z',
        from: 'LIVE',
        to: 'SHADOW',
        reason: 'KIS 5xx repeated',
        triggers: ['kis_5xx'],
      },
    });
    expect(msg).toContain('상태: INTENDED_OVERRIDE');
    expect(msg).toContain('⚠️ 의도된 강등');
    expect(msg).toContain('LIVE → SHADOW');
    expect(msg).toContain('KIS 5xx repeated');
  });

  it('LIVE + KIS_IS_REAL=true → Live order possible: true', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'LIVE',
      runtimeMode: 'LIVE',
      isReal: true,
      killSwitch: null,
    });
    expect(msg).toContain('Live order possible: true');
  });

  it('LIVE + KIS_IS_REAL=false → Live order possible: false', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'LIVE',
      runtimeMode: 'LIVE',
      isReal: false,
      killSwitch: null,
    });
    expect(msg).toContain('Live order possible: false');
  });

  it('SHADOW + KIS_IS_REAL=true → Live order possible: false (runtime LIVE 아니라서)', () => {
    const msg = formatModeConsistencyMessage({
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      isReal: true,
      killSwitch: null,
    });
    expect(msg).toContain('Live order possible: false');
  });
});
