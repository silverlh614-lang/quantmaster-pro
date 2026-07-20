/**
 * gateThresholdApproval.test.ts — counterfacture_gate Phase L 승인 seam 회귀.
 * PERSIST_DATA_DIR 격리 + 동적 import 로 gate-learned-thresholds.json 실 I/O 를 tmp 로 우회.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { GateScoredOutcome } from './gateScoredOutcomeProjection.js';

function mkOutcomes(regime: string, winScalar: number, winN: number, lossScalar: number, lossN: number): GateScoredOutcome[] {
  const out: GateScoredOutcome[] = [];
  for (let i = 0; i < winN; i += 1) {
    out.push({ gate: 'GATE1', scalar: winScalar, scale: 10, outcome: 'WIN', regime, forwardReturnD5Pct: 5, symbol: `W${i}` });
  }
  for (let i = 0; i < lossN; i += 1) {
    out.push({ gate: 'GATE1', scalar: lossScalar, scale: 10, outcome: 'LOSS', regime, forwardReturnD5Pct: -5, symbol: `L${i}` });
  }
  return out;
}

describe('gateThresholdApproval — Phase L operator 승인 seam', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtapprove-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED;
    delete process.env.COUNTERFACTURE_GATE_APPLY_ENABLED;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED;
    delete process.env.COUNTERFACTURE_GATE_APPLY_ENABLED;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('actionable(loosen) 권고 → 승인 store 에 기록', async () => {
    const { approveGateThresholdFromRecommendation } = await import('./gateThresholdApproval.js');
    const { getGateLearnedThreshold } = await import('../persistence/gateLearnedThresholdRepo.js');
    // WIN 고득점(20)/LOSS 저득점(10) → 최적 cut=20, current(≥floor>21) 대비 큰 폭 하향 → loosen.
    const outcomes = mkOutcomes('R2_BULL', 20, 20, 10, 20);
    const r = await approveGateThresholdFromRecommendation({
      gate: 'GATE1', regime: 'R2_BULL', approvedBy: 'op1', approvedAtKst: '2026-07-20 15:00 KST',
      injected: { outcomes },
    });
    expect(r.approved).toBe(true);
    expect(r.entry?.approvedThreshold).toBe(20);
    expect(r.entry?.basis.decision).toBe('loosen');
    const stored = getGateLearnedThreshold('GATE1', 'R2_BULL');
    expect(stored?.approvedThreshold).toBe(20);
    expect(stored?.approvedBy).toBe('op1');
  });

  it('표본 < ROC_MIN_SAMPLE → NOT_ACTIONABLE 거부(기록 0)', async () => {
    const { approveGateThresholdFromRecommendation } = await import('./gateThresholdApproval.js');
    const { getGateLearnedThreshold } = await import('../persistence/gateLearnedThresholdRepo.js');
    const outcomes = mkOutcomes('R2_BULL', 20, 5, 10, 5); // n=10 < 30
    const r = await approveGateThresholdFromRecommendation({
      gate: 'GATE1', regime: 'R2_BULL', approvedBy: 'op1', approvedAtKst: 'x', injected: { outcomes },
    });
    expect(r.approved).toBe(false);
    expect(r.reason).toContain('NOT_ACTIONABLE');
    expect(getGateLearnedThreshold('GATE1', 'R2_BULL')).toBeNull();
  });

  it('ENV DISABLED → 거부(기록 0)', async () => {
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = 'true';
    const { approveGateThresholdFromRecommendation } = await import('./gateThresholdApproval.js');
    const { getGateLearnedThreshold } = await import('../persistence/gateLearnedThresholdRepo.js');
    const outcomes = mkOutcomes('R2_BULL', 20, 20, 10, 20);
    const r = await approveGateThresholdFromRecommendation({
      gate: 'GATE1', regime: 'R2_BULL', approvedBy: 'op1', approvedAtKst: 'x', injected: { outcomes },
    });
    expect(r.approved).toBe(false);
    expect(getGateLearnedThreshold('GATE1', 'R2_BULL')).toBeNull();
  });

  it('approvedBy 없음 → APPROVER_REQUIRED(기록 0)', async () => {
    const { approveGateThresholdFromRecommendation } = await import('./gateThresholdApproval.js');
    const { getGateLearnedThreshold } = await import('../persistence/gateLearnedThresholdRepo.js');
    const outcomes = mkOutcomes('R2_BULL', 20, 20, 10, 20);
    const r = await approveGateThresholdFromRecommendation({
      gate: 'GATE1', regime: 'R2_BULL', approvedBy: '', approvedAtKst: 'x', injected: { outcomes },
    });
    expect(r.approved).toBe(false);
    expect(r.reason).toContain('APPROVER_REQUIRED');
    expect(getGateLearnedThreshold('GATE1', 'R2_BULL')).toBeNull();
  });

  it('승인분 기록 후에도 flag OFF → apply resolver=null (executionImpact=NONE byte-identical)', async () => {
    const { approveGateThresholdFromRecommendation } = await import('./gateThresholdApproval.js');
    const { resolveLearnedGate1RequiredScore } = await import('./gateLearnedThresholdApply.js');
    const outcomes = mkOutcomes('R2_BULL', 20, 20, 10, 20);
    await approveGateThresholdFromRecommendation({
      gate: 'GATE1', regime: 'R2_BULL', approvedBy: 'op1', approvedAtKst: 'x', injected: { outcomes },
    });
    // 승인분이 store 에 있어도 COUNTERFACTURE_GATE_APPLY_ENABLED 미설정이면 항상 null → 레거시 70 fallback.
    expect(resolveLearnedGate1RequiredScore('R2_BULL')).toBeNull();
  });
});
