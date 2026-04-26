// @vitest-environment jsdom
/**
 * @responsibility InvalidationMeter tier 색상·dot·expand 회귀 (ADR-0045 PR-Z3)
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { InvalidationMeter } from './InvalidationMeter';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';

function makePosition(overrides: Partial<PositionItem> = {}): PositionItem {
  return {
    id: 'TEST',
    symbol: '005930',
    name: '삼성전자',
    enteredAt: '2026-04-26T00:00:00Z',
    entryReason: 'test',
    avgPrice: 70_000,
    currentPrice: 70_000,
    quantity: 10,
    pnlPct: 0,
    stopLossPrice: 66_500,
    targetPrice1: 77_000,
    targetPrice2: 84_000,
    trailingStopEnabled: false,
    status: 'HOLD',
    stage: 'HOLD',
    ...overrides,
  };
}

describe('InvalidationMeter — ADR-0045', () => {
  afterEach(() => {
    cleanup();
  });

  it('정상 보유 → tier=OK + 0/4 표시', () => {
    render(<InvalidationMeter position={makePosition({
      currentPrice: 73_500, pnlPct: 5, stage: 'HOLD',
    })} />);
    const meter = screen.getByTestId('invalidation-meter');
    expect(meter.getAttribute('data-tier')).toBe('OK');
    expect(meter.getAttribute('data-met')).toBe('0');
    expect(meter.getAttribute('data-evaluable')).toBe('4');
    expect(screen.getByText('정상')).toBeTruthy();
    expect(screen.getByText('0/4')).toBeTruthy();
  });

  it('1 충족 (LOSS_THRESHOLD) → tier=WARN', () => {
    render(<InvalidationMeter position={makePosition({ pnlPct: -3.5 })} />);
    const meter = screen.getByTestId('invalidation-meter');
    expect(meter.getAttribute('data-tier')).toBe('WARN');
    expect(meter.getAttribute('data-met')).toBe('1');
    expect(screen.getByText('주의')).toBeTruthy();
  });

  it('2+ 충족 (STOP_LOSS_APPROACH + LOSS_THRESHOLD + STAGE_ESCALATION) → tier=CRITICAL', () => {
    render(<InvalidationMeter position={makePosition({
      currentPrice: 67_000, pnlPct: -4.3, stage: 'EXIT_PREP',
    })} />);
    const meter = screen.getByTestId('invalidation-meter');
    expect(meter.getAttribute('data-tier')).toBe('CRITICAL');
    expect(screen.getByText('재평가 권고')).toBeTruthy();
  });

  it('모두 NA → tier=NA + 평가 불가 라벨', () => {
    render(<InvalidationMeter position={makePosition({
      stopLossPrice: undefined,
      targetPrice1: undefined,
      stage: undefined,
      pnlPct: NaN,
    })} />);
    const meter = screen.getByTestId('invalidation-meter');
    expect(meter.getAttribute('data-tier')).toBe('NA');
    expect(meter.getAttribute('data-evaluable')).toBe('0');
    expect(screen.getByText('평가 불가')).toBeTruthy();
  });

  it('클릭 시 expand 되어 4 조건 라벨 노출', () => {
    render(<InvalidationMeter position={makePosition({ currentPrice: 73_500, pnlPct: 5 })} />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    expect(screen.getByText('손절가 임박')).toBeTruthy();
    expect(screen.getByText('손실 -3% 도달')).toBeTruthy();
    expect(screen.getByText('시스템 단계 격상')).toBeTruthy();
    expect(screen.getByText('1차 목표 도달')).toBeTruthy();
  });

  it('defaultExpanded=true 면 초기부터 expand 상태', () => {
    render(<InvalidationMeter position={makePosition({})} defaultExpanded />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // 라벨 4개 모두 즉시 노출
    expect(screen.getByText('손절가 임박')).toBeTruthy();
  });
});
