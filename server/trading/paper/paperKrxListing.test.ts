// @responsibility Verify the KRX listing is judged against its refresh schedule, not a fixed age.
import { describe, expect, it } from 'vitest';
import { latestKrxMasterRefreshSlot, missedKrxMasterRefresh } from './paperKrxListing.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const friday19 = kst('2026-10-30T19:00:03').toISOString();

describe('KRX listing refresh schedule', () => {
  it('keeps the last trading day 19:00 refresh current through the weekend and Monday before 06:30', () => {
    expect(latestKrxMasterRefreshSlot(kst('2026-11-01T22:14:00'))?.toISOString()).toBe(kst('2026-10-30T19:00:00').toISOString());
    expect(missedKrxMasterRefresh(friday19, kst('2026-11-01T22:14:00'))).toBe(false);
    expect(missedKrxMasterRefresh(friday19, kst('2026-11-02T05:00:00'))).toBe(false);
    // A refresh still running inside the grace is not called missed.
    expect(missedKrxMasterRefresh(friday19, kst('2026-11-02T06:20:00'))).toBe(false);
  });

  it('flags a missed 06:00 or 19:00 refresh on a trading day and an unknown refresh time', () => {
    expect(missedKrxMasterRefresh(friday19, kst('2026-11-02T06:40:00'))).toBe(true);
    const monday06 = kst('2026-11-02T06:00:02').toISOString();
    expect(missedKrxMasterRefresh(monday06, kst('2026-11-02T16:10:00'))).toBe(false);
    expect(missedKrxMasterRefresh(monday06, kst('2026-11-02T19:40:00'))).toBe(true);
    expect(missedKrxMasterRefresh(null, kst('2026-11-02T16:10:00'))).toBe(true);
  });
});
