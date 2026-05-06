// @responsibility ADR-0323 GATE_PASS_RATE_SLA 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScanTrace } from '../trading/scanTracer.js';
import {
  calculateGatePassRate,
  evaluateAllGateSLA,
  evaluateGateSLA,
  GATE_PASS_RATE_SLA,
  GATE_SLA_MIN_SAMPLE,
  isGateSLADisabled,
} from './gateSLA.js';

const ORIGINAL_DISABLED = process.env.GATE_SLA_DISABLED;

beforeEach(() => {
  delete process.env.GATE_SLA_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.GATE_SLA_DISABLED;
  else process.env.GATE_SLA_DISABLED = ORIGINAL_DISABLED;
});

const trace = (stages: Record<string, string>): ScanTrace => ({
  ts: '09:30:00',
  stock: 'A',
  name: 'A',
  stages,
});

describe('GATE_PASS_RATE_SLA SSOT (ADR-0323)', () => {
  it('실제 scanTrace stage 키만 등재 (사용자 spec 의 가공 키 미포함)', () => {
    const realStageKeys = ['price', 'drift', 'rrr', 'portfolioRisk', 'sectorGuard', 'timeframeConfluence', 'gate'];
    expect(Object.keys(GATE_PASS_RATE_SLA).sort()).toEqual(realStageKeys.sort());
  });

  it('각 SLA — min < max + 둘 다 [0, 1] 범위', () => {
    for (const [key, sla] of Object.entries(GATE_PASS_RATE_SLA)) {
      expect(sla.min, `${key} min`).toBeGreaterThanOrEqual(0);
      expect(sla.max, `${key} max`).toBeLessThanOrEqual(1);
      expect(sla.min, `${key} min<max`).toBeLessThanOrEqual(sla.max);
    }
  });

  it('GATE_SLA_MIN_SAMPLE = 10 (표본 신뢰도 임계)', () => {
    expect(GATE_SLA_MIN_SAMPLE).toBe(10);
  });
});

describe('isGateSLADisabled — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false', () => {
    expect(isGateSLADisabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.GATE_SLA_DISABLED = 'true';
    expect(isGateSLADisabled()).toBe(true);
  });
  it('"1" / "TRUE" / "yes" → false (정확 비교)', () => {
    process.env.GATE_SLA_DISABLED = '1';
    expect(isGateSLADisabled()).toBe(false);
    process.env.GATE_SLA_DISABLED = 'TRUE';
    expect(isGateSLADisabled()).toBe(false);
    process.env.GATE_SLA_DISABLED = 'yes';
    expect(isGateSLADisabled()).toBe(false);
  });
});

describe('calculateGatePassRate', () => {
  it('빈 traces → passRate=1, total=0', () => {
    const r = calculateGatePassRate('rrr', []);
    expect(r.passRate).toBe(1);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(0);
  });

  it('PASS 만 → 100%', () => {
    const traces = [trace({ rrr: 'PASS' }), trace({ rrr: 'PASS' })];
    const r = calculateGatePassRate('rrr', traces);
    expect(r.passRate).toBe(1);
    expect(r.passed).toBe(2);
    expect(r.total).toBe(2);
  });

  it('PASS + FAIL 혼재 → 50%', () => {
    const traces = [trace({ rrr: 'PASS' }), trace({ rrr: 'FAIL(1.5 < 2.0)' })];
    const r = calculateGatePassRate('rrr', traces);
    expect(r.passRate).toBe(0.5);
    expect(r.passed).toBe(1);
    expect(r.total).toBe(2);
  });

  it('stage 키 부재 trace → 카운트 제외 (조기 차단 시나리오)', () => {
    const traces = [trace({ price: 'PASS' }), trace({ rrr: 'PASS' })];
    const r = calculateGatePassRate('rrr', traces);
    expect(r.total).toBe(1); // price 만 있는 trace 는 rrr 카운트 미진입
  });

  it('FAIL 다양한 형식 모두 미통과 (PASS 만 통과)', () => {
    const traces = [
      trace({ drift: 'PASS' }),
      trace({ drift: 'DATA_HOLD' }),
      trace({ drift: 'CORPORATE_ACTION' }),
      trace({ drift: 'REMOVE' }),
    ];
    const r = calculateGatePassRate('drift', traces);
    expect(r.passed).toBe(1);
    expect(r.total).toBe(4);
    expect(r.passRate).toBe(0.25);
  });

  it('null/undefined stages 안전 fallback', () => {
    const traces: ScanTrace[] = [
      { ts: '09:30:00', stock: 'A', name: 'A', stages: undefined as unknown as Record<string, string> },
    ];
    const r = calculateGatePassRate('rrr', traces);
    expect(r.total).toBe(0);
  });
});

describe('evaluateGateSLA', () => {
  function manyTraces(stageKey: string, passCount: number, failCount: number): ScanTrace[] {
    const out: ScanTrace[] = [];
    for (let i = 0; i < passCount; i++) out.push(trace({ [stageKey]: 'PASS' }));
    for (let i = 0; i < failCount; i++) out.push(trace({ [stageKey]: 'FAIL' }));
    return out;
  }

  it('ENV DISABLED → NO_SLA (모든 stage)', () => {
    process.env.GATE_SLA_DISABLED = 'true';
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 10, 0));
    expect(r.status).toBe('NO_SLA');
  });

  it('SLA 미등재 stage → NO_SLA', () => {
    const r = evaluateGateSLA('unknownStage', manyTraces('unknownStage', 10, 0));
    expect(r.status).toBe('NO_SLA');
    expect(r.slaMin).toBeNull();
  });

  it('표본 < 10 → INSUFFICIENT_SAMPLE', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 5, 4));
    expect(r.status).toBe('INSUFFICIENT_SAMPLE');
    expect(r.total).toBe(9);
  });

  it('rrr passRate=0.50 (60% 미만) → OVER_CONSERVATIVE', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 10, 10));
    expect(r.status).toBe('OVER_CONSERVATIVE');
    expect(r.passRate).toBe(0.5);
  });

  it('rrr passRate=0.97 (95% 초과) → OVER_PERMISSIVE', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 97, 3));
    expect(r.status).toBe('OVER_PERMISSIVE');
  });

  it('rrr passRate=0.75 (정상 범위) → OK', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 75, 25));
    expect(r.status).toBe('OK');
  });

  it('boundary — passRate=min 정확 → OK (≥ 비교)', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 60, 40));
    expect(r.status).toBe('OK');
    expect(r.passRate).toBe(0.6);
  });

  it('boundary — passRate=max 정확 → OK (≤ 비교)', () => {
    const r = evaluateGateSLA('rrr', manyTraces('rrr', 95, 5));
    expect(r.status).toBe('OK');
  });

  it('price stage — 1.0 통과 → OK', () => {
    const r = evaluateGateSLA('price', manyTraces('price', 100, 0));
    expect(r.status).toBe('OK');
  });

  it('price stage — 0.90 통과 → OVER_CONSERVATIVE (price min=0.95)', () => {
    const r = evaluateGateSLA('price', manyTraces('price', 90, 10));
    expect(r.status).toBe('OVER_CONSERVATIVE');
  });
});

describe('evaluateAllGateSLA', () => {
  it('등재된 모든 stage 키 평가 결과 반환', () => {
    const results = evaluateAllGateSLA([]);
    expect(results.length).toBe(Object.keys(GATE_PASS_RATE_SLA).length);
    const keys = results.map(r => r.stageKey).sort();
    expect(keys).toEqual(Object.keys(GATE_PASS_RATE_SLA).sort());
  });

  it('빈 traces — 모두 INSUFFICIENT_SAMPLE', () => {
    const results = evaluateAllGateSLA([]);
    for (const r of results) {
      expect(r.status).toBe('INSUFFICIENT_SAMPLE');
    }
  });

  it('ENV DISABLED — 모두 NO_SLA', () => {
    process.env.GATE_SLA_DISABLED = 'true';
    const results = evaluateAllGateSLA([]);
    for (const r of results) {
      expect(r.status).toBe('NO_SLA');
    }
  });
});
