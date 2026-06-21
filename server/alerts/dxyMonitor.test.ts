// @responsibility ADR-0642 DXY flowBias CONTRADICTED 분류 + 메시지 회귀 테스트.

import { describe, expect, it } from 'vitest';
import { determineFlowBias, formatAlert, type DxyReading, type DxyAlertReport } from './dxyMonitor.js';

function reading(p: Partial<DxyReading>): DxyReading {
  return { last: 100, change1d: 0, change5d: 0, krwChange: null, ewyChange: null, ...p };
}

function report(p: Partial<DxyAlertReport> & { reading: DxyReading }): DxyAlertReport {
  return {
    createdAt: '2026-06-21T00:00:00.000Z',
    direction: p.reading.change1d >= 0 ? 'STRENGTH' : 'WEAKNESS',
    severity: 'PRELIMINARY',
    flowBias: 'UNCLEAR',
    alertSent: false,
    ...p,
  };
}

describe('determineFlowBias (ADR-0642)', () => {
  it('keeps FOREIGN_OUTFLOW when DXY↑ & KRW↑ & EWY↓ (byte-identical)', () => {
    expect(determineFlowBias(reading({ change1d: 0.8, krwChange: 0.3, ewyChange: -1.0 }))).toBe('FOREIGN_OUTFLOW');
  });

  it('keeps FOREIGN_INFLOW when DXY↓ & KRW↓ & EWY↑ (byte-identical)', () => {
    expect(determineFlowBias(reading({ change1d: -0.8, krwChange: -0.3, ewyChange: 1.0 }))).toBe('FOREIGN_INFLOW');
  });

  it('classifies the real 2026-06-21 case (DXY↑ but KRW↓ & EWY↑) as CONTRADICTED', () => {
    expect(determineFlowBias(reading({ change1d: 0.76, krwChange: -0.5, ewyChange: 6.89 }))).toBe('CONTRADICTED');
  });

  it('classifies DXY↓ with KRW↑ & EWY↓ (both contradict) as CONTRADICTED', () => {
    expect(determineFlowBias(reading({ change1d: -0.8, krwChange: 0.3, ewyChange: -1.0 }))).toBe('CONTRADICTED');
  });

  it('stays UNCLEAR on partial agreement (1 support, 1 contradict)', () => {
    expect(determineFlowBias(reading({ change1d: 0.8, krwChange: 0.3, ewyChange: 1.0 }))).toBe('UNCLEAR');
  });

  it('stays UNCLEAR when a cross-check input is null', () => {
    expect(determineFlowBias(reading({ change1d: 0.8, krwChange: null, ewyChange: -1.0 }))).toBe('UNCLEAR');
  });
});

describe('formatAlert CONTRADICTED wording (ADR-0642)', () => {
  it('renders the refutation biasLine + direction-aware action for DXY↑', () => {
    const msg = formatAlert(report({
      reading: reading({ last: 100.85, change1d: 0.76, change5d: 0.99, krwChange: -0.5, ewyChange: 6.89 }),
      flowBias: 'CONTRADICTED',
    }));
    expect(msg).toContain('DXY 예비 경보');
    expect(msg).toContain('🟡');
    expect(msg).toContain('DXY 단독 신호 반박');
    expect(msg).toContain('DXY 강세 비반영');
    expect(msg).not.toContain('관찰 후 판단');
  });

  it('renders the WEAKNESS-side action for DXY↓ CONTRADICTED', () => {
    const msg = formatAlert(report({
      reading: reading({ last: 99, change1d: -0.8, change5d: -0.4, krwChange: 0.3, ewyChange: -1.0 }),
      flowBias: 'CONTRADICTED',
    }));
    expect(msg).toContain('DXY 약세 비반영');
  });

  it('preserves the existing OUTFLOW wording (no regression)', () => {
    const msg = formatAlert(report({
      reading: reading({ last: 102, change1d: 0.9, change5d: 1.8, krwChange: 0.4, ewyChange: -1.2 }),
      severity: 'CONFIRMED',
      flowBias: 'FOREIGN_OUTFLOW',
    }));
    expect(msg).toContain('🔴');
    expect(msg).toContain('외국인 이탈 시그널');
    expect(msg).toContain('DXY 확정 경보');
  });
});
