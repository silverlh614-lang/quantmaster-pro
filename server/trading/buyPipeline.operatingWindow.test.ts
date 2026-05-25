/**
 * @responsibility Patch-SHADOW-OPERATING-WINDOW-GATE — 운영자 SHADOW 카드 운영시간 게이트 회귀.
 *
 * 검증 (운영자 확정 설계: SHADOW 매수 카드는 LIVE 와 동일 운영시간에만 발화):
 *   - 거래일 + REGULAR → true (카드 발화 허용)
 *   - 휴장일(부처님오신날, 인시던트 당일) → false (REGULAR 세션이라도)
 *   - 장후(CLOSED)·점심(LUNCH_BREAK)·주말 → false
 *   - LIVE·tradeDate/marketSession 부재·ENV 비활성 → undefined (게이트 비적용, 후방호환)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../screener/sectorMap.js', () => ({ getSectorByCode: vi.fn(() => '미분류') }));
vi.mock('../persistence/incidentLogRepo.js', () => ({ getLatestIncidentAt: vi.fn(() => null) }));

import { resolveOperatorShadowCardWindowOpen } from './buyPipeline.js';

const TRADING_DAY = '2026-05-22'; // 금요일 (휴장 아님)
const HOLIDAY = '2026-05-25'; // 부처님오신날 (KRX 휴장 — 인시던트 당일)
const WEEKEND = '2026-05-23'; // 토요일

afterEach(() => {
  delete process.env.SHADOW_OPERATING_WINDOW_GATE_DISABLED;
});

describe('resolveOperatorShadowCardWindowOpen (운영시간 게이트)', () => {
  it('거래일 + REGULAR → true (운영자 카드 발화 허용)', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: TRADING_DAY, marketSession: 'REGULAR' })).toBe(true);
  });

  it('휴장일(부처님오신날) + REGULAR 라도 → false (인시던트 케이스)', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: HOLIDAY, marketSession: 'REGULAR' })).toBe(false);
  });

  it('거래일 + CLOSED(장후 21시) → false', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: TRADING_DAY, marketSession: 'CLOSED' })).toBe(false);
  });

  it('거래일 + LUNCH_BREAK → false (점심 — live 도 진입 차단)', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: TRADING_DAY, marketSession: 'LUNCH_BREAK' })).toBe(false);
  });

  it('주말(토) + REGULAR → false', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: WEEKEND, marketSession: 'REGULAR' })).toBe(false);
  });

  it('LIVE 모드 → undefined (게이트 비적용)', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: false, tradeDate: TRADING_DAY, marketSession: 'REGULAR' })).toBeUndefined();
  });

  it('tradeDate/marketSession 부재 → undefined (후방호환)', () => {
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true })).toBeUndefined();
  });

  it('ENV SHADOW_OPERATING_WINDOW_GATE_DISABLED=true → undefined (1줄 롤백)', () => {
    process.env.SHADOW_OPERATING_WINDOW_GATE_DISABLED = 'true';
    expect(resolveOperatorShadowCardWindowOpen({ shadowMode: true, tradeDate: HOLIDAY, marketSession: 'REGULAR' })).toBeUndefined();
  });
});
