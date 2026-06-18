// @responsibility ADR-0634 autoActivationStreakRepo 회귀 테스트 — dateKey 멱등·연속 증가·not-ready 리셋·self-heal(부재/손상→빈 store)·getConsecutiveReadyDays. 임시 파일 격리.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadAutoActivationStreaks,
  recordLeverReadiness,
  getConsecutiveReadyDays,
  __resetAutoActivationStreaksForTests,
} from './autoActivationStreakRepo.js';

const TMP_FILE = path.join(
  os.tmpdir(),
  `auto-activation-streak-test-${process.pid}-${Date.now()}.json`,
);

const LEVER = 'PRICE_CORRECTION_SHADOW_ADR0623';

beforeEach(() => {
  __resetAutoActivationStreaksForTests(TMP_FILE);
});

afterEach(() => {
  __resetAutoActivationStreaksForTests(TMP_FILE);
});

describe('autoActivationStreakRepo — self-heal (부재/손상 → 빈 store)', () => {
  it('파일 부재 → loadAutoActivationStreaks 빈 store, getConsecutiveReadyDays 0', () => {
    expect(loadAutoActivationStreaks(TMP_FILE)).toEqual({});
    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(0);
  });

  it('손상 JSON → 빈 store self-heal (throw 0)', () => {
    fs.writeFileSync(TMP_FILE, '{ this is not valid json');
    expect(loadAutoActivationStreaks(TMP_FILE)).toEqual({});
    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(0);
  });

  it('형 불일치 JSON(배열) → 빈 store self-heal', () => {
    fs.writeFileSync(TMP_FILE, '[1,2,3]');
    expect(loadAutoActivationStreaks(TMP_FILE)).toEqual({});
  });
});

describe('autoActivationStreakRepo — recordLeverReadiness 연속/리셋', () => {
  it('ready=true → 연속일마다 streak +1', () => {
    const r1 = recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    expect(r1).toEqual({ leverId: LEVER, streak: 1, updatedToday: true, lastDateKey: '2026-06-15' });

    const r2 = recordLeverReadiness(LEVER, true, '2026-06-16', TMP_FILE);
    expect(r2.streak).toBe(2);
    expect(r2.updatedToday).toBe(true);

    const r3 = recordLeverReadiness(LEVER, true, '2026-06-17', TMP_FILE);
    expect(r3.streak).toBe(3);
    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(3);
  });

  it('not-ready 일 → streak 0 리셋 (anti-flap)', () => {
    recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    recordLeverReadiness(LEVER, true, '2026-06-16', TMP_FILE);
    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(2);

    const reset = recordLeverReadiness(LEVER, false, '2026-06-17', TMP_FILE);
    expect(reset.streak).toBe(0);
    expect(reset.updatedToday).toBe(true);
    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(0);
  });

  it('리셋 후 다시 ready → 1 부터 재증가', () => {
    recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    recordLeverReadiness(LEVER, false, '2026-06-16', TMP_FILE);
    const r = recordLeverReadiness(LEVER, true, '2026-06-17', TMP_FILE);
    expect(r.streak).toBe(1);
  });
});

describe('autoActivationStreakRepo — dateKey 멱등', () => {
  it('같은 dateKey 재호출 → streak 무증가, updatedToday=false', () => {
    const r1 = recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    expect(r1.streak).toBe(1);

    // 같은 날 재실행 (cron 재실행·startup 중복) — readyToday 와 무관하게 멱등 skip.
    const r2 = recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    expect(r2.streak).toBe(1);
    expect(r2.updatedToday).toBe(false);

    const r3 = recordLeverReadiness(LEVER, false, '2026-06-15', TMP_FILE);
    expect(r3.streak).toBe(1); // false 여도 같은 dateKey → 무접촉.
    expect(r3.updatedToday).toBe(false);

    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(1);
  });
});

describe('autoActivationStreakRepo — 다중 lever 독립 추적 + 영속', () => {
  it('서로 다른 lever 의 streak 가 독립적으로 유지·디스크 영속된다', () => {
    const other = 'TRADE_REPLACEMENT_SHADOW_EXECUTE_ADR0602';
    recordLeverReadiness(LEVER, true, '2026-06-15', TMP_FILE);
    recordLeverReadiness(other, true, '2026-06-15', TMP_FILE);
    recordLeverReadiness(LEVER, true, '2026-06-16', TMP_FILE);

    expect(getConsecutiveReadyDays(LEVER, TMP_FILE)).toBe(2);
    expect(getConsecutiveReadyDays(other, TMP_FILE)).toBe(1);

    // 디스크 재로드 — atomic write 영속 확인.
    const store = loadAutoActivationStreaks(TMP_FILE);
    expect(store[LEVER]).toEqual({ streak: 2, lastDateKey: '2026-06-16' });
    expect(store[other]).toEqual({ streak: 1, lastDateKey: '2026-06-15' });
  });
});
