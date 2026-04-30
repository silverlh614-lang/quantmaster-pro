// @responsibility ADR-0131 — SCHEDULE_CATALOG 6 항목 등록 + silentWhen 명시 회귀 가드
import { describe, it, expect } from 'vitest';
import { SCHEDULE_CATALOG } from './scheduleCatalog.js';

const REQUIRED_JOB_NAMES = [
  'health_loop_tier1',
  'health_loop_tier2',
  'health_loop_tier3',
  'credential_expiry_watchdog',
  'post_holiday_kickstart',
  'post_holiday_followup',
];

describe('ADR-0131 — SCHEDULE_CATALOG 6 신규 jobName 등록', () => {
  it.each(REQUIRED_JOB_NAMES)('%s 등록 + silentWhen 명시', (jobName) => {
    const entry = SCHEDULE_CATALOG.find((e) => e.jobName === jobName);
    expect(entry, `${jobName} 가 SCHEDULE_CATALOG 에 부재`).toBeDefined();
    expect(entry!.silentWhen, `${jobName} silentWhen 미명시`).toBeDefined();
  });

  it('6 신규 jobName 모두 group=maintenance', () => {
    for (const jobName of REQUIRED_JOB_NAMES) {
      const entry = SCHEDULE_CATALOG.find((e) => e.jobName === jobName);
      expect(entry?.group).toBe('maintenance');
    }
  });

  it('Tier 1/2 timeKst="상시" + Tier 3/Credential/PostHoliday 시각 명시', () => {
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'health_loop_tier1')?.timeKst).toBe('상시');
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'health_loop_tier2')?.timeKst).toBe('상시');
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'health_loop_tier3')?.timeKst).toBe('09:00');
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'credential_expiry_watchdog')?.timeKst).toBe('09:30');
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'post_holiday_kickstart')?.timeKst).toBe('07:30');
    expect(SCHEDULE_CATALOG.find((e) => e.jobName === 'post_holiday_followup')?.timeKst).toBe('08:30');
  });
});
