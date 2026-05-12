// @responsibility ADR-0504 shadowPositionLedger 5중 가드 + ENV 우회 회귀.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORIGINAL_ENV = { ...process.env };
let TEST_DIR = '';

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0504-'));
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  if (TEST_DIR && fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

interface MinimalTrade {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  signalPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  status: string;
  watchlistSource?: string;
  fills?: Array<{ id: string; type: 'BUY' | 'SELL'; qty: number; price: number; reason: string; timestamp: string; status?: string }>;
  mode?: 'SHADOW' | 'LIVE';
  originalQuantity?: number;
}

function writeShadowTrades(trades: MinimalTrade[]): void {
  const file = path.join(TEST_DIR, 'shadow-trades.json');
  fs.writeFileSync(file, JSON.stringify(trades, null, 2), 'utf-8');
}

function makeTrade(o: Partial<MinimalTrade>): MinimalTrade {
  return {
    id: o.id ?? 'trade-1',
    stockCode: o.stockCode ?? '005930',
    stockName: o.stockName ?? '삼성전자',
    signalTime: o.signalTime ?? '2026-05-12T00:00:00.000Z',
    signalPrice: o.signalPrice ?? 70000,
    shadowEntryPrice: o.shadowEntryPrice ?? 70000,
    quantity: o.quantity ?? 1,
    stopLoss: o.stopLoss ?? 65000,
    targetPrice: o.targetPrice ?? 80000,
    status: o.status ?? 'ACTIVE',
    watchlistSource: o.watchlistSource,
    fills: o.fills,
    mode: o.mode ?? 'SHADOW',
    originalQuantity: o.originalQuantity ?? 1,
  };
}

function buyFill(qty = 1, price = 70000): MinimalTrade['fills'] {
  return [{
    id: 'f1',
    type: 'BUY',
    qty,
    price,
    reason: 'test',
    timestamp: '2026-05-12T00:00:00.000Z',
    status: 'CONFIRMED',
  }];
}

describe('ADR-0504 shadowPositionLedger 7중 가드 (가드 4/5 deprecated → 5중)', () => {
  it('가드 1: loadShadowTrades 영속 read — 빈 파일 → 빈 배열', async () => {
    writeShadowTrades([]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toEqual([]);
  });

  it('가드 2: isOpenShadowStatus filter — HIT_TARGET / HIT_STOP / REJECTED 제외', async () => {
    writeShadowTrades([
      makeTrade({ id: 't1', status: 'HIT_TARGET', fills: buyFill() }),
      makeTrade({ id: 't2', status: 'HIT_STOP', fills: buyFill() }),
      makeTrade({ id: 't3', status: 'REJECTED', fills: buyFill() }),
      makeTrade({ id: 't4', status: 'ACTIVE', fills: buyFill() }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    const open = m.getOpenPositions();
    expect(open).toHaveLength(1);
    expect(open[0].trade.id).toBe('t4');
  });

  it('가드 2: PENDING / ORDER_SUBMITTED / PARTIALLY_FILLED / ACTIVE / EUPHORIA_PARTIAL 모두 허용', async () => {
    writeShadowTrades([
      makeTrade({ id: 't1', status: 'PENDING', fills: buyFill() }),
      makeTrade({ id: 't2', stockCode: '000660', status: 'ORDER_SUBMITTED', fills: buyFill() }),
      makeTrade({ id: 't3', stockCode: '035720', status: 'PARTIALLY_FILLED', fills: buyFill() }),
      makeTrade({ id: 't4', stockCode: '035420', status: 'ACTIVE', fills: buyFill() }),
      makeTrade({ id: 't5', stockCode: '012450', status: 'EUPHORIA_PARTIAL', fills: buyFill() }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toHaveLength(5);
  });

  it('가드 3: SHADOW_NEAR_BREAKOUT 학습 entry 차단 (ADR-0452)', async () => {
    writeShadowTrades([
      makeTrade({ id: 't-learn', stockCode: '005930', status: 'ACTIVE', watchlistSource: 'SHADOW_NEAR_BREAKOUT', fills: buyFill() }),
      makeTrade({ id: 't-real', stockCode: '000660', status: 'ACTIVE', watchlistSource: 'PRE_MARKET', fills: buyFill() }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    const open = m.getOpenPositions();
    expect(open).toHaveLength(1);
    expect(open[0].trade.id).toBe('t-real');
  });

  it('가드 6: getRemainingQty > 0 (BUY-SELL 잔량) — 잔량 0 차단', async () => {
    writeShadowTrades([
      makeTrade({
        id: 't1',
        status: 'ACTIVE',
        fills: [
          { id: 'f1', type: 'BUY', qty: 1, price: 70000, reason: 'buy', timestamp: '2026-05-12T00:00:00Z', status: 'CONFIRMED' },
          { id: 'f2', type: 'SELL', qty: 1, price: 75000, reason: 'sell', timestamp: '2026-05-12T01:00:00Z', status: 'CONFIRMED' },
        ],
      }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toEqual([]);
  });

  it('가드 7: BUY fill 부재 (orphan) 차단', async () => {
    writeShadowTrades([
      makeTrade({ id: 't1', status: 'ACTIVE', fills: [], quantity: 1, originalQuantity: 1 }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toEqual([]);
  });

  it('가드 7: REVERTED BUY fill 차단 (isActiveFill=false)', async () => {
    writeShadowTrades([
      makeTrade({
        id: 't1',
        status: 'ACTIVE',
        fills: [
          { id: 'f1', type: 'BUY', qty: 1, price: 70000, reason: 'buy', timestamp: '2026-05-12T00:00:00Z', status: 'REVERTED' },
        ],
      }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toEqual([]);
  });
});

describe('ADR-0504 ENV `SHADOW_POSITION_LEDGER_GUARDS_DISABLED` 우회', () => {
  it('default (미설정) — 가드 활성', async () => {
    delete process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED;
    const m = await import('./shadowPositionLedger.js');
    expect(m.isShadowPositionLedgerGuardsDisabled()).toBe(false);
  });

  it('"true" — 가드 비활성', async () => {
    process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED = 'true';
    const m = await import('./shadowPositionLedger.js');
    expect(m.isShadowPositionLedgerGuardsDisabled()).toBe(true);
  });

  it('ADR-0157 정확 비교 — "1" / "TRUE" / "yes" / 빈문자열 모두 거부', async () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED = v;
      vi.resetModules();
      const m = await import('./shadowPositionLedger.js');
      expect(m.isShadowPositionLedgerGuardsDisabled()).toBe(false);
    }
  });

  it('ENV 활성 시 가드 3 (SHADOW_NEAR_BREAKOUT) skip — legacy 동작 부분 복원', async () => {
    process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED = 'true';
    writeShadowTrades([
      makeTrade({ id: 't-learn', status: 'ACTIVE', watchlistSource: 'SHADOW_NEAR_BREAKOUT', fills: buyFill() }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toHaveLength(1);
  });
});

describe('ADR-0504 getOpenPositionByCode 매칭', () => {
  it('정확 매칭', async () => {
    writeShadowTrades([
      makeTrade({ id: 't1', stockCode: '005930', status: 'ACTIVE', fills: buyFill() }),
      makeTrade({ id: 't2', stockCode: '000660', status: 'ACTIVE', fills: buyFill() }),
    ]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositionByCode('005930')?.trade.id).toBe('t1');
    expect(m.getOpenPositionByCode('000660')?.trade.id).toBe('t2');
  });

  it('미매칭 / 빈 input → null', async () => {
    writeShadowTrades([makeTrade({ stockCode: '005930', fills: buyFill() })]);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositionByCode('999999')).toBeNull();
    expect(m.getOpenPositionByCode('')).toBeNull();
  });
});

describe('ADR-0504 사용자 보고 시나리오 (11 SHADOW_NEAR_BREAKOUT entry → 빈 배열)', () => {
  it('11 SHADOW_NEAR_BREAKOUT entry 모두 차단 → 빈 보유 카드', async () => {
    const learnings: MinimalTrade[] = [];
    for (let i = 0; i < 11; i++) {
      learnings.push(makeTrade({
        id: `learn-${i}`,
        stockCode: `00000${i}`,
        status: 'ACTIVE',
        watchlistSource: 'SHADOW_NEAR_BREAKOUT',
        fills: buyFill(),
      }));
    }
    writeShadowTrades(learnings);
    const m = await import('./shadowPositionLedger.js');
    expect(m.getOpenPositions()).toEqual([]);
  });
});

describe('ADR-0504 절대 규칙 정적 grep 가드', () => {
  it('shadowPositionLedger.ts — KIS 주문 함수 5종 import 0건', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/persistence/shadowPositionLedger.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });

  it('shadowPositionLedger.ts — autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/persistence/shadowPositionLedger.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
  });
});
