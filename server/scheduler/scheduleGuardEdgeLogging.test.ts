/**
 * @responsibility scheduleGuard edge-trigger logging 회귀 테스트 (ADR-0132)
 *
 * `_lastSkipLogged` Map 기반 jobName + reason 별 SKIP 로깅 1회 보장 + 상태 전환 시 재로깅.
 * `recordScheduleRun` 메트릭은 매 호출 갱신 (영속 SSOT 정밀도 보존).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  shouldEmitSkipLog,
  clearSkipEdgeState,
  __resetEdgeLoggingForTests,
} from './scheduleGuard.js';

describe('shouldEmitSkipLog — ADR-0132 edge-trigger logging', () => {
  beforeEach(() => {
    __resetEdgeLoggingForTests();
    delete process.env.SCHEDULE_EDGE_LOGGING_DISABLED;
  });

  afterEach(() => {
    delete process.env.SCHEDULE_EDGE_LOGGING_DISABLED;
  });

  it('첫 SKIP 호출 → true (로깅 발행)', () => {
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
  });

  it('동일 jobName + 동일 reason 연속 호출 → false (silent)', () => {
    shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY');
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
  });

  it('동일 jobName + 다른 reason 전환 시 → true (전환점 로깅)', () => {
    shouldEmitSkipLog('orchestrator_tick', 'WEEKEND');
    // WEEKEND → LONG_HOLIDAY 전환
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
    // 동일 LONG_HOLIDAY 연속 → silent
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
  });

  it('clearSkipEdgeState 호출 후 → 다음 SKIP 재로깅 (success → skipped 사이클)', () => {
    shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY');
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
    // success 시뮬 — Map 클리어
    clearSkipEdgeState('orchestrator_tick');
    // 다음 SKIP 호출은 재로깅
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
  });

  it('다중 jobName 독립 — 한 잡의 silent 가 다른 잡에 영향 없음', () => {
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
    expect(shouldEmitSkipLog('oco_confirm', 'LONG_HOLIDAY')).toBe(true);
    expect(shouldEmitSkipLog('dart_fast_check', 'LONG_HOLIDAY')).toBe(true);
    // 두 번째 호출 — 모두 silent
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
    expect(shouldEmitSkipLog('oco_confirm', 'LONG_HOLIDAY')).toBe(false);
    expect(shouldEmitSkipLog('dart_fast_check', 'LONG_HOLIDAY')).toBe(false);
  });

  it('SCHEDULE_EDGE_LOGGING_DISABLED=true → 모든 SKIP 발행 (디버깅용)', () => {
    process.env.SCHEDULE_EDGE_LOGGING_DISABLED = 'true';
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
  });

  it('clearSkipEdgeState 미존재 jobName 호출 안전 (no-op)', () => {
    expect(() => clearSkipEdgeState('nonexistent_job')).not.toThrow();
    // 그 후 정상 동작
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
  });

  it('__resetEdgeLoggingForTests — 테스트 격리 SSOT', () => {
    shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY');
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(false);
    __resetEdgeLoggingForTests();
    // reset 후 첫 SKIP 은 다시 발행
    expect(shouldEmitSkipLog('orchestrator_tick', 'LONG_HOLIDAY')).toBe(true);
  });
});
