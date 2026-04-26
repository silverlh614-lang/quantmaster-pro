/**
 * @responsibility partitionTracesByStage 단위 테스트 — PR-J
 */
import { describe, it, expect } from 'vitest';
import { partitionTracesByStage } from './screenerPipelineRouter.js';
import type { ScanTrace } from '../trading/scanTracer.js';

function trace(stock: string, name: string, stages: Record<string, string>): ScanTrace {
  return { ts: '14:30:00', stock, name, stages };
}

describe('partitionTracesByStage — PR-J 단계별 분류', () => {
  const traces: ScanTrace[] = [
    trace('1', 'A', { gate: 'PASS', rrr: 'PASS', buy: 'SHADOW' }),
    trace('2', 'B', { gate: 'FAIL(yahoo:404)', rrr: 'N/A', buy: 'N/A' }),
    trace('3', 'C', { gate: 'FAIL(volume_clock)', rrr: 'N/A', buy: 'N/A' }),
    trace('4', 'D', { gate: 'PASS', rrr: 'FAIL(rrr<2)', buy: 'N/A' }),
    trace('5', 'E', { gate: 'PASS', rrr: 'PASS', buy: 'N/A' }), // RRR 통과 + 진입 실패
    trace('6', 'F', { gate: 'PASS', rrr: 'PASS', buy: 'LIVE' }),
  ];

  it('CANDIDATES 단계 → 모든 trace passed', () => {
    const r = partitionTracesByStage(traces, 'CANDIDATES');
    expect(r.passed).toHaveLength(6);
    expect(r.dropped).toHaveLength(0);
  });

  it('MOMENTUM_PASS → yahoo FAIL 만 dropped', () => {
    const r = partitionTracesByStage(traces, 'MOMENTUM_PASS');
    expect(r.passed.map(p => p.stock).sort()).toEqual(['1', '3', '4', '5', '6']);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].stock).toBe('2');
    expect(r.dropped[0].dropReason).toBe('yahoo');
  });

  it('GATE1_PASS → yahoo OK 중 gate FAIL 만 dropped (이전 단계 dropped 는 미포함)', () => {
    const r = partitionTracesByStage(traces, 'GATE1_PASS');
    expect(r.passed.map(p => p.stock).sort()).toEqual(['1', '4', '5', '6']);
    expect(r.dropped.map(d => d.stock)).toEqual(['3']);
    expect(r.dropped[0].dropReason).toBe('gate');
  });

  it('RRR_PASS → gate OK 중 rrr FAIL 만 dropped', () => {
    const r = partitionTracesByStage(traces, 'RRR_PASS');
    expect(r.passed.map(p => p.stock).sort()).toEqual(['1', '5', '6']);
    expect(r.dropped.map(d => d.stock)).toEqual(['4']);
    expect(r.dropped[0].dropReason).toBe('rrr');
  });

  it('ENTRIES → buy SHADOW/LIVE 만 passed (EXECUTED), 나머지 RRR_PASS 통과 자는 dropped(buy_failed)', () => {
    const r = partitionTracesByStage(traces, 'ENTRIES');
    expect(r.passed.map(p => p.stock).sort()).toEqual(['1', '6']);
    expect(r.passed.every(p => p.outcome === 'EXECUTED')).toBe(true);
    expect(r.dropped.map(d => d.stock)).toEqual(['5']);
    expect(r.dropped[0].dropReason).toBe('buy_failed');
  });

  it('빈 traces → 모든 단계 빈 결과', () => {
    const r = partitionTracesByStage([], 'CANDIDATES');
    expect(r.passed).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.counts.passed).toBe(0);
  });

  it('counts 정확', () => {
    const r = partitionTracesByStage(traces, 'MOMENTUM_PASS');
    expect(r.counts.passed).toBe(5);
    expect(r.counts.dropped).toBe(1);
  });
});
