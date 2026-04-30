// @responsibility 서킷 카운트 BE 제외 회귀 테스트 — ADR-0112 (1차 로그 시뮬)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { countRecentConsecutiveLosses } from './shadowResolverJob.js';
import * as learningState from '../learning/learningState.js';

type ShadowTrade = Parameters<typeof countRecentConsecutiveLosses>[0][number];

const ORIGINAL_BE_ENV = process.env.BE_CLASSIFICATION_DISABLED;

beforeEach(() => {
  delete process.env.BE_CLASSIFICATION_DISABLED;
  // baseline 미설정 — 4시간 윈도우 만 작동
  vi.spyOn(learningState, 'getCircuitBreakerClearedAt').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_BE_ENV === undefined) delete process.env.BE_CLASSIFICATION_DISABLED;
  else process.env.BE_CLASSIFICATION_DISABLED = ORIGINAL_BE_ENV;
});

function makeShadow(opts: {
  id: string;
  status: ShadowTrade['status'];
  exitOutcome?: ShadowTrade['exitOutcome'];
  exitTimeMinutesAgo: number;
}): ShadowTrade {
  const exitTime = new Date(Date.now() - opts.exitTimeMinutesAgo * 60_000).toISOString();
  return {
    id: opts.id,
    stockCode: opts.id,
    stockName: opts.id,
    signalTime: exitTime,
    signalPrice: 10000,
    shadowEntryPrice: 10000,
    quantity: 0,
    stopLoss: 9300,
    targetPrice: 11500,
    status: opts.status,
    exitOutcome: opts.exitOutcome,
    exitTime,
  } as unknown as ShadowTrade;
}

describe('countRecentConsecutiveLosses — ADR-0112 BE 제외', () => {
  it('1차 로그 정확 시뮬: PROFIT_PROTECTION 3건 모두 BE → consec=0', () => {
    // 09:10/09:15/09:45 KST = 0:10/0:15/0:45 UTC. 모두 BE 분류.
    const shadows = [
      makeShadow({ id: '192820', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: '161890', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 25 }),
      makeShadow({ id: '383310', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 1 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });

  it('진짜 손절 3건 (LOSS) → consec=3 (서킷 발동)', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 25 }),
      makeShadow({ id: 'C', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 1 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(3);
  });

  it('BE 1건 + LOSS 2건 (가장 최근 BE) → consec=0 (가장 최근부터 break)', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 60 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: 'C', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 5 }),
    ];
    // 정렬: C(가장 최근) → B → A. C 가 BE → 즉시 break → consec=0
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });

  it('LOSS 2건 + BE 1건 (가장 최근 LOSS) → consec=2 (BE 직전까지)', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 60 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: 'C', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 5 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(2);
  });

  it('exitOutcome 미설정 (legacy/v1 trade) → LOSS 로 간주 (후방 호환)', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitTimeMinutesAgo: 5 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(2);
  });

  it('HIT_TARGET 은 카운트 안 됨 (기존 동작 보존)', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: 'B', status: 'HIT_TARGET', exitOutcome: 'WIN', exitTimeMinutesAgo: 5 }),
    ];
    // 가장 최근이 HIT_TARGET → 즉시 break → consec=0
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });

  it('4시간 윈도우 밖 손절은 무시', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 5 * 60 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 5 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(1);
  });

  it('ADR-0111 baseline reset 정합 — clearedAt 이 4시간보다 최근이면 그 이후만 카운트', () => {
    // baseline 1시간 전 — A 는 baseline 이전, B 만 카운트
    const baselineMs = Date.now() - 60 * 60_000;
    vi.spyOn(learningState, 'getCircuitBreakerClearedAt').mockReturnValue(
      new Date(baselineMs).toISOString(),
    );
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 90 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
    ];
    expect(countRecentConsecutiveLosses(shadows)).toBe(1);
  });

  it('ADR-0111 baseline + ADR-0112 BE 결합: baseline 이후 BE 1 + LOSS 1 → consec=0', () => {
    const baselineMs = Date.now() - 2 * 60 * 60_000;
    vi.spyOn(learningState, 'getCircuitBreakerClearedAt').mockReturnValue(
      new Date(baselineMs).toISOString(),
    );
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 60 }),
      makeShadow({ id: 'B', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 5 }),
    ];
    // 가장 최근 BE → 즉시 break
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });

  it('ENV BE_CLASSIFICATION_DISABLED=true → 기존 동작 (BE 도 카운트)', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    const shadows = [
      makeShadow({ id: '192820', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 30 }),
      makeShadow({ id: '161890', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 25 }),
      makeShadow({ id: '383310', status: 'HIT_STOP', exitOutcome: 'BE', exitTimeMinutesAgo: 1 }),
    ];
    // ENV 우회 — 1차 로그 시점 동작 복원 (서킷 발동)
    expect(countRecentConsecutiveLosses(shadows)).toBe(3);
  });

  it('exitTime 부재 trade 는 무시', () => {
    const shadows = [
      makeShadow({ id: 'A', status: 'HIT_STOP', exitOutcome: 'LOSS', exitTimeMinutesAgo: 30 }),
    ];
    const noExitTime = { ...shadows[0], exitTime: undefined };
    expect(countRecentConsecutiveLosses([noExitTime as unknown as ShadowTrade])).toBe(0);
  });

  it('빈 shadows → 0', () => {
    expect(countRecentConsecutiveLosses([])).toBe(0);
  });
});
