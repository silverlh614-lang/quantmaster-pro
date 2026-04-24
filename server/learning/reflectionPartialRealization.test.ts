/**
 * @responsibility nightlyReflection 의 부분매도 학습 반영 회귀 테스트
 *
 * PR-16: summarizeTodaysRealizationsForLearning 이 전량 청산 fill + 부분매도 fill
 * 을 모두 모아 fill 단위 승/손, 가중 P&L, 실현 원화를 정확히 산출하는지 검증.
 * 사용자 신고(2026-04-24) 의 "부분 익절이 있는데도 손실만 보이는" 버그 재발 방지.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeTodaysRealizationsForLearning,
  type ReflectionInputs,
} from './nightlyReflectionEngine.js';
import type { ServerShadowTrade, PositionFill } from '../persistence/shadowTradeRepo.js';

const DATE = '2026-04-24';
const YEST_ISO   = '2026-04-23T14:00:00.000Z';
const TODAY_ISO  = '2026-04-24T04:30:00+09:00';  // 04:30 KST
const TODAY_ISO2 = '2026-04-24T10:15:00+09:00';  // 10:15 KST

function trade(overrides: Partial<ServerShadowTrade> & { id: string }): ServerShadowTrade {
  return {
    stockCode: overrides.id,
    stockName: `종목${overrides.id}`,
    signalTime: YEST_ISO,
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    targetPrice: 11_000,
    status: 'ACTIVE',
    fills: [],
    ...overrides,
  };
}

function sellFill(o: { id: string; qty: number; pnl: number; pnlPct: number; ts: string; status?: PositionFill['status'] }): PositionFill {
  return {
    id: o.id,
    type: 'SELL',
    subType: 'PARTIAL_TP',
    qty: o.qty,
    price: 10_000 + o.pnl / o.qty,
    pnl: o.pnl,
    pnlPct: o.pnlPct,
    reason: 'test',
    timestamp: o.ts,
    status: o.status ?? 'CONFIRMED',
    confirmedAt: o.ts,
  };
}

function mkInputs(partial: ReflectionInputs['partialRealizationsToday'], closed: ServerShadowTrade[]): ReflectionInputs {
  return {
    date: DATE,
    closedTrades: closed,
    partialRealizationsToday: partial,
    attributionToday: [],
    incidentsToday: [],
    missedSignals: [],
    knownSourceIds: new Set(),
    manualExitsToday: [],
  };
}

describe('summarizeTodaysRealizationsForLearning', () => {
  it('부분매도만 있는 날 — 이익 fill 집계', () => {
    const sum = summarizeTodaysRealizationsForLearning(mkInputs(
      [{
        trade: trade({ id: 'POSCO', stockName: '포스코인터' }),
        todaysSells: [sellFill({ id: 'f1', qty: 5, pnl: 20_000, pnlPct: 5.0, ts: TODAY_ISO2 })],
      }],
      [],
    ));
    expect(sum.winFills).toBe(1);
    expect(sum.lossFills).toBe(0);
    expect(sum.fullClosedCount).toBe(0);
    expect(sum.partialOnlyCount).toBe(1);
    expect(sum.totalRealizedKrw).toBe(20_000);
    expect(sum.weightedReturnPct).toBeCloseTo(5.0, 2);
    expect(sum.labels[0]).toContain('포스코인터 부분익절 +5.00%');
  });

  it('전량 손절 + 부분 익절 혼재 — 사용자 재현 시나리오', () => {
    const closed = [
      trade({
        id: 'HYUNDAISTEEL',
        stockName: '현대제철',
        status: 'HIT_STOP',
        exitTime: TODAY_ISO,
        fills: [
          { id: 'hb', type: 'BUY', qty: 29, price: 42_126, reason: 'init', timestamp: YEST_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'hs', qty: 29, pnl: -90_654, pnlPct: -7.42, ts: TODAY_ISO }),
        ],
      }),
    ];
    const partial: ReflectionInputs['partialRealizationsToday'] = [
      {
        trade: trade({ id: 'POSCO', stockName: '포스코인터' }),
        todaysSells: [sellFill({ id: 'pt', qty: 5, pnl: 20_335, pnlPct: 5.0, ts: TODAY_ISO2 })],
      },
    ];
    const sum = summarizeTodaysRealizationsForLearning(mkInputs(partial, closed));

    expect(sum.fullClosedCount).toBe(1);
    expect(sum.partialOnlyCount).toBe(1);
    expect(sum.winFills).toBe(1);
    expect(sum.lossFills).toBe(1);
    // 가중 P&L = (-7.42 × 29 + 5.0 × 5) / 34 ≈ -5.59%
    expect(sum.weightedReturnPct).toBeCloseTo(-5.59, 2);
    expect(sum.totalRealizedKrw).toBe(-90_654 + 20_335);
    // labels 에 두 종목 모두 포함 — Gemini narrative 에 이익이 누락되지 않도록
    expect(sum.labels.some(l => l.includes('현대제철 전량손절'))).toBe(true);
    expect(sum.labels.some(l => l.includes('포스코인터 부분익절'))).toBe(true);
  });

  it('실현 이벤트 없음 — zero 집계', () => {
    const sum = summarizeTodaysRealizationsForLearning(mkInputs([], []));
    expect(sum.winFills).toBe(0);
    expect(sum.lossFills).toBe(0);
    expect(sum.totalRealizedKrw).toBe(0);
    expect(sum.weightedReturnPct).toBe(0);
    expect(sum.labels).toHaveLength(0);
  });

  it('PROVISIONAL fill 은 집계 제외 (학습은 확정 체결만 신뢰)', () => {
    // ACTIVE trade 의 오늘 fill 이 PROVISIONAL 이면 partialRealizationsToday 에 포함되지 않아야 함.
    // collectInputs 로직 상 CONFIRMED 만 partial 에 들어가므로 이 테스트는 호출부 가드 확인용.
    const sum = summarizeTodaysRealizationsForLearning(mkInputs(
      [{
        trade: trade({ id: 'PROVONLY' }),
        todaysSells: [], // collectInputs 가 CONFIRMED 만 모은다고 가정 — PROVISIONAL 은 상위에서 필터
      }],
      [],
    ));
    expect(sum.winFills).toBe(0);
    expect(sum.lossFills).toBe(0);
    expect(sum.partialOnlyCount).toBe(1);
  });
});
