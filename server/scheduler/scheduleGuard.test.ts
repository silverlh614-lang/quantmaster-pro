/**
 * @responsibility scheduleGuard 회귀 테스트 — ScheduleClass 4분기 가드 + lastSkipReason 메트릭 (ADR-0043)
 *
 * cron.schedule wrap 자체는 통합 시 검증 (실제 cron 시각 트리거는 단위에서 mock 부담).
 * 본 파일은 `shouldSkipForScheduleClass` 순수 함수 + JobMetrics lastSkipReason 갱신 검증.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { shouldSkipForScheduleClass } from './scheduleGuard.js';
import {
  recordScheduleRun,
  getJobMetrics,
  __resetScheduleMetricsForTests,
} from './scheduleCatalog.js';

describe('shouldSkipForScheduleClass — ScheduleClass 4분기', () => {
  it('TRADING_DAY_ONLY + 평일 영업일 → skip=false', () => {
    expect(shouldSkipForScheduleClass('TRADING_DAY_ONLY', '2026-04-21')).toEqual({ skip: false });
  });

  it('TRADING_DAY_ONLY + 토요일 → skip=true reason=WEEKEND', () => {
    expect(shouldSkipForScheduleClass('TRADING_DAY_ONLY', '2026-04-25')).toEqual({
      skip: true,
      reason: 'WEEKEND',
    });
  });

  it('TRADING_DAY_ONLY + 일요일 → skip=true reason=WEEKEND', () => {
    expect(shouldSkipForScheduleClass('TRADING_DAY_ONLY', '2026-04-26')).toEqual({
      skip: true,
      reason: 'WEEKEND',
    });
  });

  it('TRADING_DAY_ONLY + 어린이날 5/5 → skip=true reason=KRX_HOLIDAY', () => {
    expect(shouldSkipForScheduleClass('TRADING_DAY_ONLY', '2026-05-05')).toEqual({
      skip: true,
      reason: 'KRX_HOLIDAY',
    });
  });

  it('TRADING_DAY_ONLY + 추석 9/24 (LONG_HOLIDAY) → skip=true reason=LONG_HOLIDAY', () => {
    expect(shouldSkipForScheduleClass('TRADING_DAY_ONLY', '2026-09-24')).toEqual({
      skip: true,
      reason: 'LONG_HOLIDAY',
    });
  });

  it('WEEKEND_MAINTENANCE + 토요일 → skip=false (실행 통과)', () => {
    expect(shouldSkipForScheduleClass('WEEKEND_MAINTENANCE', '2026-04-25')).toEqual({ skip: false });
  });

  it('WEEKEND_MAINTENANCE + 평일 영업일 → skip=true reason=TRADING_DAY', () => {
    expect(shouldSkipForScheduleClass('WEEKEND_MAINTENANCE', '2026-04-21')).toEqual({
      skip: true,
      reason: 'TRADING_DAY',
    });
  });

  it('WEEKEND_MAINTENANCE + 어린이날(평일 휴장) → skip=false (휴장도 통과)', () => {
    // KRX 공휴일은 WEEKEND_MAINTENANCE 입장에서 비영업일이라 통과.
    expect(shouldSkipForScheduleClass('WEEKEND_MAINTENANCE', '2026-05-05')).toEqual({ skip: false });
  });

  it('MARKET_ADJACENT — 영업일 통과, 비영업일 차단 (TRADING_DAY_ONLY 와 동일)', () => {
    expect(shouldSkipForScheduleClass('MARKET_ADJACENT', '2026-04-21')).toEqual({ skip: false });
    expect(shouldSkipForScheduleClass('MARKET_ADJACENT', '2026-04-25').skip).toBe(true);
  });

  it('ALWAYS_ON — 모든 날짜 통과', () => {
    expect(shouldSkipForScheduleClass('ALWAYS_ON', '2026-04-21')).toEqual({ skip: false });
    expect(shouldSkipForScheduleClass('ALWAYS_ON', '2026-04-25')).toEqual({ skip: false });
    expect(shouldSkipForScheduleClass('ALWAYS_ON', '2026-05-05')).toEqual({ skip: false });
  });
});

describe('JobMetrics.lastSkipReason — ScheduleGuard 통합', () => {
  beforeEach(() => {
    __resetScheduleMetricsForTests();
  });

  it('skipped 상태로 recordScheduleRun 호출 시 lastSkipReason 갱신', () => {
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-25T10:00:00Z',
      finishedAt: '2026-04-25T10:00:00Z',
      durationMs: 0,
      status: 'skipped',
      note: 'WEEKEND',
    });
    const m = getJobMetrics('test_job');
    expect(m).toBeDefined();
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBe('WEEKEND');
  });

  it('연속 스킵 시 lastSkipReason 가 가장 최근으로 갱신', () => {
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-25T10:00:00Z',
      finishedAt: '2026-04-25T10:00:00Z',
      durationMs: 0,
      status: 'skipped',
      note: 'WEEKEND',
    });
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-05-05T10:00:00Z',
      finishedAt: '2026-05-05T10:00:00Z',
      durationMs: 0,
      status: 'skipped',
      note: 'KRX_HOLIDAY',
    });
    const m = getJobMetrics('test_job');
    expect(m?.skippedCount).toBe(2);
    expect(m?.lastSkipReason).toBe('KRX_HOLIDAY');
  });

  it('skipped → success 전환 시 lastSkipReason 보존, lastSuccessAt 갱신', () => {
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-25T10:00:00Z',
      finishedAt: '2026-04-25T10:00:00Z',
      durationMs: 0,
      status: 'skipped',
      note: 'WEEKEND',
    });
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-27T10:00:00Z',
      finishedAt: '2026-04-27T10:00:01Z',
      durationMs: 1000,
      status: 'success',
    });
    const m = getJobMetrics('test_job');
    expect(m?.successCount).toBe(1);
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBe('WEEKEND'); // 보존
    expect(m?.lastSuccessAt).toBe('2026-04-27T10:00:01Z');
  });

  it('failure 는 lastSkipReason 변경 안 함', () => {
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-21T10:00:00Z',
      finishedAt: '2026-04-21T10:00:01Z',
      durationMs: 1000,
      status: 'failure',
      note: 'KIS API 503',
    });
    const m = getJobMetrics('test_job');
    expect(m?.failCount).toBe(1);
    expect(m?.lastErrorMessage).toBe('KIS API 503');
    expect(m?.lastSkipReason).toBeUndefined();
  });

  it('skipped + note 미전달 시 lastSkipReason 갱신 안 됨', () => {
    recordScheduleRun({
      jobName: 'test_job',
      startedAt: '2026-04-25T10:00:00Z',
      finishedAt: '2026-04-25T10:00:00Z',
      durationMs: 0,
      status: 'skipped',
      // note 없음
    });
    const m = getJobMetrics('test_job');
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBeUndefined();
  });
});
