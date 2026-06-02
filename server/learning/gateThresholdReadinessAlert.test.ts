import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatReadinessAlertMessage,
  runGateThresholdReadinessAlert,
} from './gateThresholdReadinessAlert.js';
import type {
  GateThresholdRecommendation,
  GateThresholdRecommendationReport,
} from './gateThresholdRecommendation.js';

const FLAG = 'COUNTERFACTURE_GATE_READINESS_ALERT_DISABLED';

function rec(
  gate: 'GATE1' | 'GATE2' | 'GATE3',
  regime: string,
  decision: 'insufficient_sample' | 'loosen' | 'tighten' | 'hold',
  sampleSize = 32,
): GateThresholdRecommendation {
  return {
    gate,
    regime,
    scale: 10,
    sampleSize,
    shift: {
      decision,
      currentThreshold: 70,
      suggestedThreshold: decision === 'loosen' ? 66 : decision === 'tighten' ? 74 : decision === 'hold' ? 70 : null,
      shiftPct: decision === 'insufficient_sample' ? null : -5.7,
      winSample: 24,
      lossSample: 8,
    },
    liveThresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

function report(recs: GateThresholdRecommendation[]): GateThresholdRecommendationReport {
  return {
    generatedAtKst: '2026-06-20T16:00:00+09:00',
    recommendations: recs,
    minSample: 30,
    liveThresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

afterEach(() => {
  delete process.env[FLAG];
});

describe('counterfacture_gate Phase J — gateThresholdReadinessAlert', () => {
  it('disabled flag → no-op, no send', async () => {
    process.env[FLAG] = 'true';
    const alerter = vi.fn().mockResolvedValue(undefined);
    const res = await runGateThresholdReadinessAlert({
      report: report([rec('GATE1', 'R3_EARLY', 'loosen')]),
      alerter,
      state: { alertedKeys: [] },
      persist: false,
    });
    expect(res.enabled).toBe(false);
    expect(alerter).not.toHaveBeenCalled();
  });

  it('actionable + 미알림 → 1회 발송 + newlyAlerted, insufficient 는 제외', async () => {
    const alerter = vi.fn().mockResolvedValue(undefined);
    const res = await runGateThresholdReadinessAlert({
      report: report([rec('GATE1', 'R3_EARLY', 'loosen'), rec('GATE3', 'UNKNOWN', 'insufficient_sample')]),
      alerter,
      state: { alertedKeys: [] },
      persist: false,
    });
    expect(res.sent).toBe(true);
    expect(res.newlyAlerted).toEqual(['GATE1:R3_EARLY']);
    expect(alerter).toHaveBeenCalledTimes(1);
    expect(alerter.mock.calls[0][0]).toContain('GATE1/R3_EARLY');
  });

  it('actionable + 이미 알림됨 → dedup, no send', async () => {
    const alerter = vi.fn().mockResolvedValue(undefined);
    const res = await runGateThresholdReadinessAlert({
      report: report([rec('GATE1', 'R3_EARLY', 'loosen')]),
      alerter,
      state: { alertedKeys: ['GATE1:R3_EARLY'] },
      persist: false,
    });
    expect(res.sent).toBe(false);
    expect(res.alreadyAlerted).toBe(1);
    expect(alerter).not.toHaveBeenCalled();
  });

  it('insufficient_sample 만 → 무음(검증 기간 미도달)', async () => {
    const alerter = vi.fn().mockResolvedValue(undefined);
    const res = await runGateThresholdReadinessAlert({
      report: report([rec('GATE2', 'R2_BULL', 'insufficient_sample')]),
      alerter,
      state: { alertedKeys: [] },
      persist: false,
    });
    expect(res.readyKeys).toEqual([]);
    expect(res.sent).toBe(false);
    expect(alerter).not.toHaveBeenCalled();
  });

  it('메시지는 준비된 gate×regime + /gate_threshold_reco 안내', () => {
    const msg = formatReadinessAlertMessage([rec('GATE1', 'R3_EARLY', 'loosen'), rec('GATE3', 'UNKNOWN', 'tighten')]);
    expect(msg).toContain('검증 준비됨');
    expect(msg).toContain('GATE1/R3_EARLY');
    expect(msg).toContain('LOOSEN→66.0');
    expect(msg).toContain('/gate_threshold_reco');
  });
});
