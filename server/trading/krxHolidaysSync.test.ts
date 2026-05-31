/**
 * @responsibility krxHolidays.syncKisHolidayCalendar 회귀 테스트 — KIS chk-holiday L1 동기화 (ADR-0548)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 2028 은 STATIC_HOLIDAYS 에 없는 연도 → sync 가 실제 fetch 를 수행한다.
// (당해+차년도 = 2028+2029, 둘 다 STATIC 0개 → 둘 다 fetch 시도.)
const NOW_2028 = new Date('2028-06-15T00:00:00.000Z');

// query.js 동적 import(전체 KIS 모듈 그래프)는 첫 transform 이 느릴 수 있어 여유 timeout.
describe('krxHolidays.syncKisHolidayCalendar (ADR-0548)', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krx-holidays-sync-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.KIS_HOLIDAY_CALENDAR_ENABLED;
    // 오버라이드 초기화 — 다른 테스트로 누출 방지.
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({});
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('ENV OFF (미설정) → no-op early return, KIS 호출 0', async () => {
    const fetchSpy = vi.fn();
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({ fetchKisHolidayCalendar: fetchSpy });

    const { syncKisHolidayCalendar } = await import('./krxHolidays.js');
    const result = await syncKisHolidayCalendar({ now: NOW_2028 });

    expect(result).toEqual({ added: 0, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ENV ON + KIS opnd_yn=N 평일 → patch(addedBy:sync) 등록 + reload 반영', async () => {
    process.env.KIS_HOLIDAY_CALENDAR_ENABLED = 'true';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    // 2028-01-03(월) opnd_yn=N 휴장 / 2028-01-04(화) opnd_yn=Y 개장 → 휴장만 등록.
    setKisClientOverrides({
      fetchKisHolidayCalendar: vi.fn(async (bassDt: string) => {
        if (bassDt === '20280101') {
          return [
            { bassDt: '20280103', opndYn: 'N' },
            { bassDt: '20280104', opndYn: 'Y' },
          ];
        }
        return [];
      }),
    });

    const { syncKisHolidayCalendar, isKrxHoliday } = await import('./krxHolidays.js');
    const result = await syncKisHolidayCalendar({ now: NOW_2028 });

    expect(result.skipped).toBe(false);
    expect(result.added).toBe(1);
    expect(isKrxHoliday('2028-01-03')).toBe(true);
    expect(isKrxHoliday('2028-01-04')).toBe(false); // 개장일 미등록

    const { loadKrxHolidayPatchEntries } = await import('../persistence/krxHolidayRepo.js');
    const entry = loadKrxHolidayPatchEntries().find((e) => e.date === '2028-01-03');
    expect(entry?.addedBy).toBe('sync');
    expect(entry?.reason).toBe('KIS chk-holiday');
  });

  it('ENV ON 주말 휴장 row 는 patch 등록 제외 (비영업 ≠ 휴장)', async () => {
    process.env.KIS_HOLIDAY_CALENDAR_ENABLED = 'true';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    // 2028-01-08(토) opnd_yn=N — 주말이므로 patch 미등록.
    setKisClientOverrides({
      fetchKisHolidayCalendar: vi.fn(async () => [{ bassDt: '20280108', opndYn: 'N' }]),
    });

    const { syncKisHolidayCalendar, isKrxHoliday } = await import('./krxHolidays.js');
    const result = await syncKisHolidayCalendar({ now: NOW_2028 });

    expect(result.added).toBe(0);
    expect(isKrxHoliday('2028-01-08')).toBe(false);
  });

  it('idempotent — 두 번째 호출은 이미-등록 연도 skip(KIS 호출 0) + 추가 0', async () => {
    process.env.KIS_HOLIDAY_CALENDAR_ENABLED = 'true';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    // 한 연도에 충분(≥8)한 휴장일을 반환 → 다음 호출 시 skip 되도록.
    const days = Array.from({ length: 10 }, (_, i) => ({
      bassDt: `2028010${i}`.slice(0, 8).padEnd(8, '0'),
      opndYn: 'N',
    }));
    // 명시적으로 평일 10일치 (2028-01-03..-14 평일 중 일부) 생성.
    const weekdays = ['20280103', '20280104', '20280105', '20280106', '20280107',
      '20280110', '20280111', '20280112', '20280113', '20280114'];
    void days;
    const fetchSpy = vi.fn(async (bassDt: string) =>
      bassDt === '20280101' ? weekdays.map((d) => ({ bassDt: d, opndYn: 'N' })) : [],
    );
    setKisClientOverrides({ fetchKisHolidayCalendar: fetchSpy });

    const { syncKisHolidayCalendar } = await import('./krxHolidays.js');
    const first = await syncKisHolidayCalendar({ now: NOW_2028 });
    expect(first.added).toBe(10);

    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await syncKisHolidayCalendar({ now: NOW_2028 });
    expect(second.added).toBe(0);
    // 2028 은 이미 충분(≥8) → 2028 fetch skip. 2029 는 여전히 0개라 재시도되나 빈 배열.
    // 핵심: 이미-등록 연도(2028)에 대한 재호출이 없어야 한다.
    const calls2028After = fetchSpy.mock.calls.filter((c) => c[0] === '20280101').length;
    expect(calls2028After).toBe(1); // 첫 호출 1회뿐, 두 번째 sync 에서 2028 재호출 0
    void callsAfterFirst;
  });

  it('KIS 실패(null) → STATIC ∪ patch 안전망 유지 (불변식 #6, throw 없음)', async () => {
    process.env.KIS_HOLIDAY_CALENDAR_ENABLED = 'true';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisHolidayCalendar: vi.fn(async () => null),
    });

    const { syncKisHolidayCalendar, isKrxHoliday } = await import('./krxHolidays.js');
    const result = await syncKisHolidayCalendar({ now: NOW_2028 });

    expect(result.skipped).toBe(false);
    expect(result.added).toBe(0);
    // STATIC 휴장일(어린이날)은 KIS 실패와 무관하게 유지.
    expect(isKrxHoliday('2026-05-05')).toBe(true);
  });
});
