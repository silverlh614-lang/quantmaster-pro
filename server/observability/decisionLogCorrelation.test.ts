import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatDecisionLog,
  logDecisionEvent,
  SHADOW_LIFECYCLE_CHAIN,
  REQUIRED_CORRELATION_FIELDS,
  PERMISSION_STAGE_REQUIRED_FIELDS,
  type DecisionLogCorrelation,
} from './decisionLogCorrelation.js';
import { logger } from '../utils/logger.js';

describe('formatDecisionLog (ADR-0528)', () => {
  it('emits [DECISION] prefix + decisionStage + required correlation fields', () => {
    const line = formatDecisionLog('POSITION_POLICY', {
      sourceSnapshotId: 'scan_20260525_abc',
      decisionStage: 'POSITION_POLICY',
      symbol: '005930',
    });
    expect(line.startsWith('[DECISION]')).toBe(true);
    expect(line).toContain('decisionStage=POSITION_POLICY');
    expect(line).toContain('sourceSnapshotId=scan_20260525_abc');
    expect(line).toContain('symbol=005930');
  });

  it('omits undefined optional correlation fields (단계별 가용성)', () => {
    const line = formatDecisionLog('GATE_SCORE', {
      sourceSnapshotId: 'snap-1',
      decisionStage: 'GATE_SCORE',
      symbol: '000660',
    });
    expect(line).not.toContain('liveOrderAllowed=');
    expect(line).not.toContain('executionImpact=');
    expect(line).not.toContain('finalVerdict=');
  });

  it('serializes permission fields when present (EXECUTION_PERMISSION 이후)', () => {
    const line = formatDecisionLog('EXECUTION_PERMISSION', {
      sourceSnapshotId: 'snap-2',
      decisionStage: 'EXECUTION_PERMISSION',
      symbol: '035720',
      mode: 'SHADOW',
      liveOrderAllowed: false,
      shadowOrderAllowed: true,
      paperFillAllowed: true,
      executionImpact: 'NONE',
      finalVerdict: 'GATE2_CONFLUENCE_FAIL',
    });
    for (const field of PERMISSION_STAGE_REQUIRED_FIELDS) {
      expect(line).toContain(`${field}=`);
    }
    expect(line).toContain('finalVerdict=GATE2_CONFLUENCE_FAIL');
    expect(line).toContain('mode=SHADOW');
  });

  it('preserves human-readable detail fields (가법 — liveGate 등 보존)', () => {
    const line = formatDecisionLog(
      'POSITION_POLICY',
      { sourceSnapshotId: 'snap-3', decisionStage: 'POSITION_POLICY', symbol: '005930' },
      { liveGate: '7.2', mtas: '6.5/10', posPct: '10.0%' },
    );
    expect(line).toContain('liveGate=7.2');
    expect(line).toContain('mtas=6.5/10');
    expect(line).toContain('posPct=10.0%');
  });

  it('keeps the same sourceSnapshotId across the 5-event shadow chain', () => {
    const sourceSnapshotId = 'shadow-cycle-42';
    const lines = SHADOW_LIFECYCLE_CHAIN.map((stage) =>
      formatDecisionLog(stage, { sourceSnapshotId, decisionStage: stage, symbol: '005930' }),
    );
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line).toContain(`sourceSnapshotId=${sourceSnapshotId}`);
      expect(line).toContain('symbol=005930');
    }
    // 단일 grep 키로 5건 추출 가능(단절 시 미체결).
    const matched = lines.filter((l) => l.includes(`sourceSnapshotId=${sourceSnapshotId}`));
    expect(matched).toHaveLength(SHADOW_LIFECYCLE_CHAIN.length);
  });

  it('exports the 3 always-required correlation fields', () => {
    expect([...REQUIRED_CORRELATION_FIELDS]).toEqual(['sourceSnapshotId', 'decisionStage', 'symbol']);
  });
});

describe('logDecisionEvent (ADR-0528)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a formatted line to logger.info', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    logDecisionEvent('SHADOW_EXECUTION_START', {
      sourceSnapshotId: 'snap-x',
      decisionStage: 'SHADOW_EXECUTION_START',
      symbol: '005930',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[DECISION]');
    expect(spy.mock.calls[0][0]).toContain('sourceSnapshotId=snap-x');
  });

  it('never throws even if serialization hits a hostile detail value (불변식 #1/#2)', () => {
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      logDecisionEvent(
        'POSITION_POLICY',
        { sourceSnapshotId: 's', decisionStage: 'POSITION_POLICY', symbol: '005930' },
        { circular },
      ),
    ).not.toThrow();
  });

  it('does not throw when the underlying logger throws (Trading 정지 금지)', () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('logger down');
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const correlation: DecisionLogCorrelation = {
      sourceSnapshotId: 's',
      decisionStage: 'LEDGER_RECORDED',
      symbol: '005930',
    };
    expect(() => logDecisionEvent('LEDGER_RECORDED', correlation)).not.toThrow();
  });
});
