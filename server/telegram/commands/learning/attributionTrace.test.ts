/**
 * @responsibility /at attributionTrace returnPct 표시 fills SSOT fallback 회귀 가드
 *
 * 진단 결과: ServerShadowTrade.returnPct 필드는 updateShadow invariant 보호로
 * (shadowTradeRepo.ts:287-290) 영원히 저장 차단된다. /at 명령 표시는 fills SSOT
 * (PR-15~19 getWeightedPnlPct) 가중평균 fallback 으로 정상화. 본 PR 1/3.
 */

import { describe, it, expect } from 'vitest';
import type { ServerShadowTrade, PositionFill } from '../../../persistence/shadowTradeRepo.js';
import type { ServerAttributionRecord } from '../../../persistence/attributionRepo.js';
import {
  resolveReturnPctForDisplay,
  buildTraceEntry,
  formatAttributionTraceMessage,
} from './attributionTrace.cmd.js';

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'TT1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-30T00:00:00.000Z',
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 0,
    originalQuantity: 100,
    stopLoss: 90,
    targetPrice: 120,
    status: 'HIT_STOP',
    fills: [],
    ...overrides,
  } as ServerShadowTrade;
}

function makeSellFill(qty: number, pnlPct: number): PositionFill {
  return {
    id: `f-${qty}`,
    type: 'SELL',
    subType: 'STOP_LOSS',
    qty,
    price: 95,
    pnl: -500,
    pnlPct,
    timestamp: '2026-04-30T05:00:00.000Z',
    reason: 'test',
    status: 'CONFIRMED',
  } as PositionFill;
}

describe('/at resolveReturnPctForDisplay (결함 A 1차 수리)', () => {
  it('레거시 trade.returnPct 가 정상 값이면 그대로 사용 (후방호환)', () => {
    const t = makeTrade({ returnPct: -3.45, fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(-3.45, 2);
  });

  it('returnPct 부재 + fills 보유 시 가중평균 (fills SSOT fallback)', () => {
    const t = makeTrade({
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: '진입', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(50, -2.0),
        makeSellFill(50, -4.0),
      ],
    });
    // 가중평균: (-2 × 50 + -4 × 50) / 100 = -3.0
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(-3.0, 2);
  });

  it('returnPct 부재 + fills 부재 → undefined (N/A 표시)', () => {
    const t = makeTrade({ fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeUndefined();
  });

  it('returnPct=NaN/Infinity → fills fallback', () => {
    const t = makeTrade({
      returnPct: NaN,
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: 'b', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(100, +5.0),
      ],
    });
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(5.0, 2);
  });

  it('returnPct=0 + fills 가중평균 0 → undefined (formatPctSigned 가 N/A 표시 회피)', () => {
    const t = makeTrade({ fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeUndefined();
  });

  it('returnPct 부재 + 부분매도 가중평균 (PR-15~19 fills SSOT 정합)', () => {
    const t = makeTrade({
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: 'b', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(30, +10.0), // 트랜치 1: 30주, +10%
        makeSellFill(70, -2.0),  // 잔여 70주, -2%
      ],
    });
    // 가중평균: (10 × 30 + -2 × 70) / 100 = (300 - 140) / 100 = 1.6
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(1.6, 2);
  });
});

describe('/at conditionScoresAtEntry baseline 진단 (PR 2 — 결함 B 진단 도구)', () => {
  it('buildTraceEntry — entryConditionScores 27/27 영속 trade', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    const t = makeTrade({ entryConditionScores: scores });
    const entry = buildTraceEntry(t, []);
    expect(entry.conditionScoresCount).toBe(27);
  });

  it('buildTraceEntry — entryConditionScores 부재 → 0 (PR-1 이전 trade)', () => {
    const t = makeTrade({ entryConditionScores: undefined });
    const entry = buildTraceEntry(t, []);
    expect(entry.conditionScoresCount).toBe(0);
  });

  it('buildTraceEntry — entryConditionScores 빈 객체 → 0', () => {
    const t = makeTrade({ entryConditionScores: {} });
    const entry = buildTraceEntry(t, []);
    expect(entry.conditionScoresCount).toBe(0);
  });

  it('formatAttributionTraceMessage — 표시 라인 "conditionScoresAtEntry: N/27"', () => {
    const t = makeTrade({ entryConditionScores: undefined, exitTime: '2026-04-30T05:00:00.000Z' });
    const entries = [buildTraceEntry(t, [])];
    const msg = formatAttributionTraceMessage(entries);
    expect(msg).toContain('conditionScoresAtEntry: 0/27');
  });

  it('formatAttributionTraceMessage — 27/27 영속 시', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    const t = makeTrade({ entryConditionScores: scores, exitTime: '2026-05-01T05:00:00.000Z' });
    const entries = [buildTraceEntry(t, [])];
    const msg = formatAttributionTraceMessage(entries);
    expect(msg).toContain('conditionScoresAtEntry: 27/27');
  });

  it('formatAttributionTraceMessage 진단 분기 — baseline 0/N → "PR-1 이전 trade. wiring 정상"', () => {
    const t = makeTrade({ entryConditionScores: undefined, exitTime: '2026-04-30T05:00:00.000Z' });
    const entries = [buildTraceEntry(t, [])];
    const msg = formatAttributionTraceMessage(entries);
    expect(msg).toContain('baseline 영속 (entryConditionScores): 0/1');
    expect(msg).toContain('PR-1 (#467) 이전 trade. wiring 정상');
  });

  it('formatAttributionTraceMessage 진단 분기 — baseline 전체 영속 + attribution 부재 → "exitEngine/ocoCloseLoop"', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    const t = makeTrade({ entryConditionScores: scores, exitTime: '2026-05-01T05:00:00.000Z' });
    const entries = [buildTraceEntry(t, [])];
    const msg = formatAttributionTraceMessage(entries);
    expect(msg).toContain('baseline 영속 (entryConditionScores): 1/1');
    expect(msg).toContain('emitFullCloseAttribution 호출 누락');
  });

  it('formatAttributionTraceMessage — attribution 영속 시 권장 조사 위치 미렌더', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    const t = makeTrade({
      entryConditionScores: scores,
      exitTime: '2026-05-01T05:00:00.000Z',
      id: 'TT2',
    });
    const rec: ServerAttributionRecord = {
      schemaVersion: 2,
      tradeId: 'TT2',
      stockCode: t.stockCode,
      stockName: t.stockName ?? '',
      closedAt: '2026-05-01T05:00:00.000Z',
      returnPct: -3.45,
      isWin: false,
      conditionScores: scores,
      holdingDays: 1,
      attributionType: 'FULL_CLOSE',
      qtyRatio: 1.0,
    };
    const entries = [buildTraceEntry(t, [rec])];
    const msg = formatAttributionTraceMessage(entries);
    expect(msg).not.toContain('권장 조사 위치');
    expect(msg).toContain('🟢 모든 closed trade 에 attribution 존재');
  });
});
