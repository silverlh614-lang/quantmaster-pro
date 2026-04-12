import { describe, expect, it } from 'vitest';
import { addBusinessDaysFromKstDate, evaluateTrancheRevalidation } from './trancheExecutor.js';
import { KRX_HOLIDAYS } from './krxHolidays.js';

describe('addBusinessDaysFromKstDate', () => {
  it('skips weekends when calculating tranche dates', () => {
    // 2026-04-10: Friday
    const result = addBusinessDaysFromKstDate('2026-04-10', 3, new Set<string>());
    expect(result).toBe('2026-04-15');
  });

  it('skips configured KRX closed days as non-business days', () => {
    const result = addBusinessDaysFromKstDate(
      '2026-04-13',
      3,
      new Set<string>(['2026-04-14']) // Tue closed
    );
    expect(result).toBe('2026-04-17');
  });
});

describe('evaluateTrancheRevalidation', () => {
  it('rejects tranche when cascade/add-buy-block state is active', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_200,
      entryPrice: 10_000,
      stopLoss: 9_400,
      currentRegime: 'R3_PULLBACK',
      entryRegime: 'R2_BULL',
      cascadeStep: 1,
      addBuyBlocked: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('차단');
  });

  it('rejects tranche when regime has deteriorated from entry', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_300,
      entryPrice: 10_000,
      stopLoss: 9_300,
      currentRegime: 'R4_NEUTRAL',
      entryRegime: 'R2_BULL',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('진입 레짐');
  });

  it('passes when tranche conditions are healthy', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_300,
      entryPrice: 10_000,
      stopLoss: 9_200,
      currentRegime: 'R2_BULL',
      entryRegime: 'R2_BULL',
      cascadeStep: 0,
      addBuyBlocked: false,
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe('KRX_HOLIDAYS', () => {
  it('covers known 2026 national holidays', () => {
    expect(KRX_HOLIDAYS.has('2026-01-01')).toBe(true); // 신정
    expect(KRX_HOLIDAYS.has('2026-09-25')).toBe(true); // 추석
    expect(KRX_HOLIDAYS.has('2026-12-25')).toBe(true); // 성탄절
  });

  it('covers known 2027 national holidays', () => {
    expect(KRX_HOLIDAYS.has('2027-01-01')).toBe(true); // 신정
    expect(KRX_HOLIDAYS.has('2027-09-15')).toBe(true); // 추석
    expect(KRX_HOLIDAYS.has('2027-12-25')).toBe(true); // 성탄절
  });

  it('skips KRX holidays when calculating business days', () => {
    // 2026-05-04 (Mon) + 3영업일: 05-05는 어린이날(KRX 휴장), 건너뛰어야 함
    const result = addBusinessDaysFromKstDate('2026-05-04', 3, KRX_HOLIDAYS);
    expect(result).toBe('2026-05-08'); // 05-05(휴장), 06(수), 07(목), 08(금)
  });
});
