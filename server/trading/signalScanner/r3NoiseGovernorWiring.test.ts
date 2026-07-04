/**
 * @responsibility buildR3NoiseDecision 캘린더 실판정 회귀 가드 — 휴장일 streak 무누적 + 거래일 무회귀 (인시던트 20260704).
 *
 * Fix A (architect contract §A/§C-1): r3NoiseGovernorWiring 의 `isKrxTradingDay: true`
 * 하드코딩("persistScanResults 도달 = preflight 통과 = KRX 거래일" — 전제 오류) 제거 후,
 * krxTradingCalendar façade 실판정으로 교체된 동작을 밀폐 검증한다.
 * 캘린더는 vi.mock 으로 격리 — 실 휴일 데이터/네트워크/DATA_DIR 비의존.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 캘린더 façade 밀폐 mock — 실 krxHolidays SSOT(정적 휴일셋 ∪ patch ∪ KIS sync) 미로딩.
vi.mock('../../calendar/krxTradingCalendar.js', () => ({
  isKrxTradingDay: vi.fn().mockReturnValue(true),
}));

import { buildR3NoiseDecision, type R3NoiseWiringInput } from './r3NoiseGovernorWiring.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

const mockedIsKrxTradingDay = vi.mocked(isKrxTradingDay);

/** healthy 최소 입력 합성 — gate1Pass=0 + shadowObservable 0 + macro 게이트 전부 비활성. */
function makeInput(overrides: Partial<R3NoiseWiringInput> = {}): R3NoiseWiringInput {
  return {
    summary: {
      candidates: 1,
      gatePassDistribution: { gate1Pass: 0 },
      shadowObservableCount: 0,
    } as unknown as R3NoiseWiringInput['summary'],
    options: {} as R3NoiseWiringInput['options'],
    // KST-shift Date (persistScanResults.ts:231 관례: Date.now() + 9h)
    kstNow: new Date('2026-07-04T10:00:00.000Z'),
    ...overrides,
  };
}

describe('buildR3NoiseDecision — 캘린더 실판정 (Fix A, 인시던트 20260704)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsKrxTradingDay.mockReturnValue(true);
    delete process.env.R3_NOISE_GOVERNOR_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('A1: 휴장일(isKrxTradingDay=false) gate1Pass=0 → cause=UNKNOWN, streakImpact=0, liveBlockPreserved=true', () => {
    mockedIsKrxTradingDay.mockReturnValue(false);
    const decision = buildR3NoiseDecision(makeInput());
    expect(decision).toBeDefined();
    expect(decision?.cause).toBe('UNKNOWN'); // KRX_NON_TRADING_DAY → UNKNOWN bucket (r3NoiseGovernor 매핑)
    expect(decision?.streakImpact).toBe(0);
    expect(decision?.liveBlockPreserved).toBe(true);
  });

  it('A2: 거래일(isKrxTradingDay=true) healthy ctx gate1Pass=0 → cause=TRUE_GATE1_ZERO, streakImpact=1 (무회귀)', () => {
    mockedIsKrxTradingDay.mockReturnValue(true);
    const decision = buildR3NoiseDecision(makeInput());
    expect(decision).toBeDefined();
    expect(decision?.cause).toBe('TRUE_GATE1_ZERO');
    expect(decision?.streakImpact).toBe(1);
    expect(decision?.liveBlockPreserved).toBe(true);
  });

  it('A3: 캘린더 throw → 기존 catch 격리로 undefined 반환 (throw 미전파, 기권-abstain)', () => {
    mockedIsKrxTradingDay.mockImplementation(() => {
      throw new Error('calendar boom');
    });
    const call = () => buildR3NoiseDecision(makeInput());
    expect(call).not.toThrow();
    expect(call()).toBeUndefined();
  });

  it('A4: ENV R3_NOISE_GOVERNOR_DISABLED=true → undefined 반환 (게이트 보존)', () => {
    process.env.R3_NOISE_GOVERNOR_DISABLED = 'true';
    const decision = buildR3NoiseDecision(makeInput());
    expect(decision).toBeUndefined();
  });

  it('A5: todayKstDate 정합 — isKrxTradingDay 가 kstNow.toISOString().slice(0,10) 인자로 호출', () => {
    const kstNow = new Date('2026-07-04T18:30:00.000Z');
    buildR3NoiseDecision(makeInput({ kstNow }));
    expect(mockedIsKrxTradingDay).toHaveBeenCalledTimes(1);
    expect(mockedIsKrxTradingDay).toHaveBeenCalledWith(kstNow.toISOString().slice(0, 10));
  });
});
