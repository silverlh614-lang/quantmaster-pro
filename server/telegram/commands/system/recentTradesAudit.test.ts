/**
 * @responsibility /recent_trades_audit (alias /rta) 회귀 가드 — KST 일자 분류 + post-merge baseline
 */

import { describe, it, expect } from 'vitest';
import type { ServerShadowTrade, PositionFill } from '../../../persistence/shadowTradeRepo.js';
import {
  isoToKstDate,
  summarizeDailyCounts,
  classifyPostMergeTrades,
  formatRecentTradesAuditMessage,
  ATTRIBUTION_WIRING_MERGED_AT_ISO,
} from './recentTradesAudit.cmd.js';

function makeTrade(over: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'T1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-30T17:30:00.000Z', // 5/1 02:30 KST (머지 이전)
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 100,
    originalQuantity: 100,
    stopLoss: 90,
    targetPrice: 120,
    status: 'ACTIVE',
    fills: [],
    ...over,
  } as ServerShadowTrade;
}

function makeSell(qty: number, ts: string): PositionFill {
  return { id: `f${qty}`, type: 'SELL', subType: 'STOP_LOSS', qty, price: 95, pnl: -500, pnlPct: -5, timestamp: ts, reason: 't', status: 'CONFIRMED' } as PositionFill;
}

describe('isoToKstDate', () => {
  it('UTC 17:00 → KST 다음날', () => expect(isoToKstDate('2026-04-30T17:30:00.000Z')).toBe('2026-05-01'));
  it('UTC 14:00 → KST 같은 날', () => expect(isoToKstDate('2026-04-30T14:00:00.000Z')).toBe('2026-04-30'));
  it('null/undefined/잘못된 ISO → null', () => {
    expect(isoToKstDate(undefined)).toBeNull();
    expect(isoToKstDate('not-a-date')).toBeNull();
    expect(isoToKstDate('')).toBeNull();
  });
});

describe('summarizeDailyCounts', () => {
  const NOW = new Date('2026-05-02T05:00:00.000Z'); // 5/2 14:00 KST

  it('window 길이 정확 (7일)', () => {
    expect(summarizeDailyCounts([], 7, NOW)).toHaveLength(7);
  });

  it('signalTime KST 일자 buy 카운트', () => {
    const trades = [
      makeTrade({ signalTime: '2026-04-30T01:00:00.000Z' }), // 4/30 KST 10:00
      makeTrade({ signalTime: '2026-04-30T08:00:00.000Z' }), // 4/30 KST 17:00
      makeTrade({ signalTime: '2026-05-01T01:00:00.000Z' }), // 5/1 KST 10:00
    ];
    const daily = summarizeDailyCounts(trades, 7, NOW);
    const apr30 = daily.find((d) => d.date === '2026-04-30')!;
    const may01 = daily.find((d) => d.date === '2026-05-01')!;
    expect(apr30.buy).toBe(2);
    expect(may01.buy).toBe(1);
  });

  it('SELL CONFIRMED fill.timestamp KST 일자 sell 카운트', () => {
    const trades = [
      makeTrade({
        signalTime: '2026-04-29T01:00:00.000Z',
        fills: [makeSell(50, '2026-04-30T05:00:00.000Z'), makeSell(50, '2026-05-01T05:00:00.000Z')],
      }),
    ];
    const daily = summarizeDailyCounts(trades, 7, NOW);
    expect(daily.find((d) => d.date === '2026-04-30')!.sell).toBe(1);
    expect(daily.find((d) => d.date === '2026-05-01')!.sell).toBe(1);
  });

  it('REVERTED fill 제외', () => {
    const reverted = { ...makeSell(50, '2026-04-30T05:00:00.000Z'), status: 'REVERTED' as const };
    const trades = [makeTrade({ fills: [reverted] })];
    const daily = summarizeDailyCounts(trades, 7, NOW);
    expect(daily.every((d) => d.sell === 0)).toBe(true);
  });
});

describe('classifyPostMergeTrades', () => {
  it('머지 이전 trade → 미카운트', () => {
    const trades = [makeTrade({ signalTime: '2026-04-30T17:00:00.000Z' })]; // 머지 38분 전
    const stats = classifyPostMergeTrades(trades, ATTRIBUTION_WIRING_MERGED_AT_ISO);
    expect(stats.newBuyCount).toBe(0);
  });

  it('머지 이후 + 27/27 baseline → withFullBaseline', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    const trades = [makeTrade({
      signalTime: '2026-05-01T01:00:00.000Z',
      entryConditionScores: scores,
    })];
    const stats = classifyPostMergeTrades(trades, ATTRIBUTION_WIRING_MERGED_AT_ISO);
    expect(stats.newBuyCount).toBe(1);
    expect(stats.withFullBaseline).toHaveLength(1);
    expect(stats.withZeroBaseline).toHaveLength(0);
  });

  it('머지 이후 + baseline 부재 → withZeroBaseline', () => {
    const trades = [makeTrade({
      signalTime: '2026-05-01T01:00:00.000Z',
      entryConditionScores: undefined,
    })];
    const stats = classifyPostMergeTrades(trades, ATTRIBUTION_WIRING_MERGED_AT_ISO);
    expect(stats.newBuyCount).toBe(1);
    expect(stats.withZeroBaseline).toHaveLength(1);
    expect(stats.withFullBaseline).toHaveLength(0);
  });

  it('머지 이후 sell fill 카운트', () => {
    const trades = [makeTrade({
      signalTime: '2026-05-01T01:00:00.000Z',
      fills: [makeSell(100, '2026-05-02T05:00:00.000Z')],
    })];
    const stats = classifyPostMergeTrades(trades, ATTRIBUTION_WIRING_MERGED_AT_ISO);
    expect(stats.newSellCount).toBe(1);
  });
});

describe('formatRecentTradesAuditMessage', () => {
  it('newBuyCount=0 → "신규 매수 0건" 진단', () => {
    const msg = formatRecentTradesAuditMessage(
      [{ date: '2026-05-01', buy: 0, sell: 0 }],
      { newBuyCount: 0, newSellCount: 0, withFullBaseline: [], withZeroBaseline: [] },
      ATTRIBUTION_WIRING_MERGED_AT_ISO,
    );
    expect(msg).toContain('신규 매수 0건');
    expect(msg).toContain('SHADOW 게이트');
  });

  it('27/27 전체 영속 → wiring 정상', () => {
    const t = makeTrade({ signalTime: '2026-05-01T01:00:00.000Z' });
    const msg = formatRecentTradesAuditMessage(
      [{ date: '2026-05-01', buy: 1, sell: 0 }],
      { newBuyCount: 1, newSellCount: 0, withFullBaseline: [t], withZeroBaseline: [] },
      ATTRIBUTION_WIRING_MERGED_AT_ISO,
    );
    expect(msg).toContain('✅ wiring 정상');
    expect(msg).toContain('27/27 영속된 신규 trade');
  });

  it('0/27 누락 → wiring 누수 경보', () => {
    const t = makeTrade({ signalTime: '2026-05-01T01:00:00.000Z' });
    const msg = formatRecentTradesAuditMessage(
      [{ date: '2026-05-01', buy: 1, sell: 0 }],
      { newBuyCount: 1, newSellCount: 0, withFullBaseline: [], withZeroBaseline: [t] },
      ATTRIBUTION_WIRING_MERGED_AT_ISO,
    );
    expect(msg).toContain('🚨 wiring 누수');
    expect(msg).toContain('누락된 buy 호출자');
  });

  it('머지 시점 표시 정확', () => {
    const msg = formatRecentTradesAuditMessage(
      [{ date: '2026-05-01', buy: 0, sell: 0 }],
      { newBuyCount: 0, newSellCount: 0, withFullBaseline: [], withZeroBaseline: [] },
      ATTRIBUTION_WIRING_MERGED_AT_ISO,
    );
    expect(msg).toContain('2026-05-01 02:58 KST');
    expect(msg).toContain(ATTRIBUTION_WIRING_MERGED_AT_ISO);
  });

  it('일별 카운트 라인 표시', () => {
    const msg = formatRecentTradesAuditMessage(
      [{ date: '2026-04-30', buy: 2, sell: 1 }, { date: '2026-05-01', buy: 0, sell: 3 }],
      { newBuyCount: 0, newSellCount: 0, withFullBaseline: [], withZeroBaseline: [] },
      ATTRIBUTION_WIRING_MERGED_AT_ISO,
    );
    expect(msg).toContain('2026-04-30: buy=2  sell=1');
    expect(msg).toContain('2026-05-01: buy=0  sell=3');
  });
});

describe('command 등록 메타', () => {
  it('name + alias + 카테고리 + read-only', async () => {
    const mod = await import('./recentTradesAudit.cmd.js');
    expect(mod.default.name).toBe('/recent_trades_audit');
    expect(mod.default.aliases).toContain('/rta');
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.riskLevel).toBe(0);
    expect(mod.default.visibility).toBe('ADMIN');
  });
});
