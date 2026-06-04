import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 파일시스템 격리 — repo 를 mock 하고 가드 판정/스탬프 로직만 검증한다.
vi.mock('../persistence/takeProfitExitsRepo.js', () => ({
  lastTakeProfitExitForCode: vi.fn(),
  appendTakeProfitExit: vi.fn(),
}));

import {
  checkTakeProfitReentryGuard,
  isProfitExitReason,
  maybeStampTakeProfitReentryBarrier,
} from './takeProfitReentryGuard.js';
import {
  lastTakeProfitExitForCode,
  appendTakeProfitExit,
  type TakeProfitExitRecord,
} from '../persistence/takeProfitExitsRepo.js';

const mockedLast = vi.mocked(lastTakeProfitExitForCode);
const mockedAppend = vi.mocked(appendTakeProfitExit);

function barrier(over: Partial<TakeProfitExitRecord> = {}): TakeProfitExitRecord {
  return {
    stockCode: '007390',
    stockName: '네이처셀',
    exitPrice: 10000,
    exitGateScore: 7,
    exitReturnPct: 12,
    exitReason: 'TAKE_PROFIT',
    exitAt: '2026-06-04T05:00:00.000Z',
    ...over,
  };
}

describe('takeProfitReentryGuard (ADR-0569)', () => {
  const ORIG = process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED = 'true';
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED;
    else process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED = ORIG;
  });

  describe('checkTakeProfitReentryGuard', () => {
    it('flag OFF → 항상 허용 + 조회조차 안 함(byte-identical)', () => {
      process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED = 'false';
      mockedLast.mockReturnValue(barrier());
      expect(checkTakeProfitReentryGuard('007390', 10000, 5).blocked).toBe(false);
      expect(mockedLast).not.toHaveBeenCalled();
    });

    it('최근 익절 barrier 없음 → 허용', () => {
      mockedLast.mockReturnValue(null);
      expect(checkTakeProfitReentryGuard('007390', 10000, 5).blocked).toBe(false);
    });

    it('가격 +5% 미달 + 게이트 미상향 → 차단 (네이처셀 사례)', () => {
      mockedLast.mockReturnValue(barrier({ exitPrice: 10000, exitGateScore: 7 }));
      const d = checkTakeProfitReentryGuard('007390', 10400, 7); // +4% < 5%, gate 7 < 7+1
      expect(d.blocked).toBe(true);
      expect(d.priceConditionMet).toBe(false);
      expect(d.gateConditionMet).toBe(false);
    });

    it('청산가 +5% 정확 재돌파 → 허용', () => {
      mockedLast.mockReturnValue(barrier({ exitPrice: 10000 }));
      const d = checkTakeProfitReentryGuard('007390', 10500, 5);
      expect(d.blocked).toBe(false);
      expect(d.priceConditionMet).toBe(true);
    });

    it('게이트 +1 상향 → 허용(가격 평행이어도)', () => {
      mockedLast.mockReturnValue(barrier({ exitPrice: 10000, exitGateScore: 7 }));
      const d = checkTakeProfitReentryGuard('007390', 10000, 8); // gate 8 >= 7+1
      expect(d.blocked).toBe(false);
      expect(d.gateConditionMet).toBe(true);
    });

    it('exitGateScore null(레거시 포지션) → 게이트 조건 평가불가, 가격만 작동', () => {
      mockedLast.mockReturnValue(barrier({ exitGateScore: null, exitPrice: 10000 }));
      expect(checkTakeProfitReentryGuard('007390', 10000, 99).blocked).toBe(true); // 게이트 못 씀
      expect(checkTakeProfitReentryGuard('007390', 10500, 0).blocked).toBe(false); // 가격 충족
    });
  });

  it('isProfitExitReason: TAKE_PROFIT/EUPHORIA 만 true', () => {
    expect(isProfitExitReason('TAKE_PROFIT')).toBe(true);
    expect(isProfitExitReason('EUPHORIA')).toBe(true);
    expect(isProfitExitReason('STOP_LOSS')).toBe(false);
    expect(isProfitExitReason('MANUAL')).toBe(false);
  });

  describe('maybeStampTakeProfitReentryBarrier', () => {
    const base = {
      stockCode: '007390',
      stockName: '네이처셀',
      orderReason: 'TAKE_PROFIT',
      recorded: true,
      remainingQty: 0,
      exitPrice: 12000,
      exitGateScore: 7,
      exitReturnPct: 12,
    };

    it('익절 전량청산 → stamp 1건', () => {
      maybeStampTakeProfitReentryBarrier(base);
      expect(mockedAppend).toHaveBeenCalledTimes(1);
      expect(mockedAppend.mock.calls[0][0]).toMatchObject({
        stockCode: '007390',
        exitPrice: 12000,
        exitGateScore: 7,
        exitReason: 'TAKE_PROFIT',
      });
    });

    it('flag OFF → no stamp (byte-identical)', () => {
      process.env.TAKE_PROFIT_REENTRY_GUARD_ENABLED = 'false';
      maybeStampTakeProfitReentryBarrier(base);
      expect(mockedAppend).not.toHaveBeenCalled();
    });

    it('부분 청산(잔량>0) → no stamp', () => {
      maybeStampTakeProfitReentryBarrier({ ...base, remainingQty: 5 });
      expect(mockedAppend).not.toHaveBeenCalled();
    });

    it('STOP_LOSS(손실) → no stamp', () => {
      maybeStampTakeProfitReentryBarrier({ ...base, orderReason: 'STOP_LOSS' });
      expect(mockedAppend).not.toHaveBeenCalled();
    });

    it('미체결(recorded=false) → no stamp', () => {
      maybeStampTakeProfitReentryBarrier({ ...base, recorded: false });
      expect(mockedAppend).not.toHaveBeenCalled();
    });
  });
});
