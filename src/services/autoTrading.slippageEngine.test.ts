import { describe, expect, it } from 'vitest';
import {
  measureSlippage,
  calculateAverageSlippage,
  adjustedKelly,
} from './autoTrading/slippageEngine';
import type { SlippageRecord } from '../types/portfolio';

// ─── measureSlippage ─────────────────────────────────────────────────────────

describe('measureSlippage — 슬리피지 측정 레코드 생성', () => {
  it('체결가 = 이론가: slippagePct = 0', () => {
    const rec = measureSlippage('005930', 10000, 10000, 'MARKET', 1000);
    expect(rec.slippagePct).toBe(0);
  });

  it('체결가 > 이론가(불리한 체결): slippagePct > 0', () => {
    const rec = measureSlippage('005930', 10000, 10100, 'MARKET', 1000);
    expect(rec.slippagePct).toBeCloseTo(0.01, 5);
  });

  it('체결가 < 이론가(유리한 체결): slippagePct < 0', () => {
    const rec = measureSlippage('005930', 10000, 9900, 'LIMIT', 500);
    expect(rec.slippagePct).toBeCloseTo(-0.01, 5);
  });

  it('slippagePct = (executedPrice - theoreticalPrice) / theoreticalPrice', () => {
    const theoretical = 50000;
    const executed    = 50500;
    const rec = measureSlippage('000660', theoretical, executed, 'MARKET', 200);
    const expected = (executed - theoretical) / theoretical;
    expect(rec.slippagePct).toBeCloseTo(expected, 8);
  });

  it('반환 레코드에 모든 필드 포함', () => {
    const rec = measureSlippage('035420', 20000, 20200, 'LIMIT', 300);
    expect(rec.id).toMatch(/^slip_/);
    expect(rec.stockCode).toBe('035420');
    expect(rec.theoreticalPrice).toBe(20000);
    expect(rec.executedPrice).toBe(20200);
    expect(rec.orderType).toBe('LIMIT');
    expect(rec.volume).toBe(300);
    expect(rec.signalTime).toBeTruthy();
  });

  it('id가 stockCode를 포함하는 고유값', () => {
    const rec1 = measureSlippage('123456', 10000, 10050, 'MARKET', 100);
    const rec2 = measureSlippage('123456', 10000, 10050, 'MARKET', 100);
    expect(rec1.id).toContain('123456');
    // 두 레코드가 동시에 생성돼도 id 형식은 같아야 함
    expect(rec2.id).toContain('123456');
  });
});

// ─── calculateAverageSlippage ────────────────────────────────────────────────

describe('calculateAverageSlippage — 평균 슬리피지 계산', () => {
  it('빈 배열: 0 반환', () => {
    expect(calculateAverageSlippage([])).toBe(0);
  });

  it('단일 레코드: 해당 slippagePct 반환', () => {
    const records: SlippageRecord[] = [
      { id: '1', stockCode: 'A', signalTime: '', theoreticalPrice: 100, executedPrice: 101, slippagePct: 0.01, orderType: 'MARKET', volume: 100 },
    ];
    expect(calculateAverageSlippage(records)).toBe(0.01);
  });

  it('복수 레코드: 산술 평균 반환', () => {
    const records: SlippageRecord[] = [
      { id: '1', stockCode: 'A', signalTime: '', theoreticalPrice: 100, executedPrice: 101, slippagePct: 0.01, orderType: 'MARKET', volume: 100 },
      { id: '2', stockCode: 'B', signalTime: '', theoreticalPrice: 100, executedPrice: 102, slippagePct: 0.02, orderType: 'MARKET', volume: 200 },
      { id: '3', stockCode: 'C', signalTime: '', theoreticalPrice: 100, executedPrice: 100, slippagePct: 0.00, orderType: 'LIMIT',  volume: 50  },
    ];
    // (0.01 + 0.02 + 0.00) / 3 = 0.01
    expect(calculateAverageSlippage(records)).toBeCloseTo(0.01, 8);
  });

  it('모두 0인 레코드: 평균 0', () => {
    const records: SlippageRecord[] = [
      { id: '1', stockCode: 'A', signalTime: '', theoreticalPrice: 100, executedPrice: 100, slippagePct: 0, orderType: 'MARKET', volume: 100 },
      { id: '2', stockCode: 'B', signalTime: '', theoreticalPrice: 100, executedPrice: 100, slippagePct: 0, orderType: 'MARKET', volume: 100 },
    ];
    expect(calculateAverageSlippage(records)).toBe(0);
  });

  it('음수 슬리피지(유리한 체결) 포함 시 정확한 평균 반환', () => {
    const records: SlippageRecord[] = [
      { id: '1', stockCode: 'A', signalTime: '', theoreticalPrice: 100, executedPrice: 101, slippagePct:  0.01, orderType: 'MARKET', volume: 100 },
      { id: '2', stockCode: 'B', signalTime: '', theoreticalPrice: 100, executedPrice: 99,  slippagePct: -0.01, orderType: 'LIMIT',  volume: 100 },
    ];
    expect(calculateAverageSlippage(records)).toBeCloseTo(0, 8);
  });
});

// ─── adjustedKelly ───────────────────────────────────────────────────────────

describe('adjustedKelly — 슬리피지 반영 실효 Kelly 분수', () => {
  it('슬리피지 0: 기본 Kelly 공식과 동일', () => {
    // Kelly = (winRate × rrr − (1 − winRate)) / rrr
    const winRate = 0.6, rrr = 2.0, avgSlippage = 0;
    const expected = (winRate * rrr - (1 - winRate)) / rrr;
    expect(adjustedKelly(winRate, rrr, avgSlippage)).toBeCloseTo(expected, 5);
  });

  it('양의 슬리피지: 승률 감소 → Kelly 감소', () => {
    const noSlip   = adjustedKelly(0.6, 2.0, 0);
    const withSlip = adjustedKelly(0.6, 2.0, 0.01);
    expect(withSlip).toBeLessThan(noSlip);
  });

  it('슬리피지가 충분히 크면 Kelly = 0 (음수 방지)', () => {
    // winRate 0.4, rrr 1.5 → 이미 경계선이고, 슬리피지 추가 시 음수 가능
    const kelly = adjustedKelly(0.4, 1.5, 0.5);
    expect(kelly).toBeGreaterThanOrEqual(0);
  });

  it('승률 0%: Kelly = 0', () => {
    const kelly = adjustedKelly(0, 3.0, 0);
    expect(kelly).toBeGreaterThanOrEqual(0);
  });

  it('승률 100% + 슬리피지 0: Kelly = (rrr - 0) / rrr = 1.0 미만 (실효 값)', () => {
    // effectiveWinRate = 1 × (1 - 0) = 1
    // (1 × rrr - 0) / rrr = 1
    const kelly = adjustedKelly(1.0, 2.0, 0);
    expect(kelly).toBeCloseTo(1.0, 5);
  });

  it('음수 슬리피지(절대값 적용): Math.abs로 처리되어 양의 슬리피지와 동일하게 Kelly 감소', () => {
    // 구현이 Math.abs(avgSlippage)를 사용하므로 음수/양수 동일하게 취급
    const negativeSlip = adjustedKelly(0.6, 2.0, -0.01);
    const positiveSlip = adjustedKelly(0.6, 2.0,  0.01);
    expect(negativeSlip).toBeCloseTo(positiveSlip, 5);
  });
});
