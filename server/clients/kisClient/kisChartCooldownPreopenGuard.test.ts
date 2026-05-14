// @responsibility KIS chart cooldown key/status 회귀 테스트
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __testOnlyRecordKisChartCooldown,
  __testOnlyResetKisChartCooldowns,
  isKisChartCooldownActive,
} from './http.js';
import { classifyKisRealDataError } from './realDataNoiseStore.js';

describe('KIS chart 404/500 cooldown + no market contamination', () => {
  beforeEach(() => {
    __testOnlyResetKisChartCooldowns();
  });

  it('C. FHKST03010100 500 은 symbol+period+purpose 키 cooldown 으로 재호출 skip', () => {
    const cooldownMs = __testOnlyRecordKisChartCooldown({
      symbol: '000370',
      period: 'D',
      purpose: 'FINAL_SCREEN_FALLBACK',
      status: 500,
    });
    expect(cooldownMs).toBe(300_000);
    expect(isKisChartCooldownActive('000370', 'D', 'FINAL_SCREEN_FALLBACK')).toBe(true);
    expect(isKisChartCooldownActive('000370', 'W', 'FINAL_SCREEN_FALLBACK')).toBe(false);
    expect(isKisChartCooldownActive('000370', 'D', 'OPEN_POSITION')).toBe(false);
  });

  it('D/G. FHPST01710000 404 는 providerIssue 로만 분류되고 DATA_VACUUM/BUY_BLOCK 승격 필드가 없다', () => {
    const classified = classifyKisRealDataError({
      endpoint: 'FHPST01710000',
      httpStatus: 404,
    });
    expect(classified.providerIssue).toBe(true);
    expect(classified.marketSignal).toBe(false);
    expect(classified.executionImpact).toBe('NONE');
    expect(JSON.stringify(classified)).not.toContain('DATA_VACUUM_ROOT_CAUSE');
    expect(JSON.stringify(classified)).not.toContain('NEW_BUY_BLOCKED');
  });

  it('F. 반복 신규 후보 chart 500 은 cooldown/dedup 용 suppressed compact log 경로를 사용한다', () => {
    __testOnlyRecordKisChartCooldown({ symbol: '000370', period: 'D', purpose: 'P3_DIAGNOSTIC', status: 500 });
    expect(isKisChartCooldownActive('000370', 'D', 'P3_DIAGNOSTIC')).toBe(true);
  });
});
