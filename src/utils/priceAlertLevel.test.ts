/**
 * @responsibility computePriceAlertLevel 단위 테스트 — ADR-0030 PR-C
 */
import { describe, it, expect } from 'vitest';
import { computePriceAlertLevel, isActionableAlert } from './priceAlertLevel';

describe('computePriceAlertLevel — ADR-0030 4단계 우선순위', () => {
  it('currentPrice ≥ targetPrice → TAKE_PROFIT (1순위)', () => {
    expect(computePriceAlertLevel({
      currentPrice: 110, stopLoss: 90, targetPrice: 110,
    })).toBe('TAKE_PROFIT');
    expect(computePriceAlertLevel({
      currentPrice: 120, stopLoss: 90, targetPrice: 110,
    })).toBe('TAKE_PROFIT');
  });

  it('TAKE_PROFIT 가 DANGER 보다 우선 (currentPrice ≥ target + ≤ stop 동시 성립 불가능하지만 정합)', () => {
    // currentPrice 가 target 이상이면 stopLoss 이하일 수 없음 — 정상 입력 가정
    expect(computePriceAlertLevel({
      currentPrice: 200, stopLoss: 250, targetPrice: 150,
    })).toBe('TAKE_PROFIT');
  });

  it('currentPrice ≤ stopLoss → DANGER (2순위)', () => {
    expect(computePriceAlertLevel({
      currentPrice: 90, stopLoss: 90, targetPrice: 110,
    })).toBe('DANGER');
    expect(computePriceAlertLevel({
      currentPrice: 85, stopLoss: 90, targetPrice: 110,
    })).toBe('DANGER');
  });

  it('손절선 3% 이내 (기본) → CAUTION', () => {
    // stopLoss=90, currentPrice=92.5 → distance = (92.5-90)/92.5 = 2.7%
    expect(computePriceAlertLevel({
      currentPrice: 92.5, stopLoss: 90, targetPrice: 110,
    })).toBe('CAUTION');
  });

  it('손절선 3% 초과 → NORMAL', () => {
    // stopLoss=90, currentPrice=95 → distance = 5/95 = 5.26%
    expect(computePriceAlertLevel({
      currentPrice: 95, stopLoss: 90, targetPrice: 110,
    })).toBe('NORMAL');
  });

  it('cautionPctToStop=5 (사용자 설정) → 5% 이내 CAUTION', () => {
    expect(computePriceAlertLevel({
      currentPrice: 94, stopLoss: 90, targetPrice: 110, cautionPctToStop: 5,
    })).toBe('CAUTION'); // 4/94 = 4.26%
  });

  it('계획 범위 내 (정상 보유) → NORMAL', () => {
    expect(computePriceAlertLevel({
      currentPrice: 100, stopLoss: 90, targetPrice: 110,
    })).toBe('NORMAL');
  });

  it('currentPrice ≤ 0 → NORMAL (계산 불가)', () => {
    expect(computePriceAlertLevel({
      currentPrice: 0, stopLoss: 90, targetPrice: 110,
    })).toBe('NORMAL');
    expect(computePriceAlertLevel({
      currentPrice: -10, stopLoss: 90, targetPrice: 110,
    })).toBe('NORMAL');
  });

  it('currentPrice=NaN → NORMAL', () => {
    expect(computePriceAlertLevel({
      currentPrice: NaN, stopLoss: 90, targetPrice: 110,
    })).toBe('NORMAL');
  });

  it('stopLoss=0 → DANGER 분기 skip + CAUTION 분기 skip', () => {
    expect(computePriceAlertLevel({
      currentPrice: 100, stopLoss: 0, targetPrice: 110,
    })).toBe('NORMAL');
    expect(computePriceAlertLevel({
      currentPrice: 110, stopLoss: 0, targetPrice: 110,
    })).toBe('TAKE_PROFIT'); // target 도달은 stopLoss 무관 적용
  });

  it('targetPrice=0 → TAKE_PROFIT 분기 skip', () => {
    expect(computePriceAlertLevel({
      currentPrice: 100, stopLoss: 90, targetPrice: 0,
    })).toBe('NORMAL');
    expect(computePriceAlertLevel({
      currentPrice: 90, stopLoss: 90, targetPrice: 0,
    })).toBe('DANGER');
  });

  it('정확히 손절 한계 = 3% → CAUTION (경계값)', () => {
    // distance 정확히 3%: stopLoss=97, currentPrice=100, (3/100)=3%
    expect(computePriceAlertLevel({
      currentPrice: 100, stopLoss: 97, targetPrice: 200,
    })).toBe('CAUTION');
  });
});

describe('isActionableAlert — ADR-0030', () => {
  it('NORMAL → false', () => {
    expect(isActionableAlert('NORMAL')).toBe(false);
  });
  it('CAUTION/DANGER/TAKE_PROFIT → true', () => {
    expect(isActionableAlert('CAUTION')).toBe(true);
    expect(isActionableAlert('DANGER')).toBe(true);
    expect(isActionableAlert('TAKE_PROFIT')).toBe(true);
  });
});
