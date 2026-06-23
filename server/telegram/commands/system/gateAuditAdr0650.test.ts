// @responsibility ADR-0650 §D4 /gate_audit 눌림목 vs 추격 forward 비교 섹션 표시 회귀 (표시 전용·byte-equivalent OFF).
import { describe, it, expect } from 'vitest';
import { formatGateAuditMessage } from './gateAudit.cmd.js';
import type { PullbackVsChaseForwardComparison } from '../../../learning/pullbackLaneObservationTypes.js';

const baseInput = {
  windowDays: 7,
  buckets: [],
  daily: [],
  totalGhostsInWindow: 0,
  macro: null,
  scan: null,
  diagnostic: 'NO_OBVIOUS_BLOCK' as const,
  diagnosticHint: '진단 힌트',
  emergencyStop: false,
  autoTradePaused: false,
  autoTradeEnabled: true,
  autoTradeMode: 'SHADOW',
};

describe('formatGateAuditMessage 눌림목 forward 비교 섹션 (ADR-0650 §D4)', () => {
  it('comparison 미전달 → 섹션 미노출 (flag OFF byte-equivalent baseline)', () => {
    const msg = formatGateAuditMessage(baseInput);
    expect(msg).not.toMatch(/ADR-0650/);
    expect(msg).not.toMatch(/눌림목 레인 forward/);
  });

  it('RESOLVED 표본 0 → PENDING/관측중 placeholder', () => {
    const comparison: PullbackVsChaseForwardComparison = {
      pullback: { nD1: 0, nD3: 0, nD5: 0, avgForwardReturn1d: null, avgForwardReturn3d: null, avgForwardReturn5d: null, avgEntryRrr: null },
      chase: { nD1: 0, nD3: 0, nD5: 0, avgForwardReturn1d: null, avgForwardReturn3d: null, avgForwardReturn5d: null, avgEntryRrr: null },
      verdict: 'INSUFFICIENT_OR_ROLLBACK',
      verdictHint: '데이터 부족(눌림목 D5 N=0<30)',
    };
    const msg = formatGateAuditMessage({ ...baseInput, pullbackForwardComparison: comparison });
    expect(msg).toContain('🩹 눌림목 레인 forward(ADR-0650):');
    expect(msg).toMatch(/PENDING/);
  });

  it('HOLD 판정 — 눌림목 avg 1D/3D/5D + RRR + 판정 라인 노출', () => {
    const comparison: PullbackVsChaseForwardComparison = {
      pullback: { nD1: 30, nD3: 30, nD5: 30, avgForwardReturn1d: 1.5, avgForwardReturn3d: 2.5, avgForwardReturn5d: 4.2, avgEntryRrr: 2.4 },
      chase: { nD1: 10, nD3: 10, nD5: 10, avgForwardReturn1d: 0.5, avgForwardReturn3d: 1.0, avgForwardReturn5d: 1.8, avgEntryRrr: 1.6 },
      verdict: 'HOLD',
      verdictHint: '유지(눌림목 우월 확인·N=30≥30)',
    };
    const msg = formatGateAuditMessage({ ...baseInput, pullbackForwardComparison: comparison });
    expect(msg).toContain('눌림목 avg 1D/3D/5D=1.50/2.50/4.20% (n=30)');
    expect(msg).toContain('추격   avg 1D/3D/5D=0.50/1.00/1.80% (n=10)');
    expect(msg).toContain('진입RRR 눌림목 2.40 vs 추격 1.60');
    expect(msg).toContain('판정=HOLD');
  });
});
