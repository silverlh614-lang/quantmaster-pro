import { describe, expect, it } from 'vitest';
import {
  firstPullbackDetector,
  type BreakoutState,
  type FirstPullbackInput,
} from './autoTrading/autoTradeEngine';

// 공통 돌파 상태: 기준선 10,000원, 돌파 당일 거래량 1,000,000주
const BASE_STATE: BreakoutState = {
  breakoutDetected: true,
  breakoutPrice: 10_000,
  breakoutVolume: 1_000_000,
  inPosition: false,
};

// 포지션 보유 상태 (BUY 이후)
const IN_POSITION_STATE: BreakoutState = { ...BASE_STATE, inPosition: true };

function makeInput(overrides: Partial<FirstPullbackInput>): FirstPullbackInput {
  return {
    currentPrice: 10_000,
    currentVolume: 300_000,
    state: { ...BASE_STATE },
    ...overrides,
  };
}

// ─── 기본 상태 검증 ────────────────────────────────────────────────────────────

describe('firstPullbackDetector — 기본 상태', () => {
  it('돌파 미감지(breakoutDetected=false): NONE 반환', () => {
    const result = firstPullbackDetector(
      makeInput({ state: { ...BASE_STATE, breakoutDetected: false } })
    );
    expect(result.signal).toBe('NONE');
  });

  it('돌파 기준선 0(미설정): NONE 반환', () => {
    const result = firstPullbackDetector(
      makeInput({ state: { ...BASE_STATE, breakoutPrice: 0 } })
    );
    expect(result.signal).toBe('NONE');
  });

  it('기준선 = 현재가(눌림목 없음): NONE 반환', () => {
    const result = firstPullbackDetector(makeInput({ currentPrice: 10_000 }));
    expect(result.signal).toBe('NONE');
  });
});

// ─── BUY 신호 ─────────────────────────────────────────────────────────────────

describe('firstPullbackDetector — BUY 신호', () => {
  it('-3% 눌림목 + 거래량 30% → BUY', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_700, currentVolume: 300_000 })
    );
    expect(result.signal).toBe('BUY');
  });

  it('-5% 눌림목 + 거래량 10% → BUY', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_500, currentVolume: 100_000 })
    );
    expect(result.signal).toBe('BUY');
  });

  it('-4% 눌림목 + 거래량 20% → BUY', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_600, currentVolume: 200_000 })
    );
    expect(result.signal).toBe('BUY');
  });

  it('BUY 신호 시 stopLoss = 돌파 기준선 -1% (Math.round)', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_700, currentVolume: 250_000 })
    );
    expect(result.signal).toBe('BUY');
    // 10_000 × 0.99 = 9_900
    expect(result.stopLoss).toBe(9_900);
  });

  it('BUY 신호 시 reason 에 "First Pullback 매수 신호" 포함', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_700, currentVolume: 200_000 })
    );
    expect(result.reason).toContain('First Pullback 매수 신호');
  });
});

// ─── NONE (관망) ─────────────────────────────────────────────────────────────

describe('firstPullbackDetector — NONE (관망)', () => {
  it('-3% 눌림목이지만 거래량 31% → NONE', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_700, currentVolume: 310_000 })
    );
    expect(result.signal).toBe('NONE');
  });

  it('-2% 후퇴(눌림목 구간 미달): NONE', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_800, currentVolume: 200_000 })
    );
    expect(result.signal).toBe('NONE');
  });

  it('+2% 상승(눌림목 없음): NONE', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 10_200, currentVolume: 200_000 })
    );
    expect(result.signal).toBe('NONE');
  });
});

// ─── INVALIDATED ──────────────────────────────────────────────────────────────

describe('firstPullbackDetector — INVALIDATED (돌파 무효)', () => {
  it('-7.1% 하락 → INVALIDATED', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_290, currentVolume: 50_000 })
    );
    expect(result.signal).toBe('INVALIDATED');
  });

  it('-10% 하락 → INVALIDATED', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_000, currentVolume: 50_000 })
    );
    expect(result.signal).toBe('INVALIDATED');
  });

  it('-7% 정확히(경계값) → INVALIDATED (이상 하락 조건 충족)', () => {
    // pricePct = -7.0% → pricePct <= -7% 조건 충족 → INVALIDATED
    // 10_000 × 0.93 = 9_300 → -7.0%
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_300, currentVolume: 50_000 })
    );
    expect(result.signal).toBe('INVALIDATED');
  });

  it('INVALIDATED reason 에 "돌파 무효" 포함', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_200, currentVolume: 50_000 })
    );
    expect(result.reason).toContain('돌파 무효');
  });

  it('inPosition=true 상태에서는 -7% 이하여도 INVALIDATED 아닌 STOP_LOSS', () => {
    // 포지션 보유 중에는 STOP_LOSS 만 확인
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_000, currentVolume: 50_000, state: IN_POSITION_STATE })
    );
    expect(result.signal).toBe('STOP_LOSS');
  });
});

// ─── STOP_LOSS ────────────────────────────────────────────────────────────────

describe('firstPullbackDetector — STOP_LOSS (즉시 손절)', () => {
  it('포지션 보유 중 기준선 -1% 이탈(9,899원) → STOP_LOSS', () => {
    // stopLossPrice = 10_000 × 0.99 = 9_900
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_899, currentVolume: 100_000, state: IN_POSITION_STATE })
    );
    expect(result.signal).toBe('STOP_LOSS');
  });

  it('포지션 보유 중 정확히 9,900원(경계값): STOP_LOSS 미발동 → NONE', () => {
    // currentPrice(9900) >= stopLossPrice(9900) → 손절 미발동
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_900, currentVolume: 100_000, state: IN_POSITION_STATE })
    );
    expect(result.signal).not.toBe('STOP_LOSS');
  });

  it('STOP_LOSS reason 에 "즉시 손절" 포함', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_800, currentVolume: 100_000, state: IN_POSITION_STATE })
    );
    expect(result.reason).toContain('즉시 손절');
  });

  it('STOP_LOSS 시 stopLoss 필드 = 0', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_800, currentVolume: 100_000, state: IN_POSITION_STATE })
    );
    expect(result.stopLoss).toBe(0);
  });

  it('진입 대기 중(inPosition=false)에는 -1% 이탈해도 STOP_LOSS 미발동', () => {
    // BUY 전에는 손절 감시 비활성
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_899, currentVolume: 100_000 })
    );
    expect(result.signal).not.toBe('STOP_LOSS');
  });
});

// ─── 우선순위: 포지션 보유 중 STOP_LOSS 우선 ─────────────────────────────────

describe('firstPullbackDetector — 신호 우선순위', () => {
  it('포지션 보유 중 눌림목 구간(-4%)이라도 stop-loss 가격 이탈 시 STOP_LOSS', () => {
    // -4% 눌림목 구간이지만 inPosition=true 상태에서는 손절만 감시
    // 9,600원은 9,900(기준선-1%) 이하 → STOP_LOSS
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_600, currentVolume: 200_000, state: IN_POSITION_STATE })
    );
    expect(result.signal).toBe('STOP_LOSS');
  });

  it('포지션 보유 중 기준선 -0.5%(9,950원): NONE — 손절선(9,900) 미이탈', () => {
    const result = firstPullbackDetector(
      makeInput({ currentPrice: 9_950, currentVolume: 200_000, state: IN_POSITION_STATE })
    );
    expect(result.signal).toBe('NONE');
  });
});
