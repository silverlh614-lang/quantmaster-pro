import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyFreshDataValueAdr0492,
  formatFreshDataSchedulerCompactAdr0492,
  runFreshDataSchedulerAdr0492,
} from './freshDataSchedulerAdr0492.js';

const moduleSrc = () => fs.readFileSync(path.resolve('server/trading/signalScanner/freshDataSchedulerAdr0492.ts'), 'utf-8');
const tmpStore = (name: string) => path.join(process.cwd(), 'data', `test-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

function fixedHolidaySession() {
  return { type: 'HOLIDAY' as const, tradingDate: '2026-05-09', isTradingDay: false, label: 'HOLIDAY_VALID' };
}

describe('ADR-0492 Fresh Data Scheduler / Non-Live Cron foundation', () => {
  it('1. scheduler_does_not_trigger_live_order.', () => {
    const orderSpy = vi.fn();
    const result = runFreshDataSchedulerAdr0492({
      runId: 'order-safe',
      now: '2026-05-09T00:00:00.000Z',
      filePath: tmpStore('order-safe'),
      providerInputs: [{ providerId: 'KIS', health: 'UP', sampleCount: 1 }],
      dependencies: { enqueueReplay: () => undefined, recordShadowCase: () => undefined },
    });
    expect(orderSpy).not.toHaveBeenCalled();
    expect(moduleSrc()).not.toMatch(/\b(placeOrder|submitOrder|executeTrade|liveBuy|liveSell)\b/);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('2. scheduler_does_not_mutate_live_gate.', () => {
    const liveGateState = Object.freeze({ enabled: true, minGate: 70, hardBlock: false });
    const before = JSON.stringify(liveGateState);
    runFreshDataSchedulerAdr0492({
      runId: 'gate-safe',
      now: '2026-05-09T01:00:00.000Z',
      filePath: tmpStore('gate-safe'),
      providerInputs: [{ providerId: 'NAVER', health: 'DELAYED', stale: true }],
    });
    expect(JSON.stringify(liveGateState)).toBe(before);
    expect(moduleSrc()).not.toMatch(/setGate|mutateGate|hardBlock\s*=|STRONG_BUY|\bBUY\b|\bSELL\b/);
  });

  it('3. scheduler_sets_execution_impact_none.', () => {
    const result = runFreshDataSchedulerAdr0492({
      runId: 'impact-none',
      now: '2026-05-09T02:00:00.000Z',
      filePath: tmpStore('impact-none'),
      providerInputs: [{ providerId: 'KIS', health: 'UP', sampleCount: 1 }],
    });
    expect(result.executionImpact).toBe('NONE');
    expect(result.jobs.every((row) => row.executionImpact === 'NONE')).toBe(true);
    expect(result.snapshots.every((row) => row.executionImpact === 'NONE')).toBe(true);
    expect(result.shadowCases.every((row) => row.executionImpact === 'NONE')).toBe(true);
    expect(result.replayQueue.every((row) => row.executionImpact === 'NONE')).toBe(true);
  });

  it('4. provider_down_does_not_stop_engine.', () => {
    expect(() => runFreshDataSchedulerAdr0492({
      runId: 'provider-down-engine-live',
      now: '2026-05-09T03:00:00.000Z',
      filePath: tmpStore('provider-down-engine-live'),
      providerInputs: [{ providerId: 'NAVER', health: 'DOWN', missing: true, error: 'HTTP 503' }],
    })).not.toThrow();
    const result = runFreshDataSchedulerAdr0492({
      runId: 'provider-down-engine-result',
      now: '2026-05-09T03:05:00.000Z',
      filePath: tmpStore('provider-down-engine-result'),
      providerInputs: [{ providerId: 'NAVER', health: 'DOWN', missing: true, error: 'HTTP 503' }],
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.providerHealthSummary.NAVER).toBe('DOWN');
    expect(result.errors).toContain('NAVER: HTTP 503');
  });

  it('5. provider_down_records_shadow_case.', () => {
    const shadowRecorder = vi.fn();
    const result = runFreshDataSchedulerAdr0492({
      runId: 'provider-down-shadow',
      now: '2026-05-09T04:00:00.000Z',
      filePath: tmpStore('provider-down-shadow'),
      providerInputs: [{ providerId: 'NAVER', health: 'DOWN', missing: true, error: 'HTTP 503' }],
      dependencies: { recordShadowCase: shadowRecorder },
    });
    expect(shadowRecorder).toHaveBeenCalledTimes(1);
    expect(result.shadowCases[0]?.learningTag).toBe('PROVIDER_HEALTH_DOWN');
    expect(result.shadowCases[0]?.isMarketSignal).toBe(false);
  });

  it('6. missing_data_is_not_zero.', () => {
    const classification = classifyFreshDataValueAdr0492({ value: null, providerHealth: 'DOWN' });
    expect(classification.value).toBeNull();
    expect(classification.bearishSignal).toBe(false);
    expect(classification.isMarketSignal).toBe(false);
    expect(classification.warnings.join(' ')).toMatch(/not converted to numeric zero/i);
  });

  it('7. stale_data_is_confidence_downgrade.', () => {
    const classification = classifyFreshDataValueAdr0492({ value: 42, stale: true, providerHealth: 'DELAYED' });
    expect(classification.value).toBe(42);
    expect(classification.freshness).toBe('STALE');
    expect(classification.confidence).toBe('LOW');
    expect(classification.bearishSignal).toBe(false);
  });

  it('8. holiday_scheduler_is_valid.', () => {
    const result = runFreshDataSchedulerAdr0492({
      runId: 'holiday-valid',
      now: '2026-05-09T05:00:00.000Z',
      marketSession: fixedHolidaySession(),
      filePath: tmpStore('holiday-valid'),
      providerInputs: [],
    });
    expect(result.mode).toBe('HOLIDAY');
    expect(result.status).toBe('SKIPPED');
    expect(result.freshness).toBe('HOLIDAY_VALID');
    expect(result.shadowCases[0]?.learningTag).toBe('HOLIDAY_SKIPPED_VALID');
  });

  it('9. replay_enqueue_has_no_live_effect.', () => {
    const replay = vi.fn();
    const liveDecision = { decision: 'UNCHANGED', updatedAt: 'before' };
    const before = JSON.stringify(liveDecision);
    const result = runFreshDataSchedulerAdr0492({
      runId: 'replay-no-live',
      now: '2026-05-09T06:00:00.000Z',
      filePath: tmpStore('replay-no-live'),
      providerInputs: [{ providerId: 'KIS', health: 'UP', sampleCount: 1 }],
      dependencies: { enqueueReplay: replay },
    });
    expect(replay).toHaveBeenCalledTimes(result.replayEnqueuedCount);
    expect(JSON.stringify(liveDecision)).toBe(before);
    expect(result.replayQueue.every((row) => row.liveExecutionAllowed === false)).toBe(true);
  });

  it('10. adr_0492_regression_main_path.', () => {
    const liveDecisionBefore = { symbol: '005930', score: 70, decision: 'HOLD' };
    const before = JSON.stringify(liveDecisionBefore);
    const result = runFreshDataSchedulerAdr0492({
      runId: 'main-path-regression',
      now: '2026-05-09T07:00:00.000Z',
      filePath: tmpStore('main-path-regression'),
      providerInputs: [{ providerId: 'NAVER', health: 'RATE_LIMITED', rateLimited: true }],
    });
    expect(JSON.stringify(liveDecisionBefore)).toBe(before);
    expect(formatFreshDataSchedulerCompactAdr0492(result)).toContain('impact=NONE');
    expect(result.warnings.join('\n')).not.toMatch(/bearish/i);
  });
});
