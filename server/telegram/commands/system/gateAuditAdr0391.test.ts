// @responsibility ADR-0391 P0-A §A-4 /gate_audit 거시 게이트 상태 4 라인 회귀
import { describe, it, expect } from 'vitest';
import { formatGateAuditMessage } from './gateAudit.cmd.js';

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

describe('formatGateAuditMessage envMode/runtimeMode/killSwitchReason/modeConsistency (ADR-0391 §A-4)', () => {
  it('4 신규 필드 미전달 → 후방호환 (모두 미노출)', () => {
    const msg = formatGateAuditMessage(baseInput);
    expect(msg).not.toMatch(/envMode:/);
    expect(msg).not.toMatch(/runtimeMode:/);
    expect(msg).not.toMatch(/killSwitchReason:/);
    expect(msg).not.toMatch(/modeConsistency:/);
  });

  it('envMode=SHADOW + runtimeMode=SHADOW + killSwitch=null + CONSISTENT', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      killSwitchReason: null,
      modeConsistency: 'CONSISTENT',
    });
    expect(msg).toContain('envMode: SHADOW');
    expect(msg).toContain('runtimeMode: SHADOW');
    expect(msg).toContain('killSwitchReason: none');
    expect(msg).toContain('modeConsistency: CONSISTENT');
    expect(msg).not.toMatch(/modeConsistency: CONSISTENT \w/); // 정상 시 마커 없음
  });

  it('UNINTENDED_DIVERGENCE → 🚨 마커', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      killSwitchReason: null,
      modeConsistency: 'UNINTENDED_DIVERGENCE',
    });
    expect(msg).toContain('modeConsistency: UNINTENDED_DIVERGENCE 🚨');
  });

  it('INTENDED_OVERRIDE → ⚠️ 마커 + killSwitchReason 노출', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'LIVE',
      runtimeMode: 'SHADOW',
      killSwitchReason: 'KIS 5xx repeated 3회',
      modeConsistency: 'INTENDED_OVERRIDE',
    });
    expect(msg).toContain('modeConsistency: INTENDED_OVERRIDE ⚠️');
    expect(msg).toContain('killSwitchReason: KIS 5xx repeated 3회');
  });

  it('killSwitchReason=null 시 "none" 표기', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      killSwitchReason: null,
      modeConsistency: 'CONSISTENT',
    });
    expect(msg).toContain('killSwitchReason: none');
  });

  it('기존 거시 게이트 상태 라인 보존 (regime/MHS/VIX/AUTO_TRADE_MODE/AUTO_TRADE_ENABLED/emergencyStop/autoTradePaused)', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      killSwitchReason: null,
      modeConsistency: 'CONSISTENT',
    });
    expect(msg).toContain('regime:');
    expect(msg).toContain('MHS:');
    expect(msg).toContain('VIX:');
    expect(msg).toContain('AUTO_TRADE_MODE: SHADOW');
    expect(msg).toContain('AUTO_TRADE_ENABLED: true');
    expect(msg).toContain('emergencyStop:');
    expect(msg).toContain('autoTradePaused:');
  });

  it('순서 정합 — AUTO_TRADE_MODE 다음에 envMode 등장', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      envMode: 'SHADOW',
      runtimeMode: 'SHADOW',
      killSwitchReason: null,
      modeConsistency: 'CONSISTENT',
    });
    const idxAutoTradeMode = msg.indexOf('AUTO_TRADE_MODE:');
    const idxEnvMode = msg.indexOf('envMode:');
    expect(idxAutoTradeMode).toBeGreaterThan(0);
    expect(idxEnvMode).toBeGreaterThan(idxAutoTradeMode);
  });
});
