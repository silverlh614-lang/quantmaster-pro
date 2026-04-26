// @responsibility stopLossPolicyResolver 회귀 테스트 — CATALYST 고정 / SWING ATR 동적

import { describe, expect, it } from 'vitest';
import { stopLossPolicyResolver } from '../stopLossPolicyResolver.js';
import { CATALYST_FIXED_STOP_PCT } from '../../../../screener/watchlistManager.js';

describe('stopLossPolicyResolver', () => {
  it('CATALYST 섹션 — entryATR14=0 + catalystFixedStop 적용', () => {
    const out = stopLossPolicyResolver({
      profileType: 'A',
      section: 'CATALYST',
      regime: 'R2_BULL',
      shadowEntryPrice: 100_000,
      fallbackStopLoss: 95_000,
      reCheckQuoteAtr: 2_500, // 무시되어야 함
    });
    expect(out.profile).toBe('A');
    expect(out.profileKey).toBe('profileA');
    expect(out.isCatalyst).toBe(true);
    expect(out.regimeStopRate).toBe(CATALYST_FIXED_STOP_PCT);
    expect(out.entryATR14).toBe(0);
    expect(out.catalystFixedStop).toBe(Math.round(100_000 * (1 + CATALYST_FIXED_STOP_PCT)));
    expect(out.stopLossPlan.hardStopLoss).toBe(out.catalystFixedStop);
  });

  it('SWING/일반 섹션 — ATR 적용 + fallbackStopLoss 사용', () => {
    const out = stopLossPolicyResolver({
      profileType: 'B',
      section: 'SWING',
      regime: 'R2_BULL',
      shadowEntryPrice: 100_000,
      fallbackStopLoss: 92_000,
      reCheckQuoteAtr: 2_000,
    });
    expect(out.isCatalyst).toBe(false);
    expect(out.entryATR14).toBe(2_000);
    expect(out.catalystFixedStop).toBe(92_000);
    expect(out.profileKey).toBe('profileB');
  });

  it('profileType 미설정 — 기본 B', () => {
    const out = stopLossPolicyResolver({
      regime: 'R2_BULL',
      shadowEntryPrice: 100_000,
      fallbackStopLoss: 92_000,
    });
    expect(out.profile).toBe('B');
    expect(out.profileKey).toBe('profileB');
  });

  it('reCheckQuoteAtr 미전달 — entryATR14=0 (SWING)', () => {
    const out = stopLossPolicyResolver({
      profileType: 'C',
      section: 'SWING',
      regime: 'R2_BULL',
      shadowEntryPrice: 100_000,
      fallbackStopLoss: 92_000,
    });
    expect(out.entryATR14).toBe(0);
  });
});
