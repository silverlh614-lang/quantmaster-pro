// @responsibility ADR-0504 validator + builder + dedupe + forbidden source 회귀.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDedupeKey,
  buildRealPositionCardPayload,
  buildShadowPositionCardPayload,
  validatePositionCardPayload,
} from './positionCardValidator.js';
import {
  FORBIDDEN_POSITION_SOURCES,
  type PositionCardPayload,
  type PositionCardPosition,
} from './positionCardTypes.js';
import type { OpenPositionEntry } from '../persistence/shadowPositionLedger.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type { KisHolding } from '../clients/kisClient/types.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function makePos(o: Partial<PositionCardPosition>): PositionCardPosition {
  return {
    stockCode: o.stockCode ?? '005930',
    stockName: o.stockName ?? '삼성전자',
    source: o.source ?? 'SHADOW_POSITION_LEDGER',
    qty: o.qty ?? 1,
    avgEntryPrice: o.avgEntryPrice ?? 70000,
    currentPrice: o.currentPrice ?? null,
    pnlPct: o.pnlPct ?? null,
    entryDate: o.entryDate ?? null,
    lotId: o.lotId ?? null,
  };
}

function makePayload(o: Partial<PositionCardPayload>): PositionCardPayload {
  const positions = o.positions ?? [];
  return {
    cardType: o.cardType ?? 'POSITION_MORNING_CARD',
    mode: o.mode ?? 'SHADOW',
    positions,
    summary: o.summary ?? { count: positions.length },
    executionImpact: o.executionImpact ?? 'NONE',
  };
}

function makeTrade(o: Partial<ServerShadowTrade>): ServerShadowTrade {
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
    mode: 'SHADOW',
    ...o,
  } as ServerShadowTrade;
}

function makeEntry(trade: ServerShadowTrade, qty = 1): OpenPositionEntry {
  return { trade, source: 'SHADOW_POSITION_LEDGER', qty, hasBuyFill: true };
}

describe('ADR-0504 validatePositionCardPayload — 결정 트리 5 분기', () => {
  it('1. ENV `TELEGRAM_POSITION_CARD_VALIDATE_SOURCE=false` → ok=true skip', () => {
    process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE = 'false';
    const bad = makePayload({
      mode: 'SHADOW',
      positions: [makePos({ source: 'BROKER_BALANCE' })],
    });
    expect(validatePositionCardPayload(bad)).toEqual({ ok: true });
  });

  it('2. SHADOW + non-LEDGER source → INVALID_SHADOW_POSITION_SOURCE', () => {
    const bad = makePayload({
      mode: 'SHADOW',
      positions: [makePos({ source: 'BROKER_BALANCE' })],
    });
    const r = validatePositionCardPayload(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('INVALID_SHADOW_POSITION_SOURCE');
      expect(r.details).toContain('BROKER_BALANCE');
    }
  });

  it('3. REAL + non-BROKER source → INVALID_REAL_POSITION_SOURCE', () => {
    const bad = makePayload({
      mode: 'REAL',
      positions: [makePos({ source: 'SHADOW_POSITION_LEDGER' })],
      executionImpact: 'LIVE',
    });
    const r = validatePositionCardPayload(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('INVALID_REAL_POSITION_SOURCE');
  });

  it('4. positions=[] + summary.count>0 → POSITION_COUNT_MISMATCH', () => {
    const bad = makePayload({
      mode: 'SHADOW',
      positions: [],
      summary: { count: 5 },
    });
    const r = validatePositionCardPayload(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('POSITION_COUNT_MISMATCH');
  });

  it('정상 SHADOW payload → ok=true', () => {
    const good = makePayload({
      mode: 'SHADOW',
      positions: [makePos({ source: 'SHADOW_POSITION_LEDGER' })],
    });
    expect(validatePositionCardPayload(good)).toEqual({ ok: true });
  });

  it('정상 REAL payload → ok=true', () => {
    const good = makePayload({
      mode: 'REAL',
      positions: [makePos({ source: 'BROKER_BALANCE' })],
      executionImpact: 'LIVE',
    });
    expect(validatePositionCardPayload(good)).toEqual({ ok: true });
  });

  it('positions=[] + summary.count=0 → ok=true', () => {
    const empty = makePayload({ mode: 'SHADOW', positions: [], summary: { count: 0 } });
    expect(validatePositionCardPayload(empty)).toEqual({ ok: true });
  });
});

describe('ADR-0504 forbidden 8 source 영구 차단', () => {
  for (const forbidden of FORBIDDEN_POSITION_SOURCES) {
    it(`'${forbidden}' source → INVALID_POSITION_SOURCE_BLOCKED`, () => {
      const bad = makePayload({
        mode: 'SHADOW',
        positions: [makePos({ source: forbidden as 'SHADOW_POSITION_LEDGER' })],
      });
      const r = validatePositionCardPayload(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('INVALID_POSITION_SOURCE_BLOCKED');
        expect(r.details).toContain(forbidden);
      }
    });
  }

  it('FORBIDDEN_POSITION_SOURCES 8종 정합 — 사용자 명시 SSOT', () => {
    expect(FORBIDDEN_POSITION_SOURCES).toEqual([
      'WATCHLIST',
      'RECOMMENDATION_HISTORY',
      'SHADOW_CANDIDATE',
      'RESERVED_ORDER',
      'COUNTERFACTUAL',
      'PREVIOUS_TELEGRAM_CACHE',
      'LAST_KNOWN_POSITIONS',
      'MORNING_SCAN_RESULT',
    ]);
    expect(Object.isFrozen(FORBIDDEN_POSITION_SOURCES)).toBe(true);
  });
});

describe('ADR-0504 buildDedupeKey SSOT', () => {
  it('mode + source + stockCode + entryDate 결합', () => {
    expect(buildDedupeKey({
      mode: 'SHADOW',
      source: 'SHADOW_POSITION_LEDGER',
      stockCode: '005930',
      entryDate: '2026-05-12',
    })).toBe('SHADOW:SHADOW_POSITION_LEDGER:005930:2026-05-12');
  });

  it('entryDate 부재 → "NO_ENTRY" literal', () => {
    expect(buildDedupeKey({
      mode: 'REAL',
      source: 'BROKER_BALANCE',
      stockCode: '000660',
    })).toBe('REAL:BROKER_BALANCE:000660:NO_ENTRY');
  });
});

describe('ADR-0504 buildShadowPositionCardPayload — dedupe + lot aggregate', () => {
  it('단일 entry → positions 1건 + summary.count=1', async () => {
    const trade = makeTrade({ id: 't1', stockCode: '005930' });
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_MORNING_CARD',
      positions: [makeEntry(trade, 1)],
    });
    expect(payload.mode).toBe('SHADOW');
    expect(payload.executionImpact).toBe('NONE');
    expect(payload.positions).toHaveLength(1);
    expect(payload.positions[0].source).toBe('SHADOW_POSITION_LEDGER');
    expect(payload.positions[0].qty).toBe(1);
    expect(payload.summary.count).toBe(1);
    expect(payload.summary.aggregateCount).toBe(1);
  });

  it('동일 stockCode + 동일 entryDate 다중 lot — totalQty 합산 + 가중평균 entry + earliest entryDate', async () => {
    const t1 = makeTrade({ id: 't1', stockCode: '005930', signalTime: '2026-05-10T00:00:00Z', shadowEntryPrice: 70000 });
    const t2 = makeTrade({ id: 't2', stockCode: '005930', signalTime: '2026-05-10T00:00:00Z', shadowEntryPrice: 80000 });
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_STATUS_CARD',
      positions: [makeEntry(t1, 2), makeEntry(t2, 3)],
    });
    expect(payload.positions).toHaveLength(1);
    expect(payload.positions[0].qty).toBe(5); // 2+3
    // 가중평균 = (70000*2 + 80000*3) / 5 = 76000
    expect(payload.positions[0].avgEntryPrice).toBe(76000);
    expect(payload.positions[0].entryDate).toBe('2026-05-10T00:00:00Z');
    expect(payload.positions[0].lotId).toBe('agg:2');
  });

  it('서로 다른 stockCode → 별도 positions', async () => {
    const t1 = makeTrade({ id: 't1', stockCode: '005930' });
    const t2 = makeTrade({ id: 't2', stockCode: '000660' });
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_MORNING_CARD',
      positions: [makeEntry(t1, 1), makeEntry(t2, 1)],
    });
    expect(payload.positions).toHaveLength(2);
  });

  it('enrich callback — currentPrice / pnlPct 주입', async () => {
    const trade = makeTrade({ id: 't1', stockCode: '005930' });
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_MORNING_CARD',
      positions: [makeEntry(trade, 1)],
      enrich: async () => ({ currentPrice: 75000, pnlPct: 7.14 }),
    });
    expect(payload.positions[0].currentPrice).toBe(75000);
    expect(payload.positions[0].pnlPct).toBeCloseTo(7.14);
  });

  it('빈 positions → 빈 payload + summary.count=0', async () => {
    const payload = await buildShadowPositionCardPayload({
      cardType: 'POSITION_MORNING_CARD',
      positions: [],
    });
    expect(payload.positions).toEqual([]);
    expect(payload.summary.count).toBe(0);
    expect(payload.summary.aggregateCount).toBe(0);
  });
});

describe('ADR-0504 buildRealPositionCardPayload', () => {
  it('KisHolding[] → BROKER_BALANCE source + executionImpact LIVE', () => {
    const holdings: KisHolding[] = [
      { pdno: '005930', prdtName: '삼성전자', hldgQty: 10, pchsAvgPric: 70000, prpr: 75000, evluPflsAmt: 50000 },
      { pdno: '000660', prdtName: 'SK하이닉스', hldgQty: 5, pchsAvgPric: 100000, prpr: null, evluPflsAmt: null },
    ];
    const payload = buildRealPositionCardPayload({
      cardType: 'POSITION_STATUS_CARD',
      holdings,
    });
    expect(payload.mode).toBe('REAL');
    expect(payload.executionImpact).toBe('LIVE');
    expect(payload.positions).toHaveLength(2);
    expect(payload.positions.every((p) => p.source === 'BROKER_BALANCE')).toBe(true);
    expect(payload.positions[0].qty).toBe(10);
    expect(payload.positions[0].avgEntryPrice).toBe(70000);
  });

  it('hldgQty=0 entry filter', () => {
    const holdings: KisHolding[] = [
      { pdno: '005930', prdtName: '삼성', hldgQty: 0, pchsAvgPric: 70000, prpr: 75000, evluPflsAmt: 0 },
    ];
    const payload = buildRealPositionCardPayload({ cardType: 'POSITION_STATUS_CARD', holdings });
    expect(payload.positions).toEqual([]);
  });
});
