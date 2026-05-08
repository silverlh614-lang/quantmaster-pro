// @responsibility ADR-452 empty scan taxonomy 회귀 테스트
import { describe, expect, it } from 'vitest';
import {
  classifyEmptyScan,
  getKstIntradaySession,
  isBuySessionKst,
  shouldCountEmptyScan,
} from './emptyScanTaxonomy.js';

function kstTime(hour: number, minute: number): Date {
  // 2026-05-08은 금요일. helper가 UTC+9로 KST를 계산하므로 UTC는 -9h.
  return new Date(Date.UTC(2026, 4, 8, hour - 9, minute, 0));
}

describe('ADR-452 KST buy session helper', () => {
  it('09:00~09:30은 OPENING_GUARD / buySession=false', () => {
    const now = kstTime(9, 15);
    expect(getKstIntradaySession(now)).toBe('OPENING_GUARD');
    expect(isBuySessionKst(now)).toBe(false);
  });

  it('09:30~11:30은 MORNING_BUY / buySession=true', () => {
    const now = kstTime(10, 0);
    expect(getKstIntradaySession(now)).toBe('MORNING_BUY');
    expect(isBuySessionKst(now)).toBe(true);
  });

  it('11:30~13:00은 LUNCH_GUARD / buySession=false', () => {
    const now = kstTime(11, 45);
    expect(getKstIntradaySession(now)).toBe('LUNCH_GUARD');
    expect(isBuySessionKst(now)).toBe(false);
  });

  it('13:00~15:20은 AFTERNOON_BUY / buySession=true', () => {
    const now = kstTime(14, 30);
    expect(getKstIntradaySession(now)).toBe('AFTERNOON_BUY');
    expect(isBuySessionKst(now)).toBe(true);
  });

  it('15:20~15:30은 CLOSING_PREP / buySession=false', () => {
    const now = kstTime(15, 25);
    expect(getKstIntradaySession(now)).toBe('CLOSING_PREP');
    expect(isBuySessionKst(now)).toBe(false);
  });
});

describe('ADR-452 shouldCountEmptyScan', () => {
  it('NORMAL + BUY 세션에서만 true', () => {
    expect(shouldCountEmptyScan(kstTime(10, 0), 'NORMAL')).toBe(true);
    expect(shouldCountEmptyScan(kstTime(14, 0), 'DEGRADED')).toBe(true);
  });

  it('SELL_ONLY/session-blocked에서는 false', () => {
    expect(shouldCountEmptyScan(kstTime(10, 0), 'SELL_ONLY')).toBe(false);
    expect(shouldCountEmptyScan(kstTime(9, 15), 'NORMAL')).toBe(false);
    expect(shouldCountEmptyScan(kstTime(11, 45), 'NORMAL')).toBe(false);
    expect(shouldCountEmptyScan(kstTime(15, 25), 'NORMAL')).toBe(false);
  });
});

describe('ADR-452 classifyEmptyScan', () => {
  it('session blocked가 true empty보다 우선한다', () => {
    const r = classifyEmptyScan({ now: kstTime(9, 15), engineMode: 'NORMAL' });
    expect(r.type).toBe('SESSION_BLOCKED');
    expect(r.incrementEmptyScan).toBe(false);
  });

  it('mode blocked가 true empty보다 우선한다', () => {
    const r = classifyEmptyScan({ now: kstTime(10, 0), engineMode: 'SHADOW_ONLY' });
    expect(r.type).toBe('MODE_BLOCKED');
    expect(r.incrementEmptyScan).toBe(false);
  });

  it('대기 후보가 있으면 WAIT_TRIGGER로 분류하고 empty streak를 올리지 않는다', () => {
    const r = classifyEmptyScan({
      now: kstTime(10, 0),
      engineMode: 'NORMAL',
      candidateCount: 5,
      waitTriggerCount: 3,
    });
    expect(r.type).toBe('WAIT_TRIGGER');
    expect(r.incrementEmptyScan).toBe(false);
  });

  it('데이터 차단 후보가 있으면 DATA_BLOCKED로 분류하고 empty streak를 올리지 않는다', () => {
    const r = classifyEmptyScan({
      now: kstTime(10, 0),
      engineMode: 'NORMAL',
      candidateCount: 5,
      dataBlockedCount: 2,
    });
    expect(r.type).toBe('DATA_BLOCKED');
    expect(r.incrementEmptyScan).toBe(false);
  });

  it('BUY 세션 + NORMAL + 후보 없음일 때만 TRUE_EMPTY로 카운트한다', () => {
    const r = classifyEmptyScan({ now: kstTime(10, 0), engineMode: 'NORMAL' });
    expect(r.type).toBe('TRUE_EMPTY');
    expect(r.incrementEmptyScan).toBe(true);
  });
});
