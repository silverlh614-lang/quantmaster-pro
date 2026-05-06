// @responsibility ADR-0391 P0-A §A-2 /exec_matrix 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  buildExpectedBehavior,
  formatExecMatrixMessage,
} from './execMatrix.cmd.js';

describe('buildExpectedBehavior (ADR-0391 §A-2)', () => {
  it('SHADOW 모드 → shadowRecorded=true, paperBuy=false, liveOrder=false', () => {
    expect(buildExpectedBehavior('SHADOW')).toEqual({
      shadowRecorded: true,
      paperBuy: false,
      liveOrder: false,
    });
  });

  it('PAPER 모드 → shadowRecorded=true, paperBuy=true, liveOrder=false', () => {
    expect(buildExpectedBehavior('PAPER')).toEqual({
      shadowRecorded: true,
      paperBuy: true,
      liveOrder: false,
    });
  });

  it('LIVE 모드 → shadowRecorded=true, paperBuy=false, liveOrder=true', () => {
    expect(buildExpectedBehavior('LIVE')).toEqual({
      shadowRecorded: true,
      paperBuy: false,
      liveOrder: true,
    });
  });

  it('MANUAL 모드 → shadowRecorded=true (always-on 명세), paperBuy=false, liveOrder=false', () => {
    expect(buildExpectedBehavior('MANUAL')).toEqual({
      shadowRecorded: true,
      paperBuy: false,
      liveOrder: false,
    });
  });
});

describe('formatExecMatrixMessage (ADR-0391 §A-2)', () => {
  const baseStats = {
    shadowRecorded: 100,
    paperBuyRecorded: 0,
    liveOrderSent: 0,
    liveBlocked: 0,
    ghost: 50,
    evaluated: 150,
  };

  it('Mode 헤더 + Expected 섹션 + Actual 섹션 + Diagnosis 섹션 모두 포함', () => {
    const msg = formatExecMatrixMessage({
      mode: 'SHADOW',
      expected: { shadowRecorded: true, paperBuy: false, liveOrder: false },
      actual: baseStats,
      diagnosis: ['✅ 기대 vs 실제 일치'],
    });
    expect(msg).toContain('Mode: SHADOW');
    expect(msg).toContain('Expected:');
    expect(msg).toContain('Actual:');
    expect(msg).toContain('Diagnosis:');
    expect(msg).toContain('✅ 기대 vs 실제 일치');
  });

  it('Expected YES/NO 라벨 정확', () => {
    const msg = formatExecMatrixMessage({
      mode: 'LIVE',
      expected: { shadowRecorded: true, paperBuy: false, liveOrder: true },
      actual: baseStats,
      diagnosis: [],
    });
    expect(msg).toContain('shadowRecorded: YES');
    expect(msg).toContain('paperBuy: NO');
    expect(msg).toContain('liveOrder: YES');
  });

  it('Actual 카운트 6개 모두 표시', () => {
    const msg = formatExecMatrixMessage({
      mode: 'SHADOW',
      expected: { shadowRecorded: true, paperBuy: false, liveOrder: false },
      actual: { shadowRecorded: 100, paperBuyRecorded: 5, liveOrderSent: 3, liveBlocked: 1, ghost: 50, evaluated: 150 },
      diagnosis: [],
    });
    expect(msg).toContain('evaluated: 150');
    expect(msg).toContain('shadowRecorded: 100');
    expect(msg).toContain('paperBuy: 5');
    expect(msg).toContain('liveOrderSent: 3');
    expect(msg).toContain('liveBlocked: 1');
    expect(msg).toContain('ghost: 50');
  });

  it('P0-A placeholder 안내 라인 — paperBuy/liveBlocked', () => {
    const msg = formatExecMatrixMessage({
      mode: 'SHADOW',
      expected: { shadowRecorded: true, paperBuy: false, liveOrder: false },
      actual: baseStats,
      diagnosis: [],
    });
    expect(msg).toContain('P0-A placeholder');
    expect(msg).toContain('P1 ExecutionMode');
  });

  it('진단 다중 라인 처리 — 들여쓰기 적용', () => {
    const msg = formatExecMatrixMessage({
      mode: 'SHADOW',
      expected: { shadowRecorded: true, paperBuy: false, liveOrder: false },
      actual: baseStats,
      diagnosis: [
        '🚨 shadowRecorded=0',
        '⚠️ ghost가 shadow의 2배 초과',
      ],
    });
    expect(msg).toContain('🚨');
    expect(msg).toContain('⚠️');
    // 각 라인이 들여쓰기 (2 space) 로 표시되는지
    expect(msg).toMatch(/  🚨/);
    expect(msg).toMatch(/  ⚠️/);
  });
});
