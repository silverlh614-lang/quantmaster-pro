/**
 * sellPhase4.test.ts — Phase 4 외부 시스템 연결 검증
 *
 * 1) PositionEventBus pub/sub 동작
 * 2) sellChecklist27 Survival/Warning/Precision 임계
 * 3) calcTrailingStopPrice 손절가 계산 + BEP 보호
 * 4) syncTrailingOco 어댑터 주입 (mock)
 * 5) VDA 점수 + L5.5 레이어 통합
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PositionEventBus,
  publishSellSignals,
  evaluateSellChecklist27,
  SURVIVAL_EXIT_IDS,
  WARNING_EXIT_IDS,
  PRECISION_EXIT_IDS,
  calcTrailingStopPrice,
  syncTrailingOco,
  calcVdaScore,
  evaluateSellSignalsFromContext,
  type OcoAdapter,
  type PositionEvent,
  type ConditionBreachMap,
} from '../sell';
import type {
  ActivePosition,
  SellContext,
  VolumeStats,
  SellSignal,
} from '../../../types/sell';

function basePosition(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    id: 'pos_p4',
    stockCode: '005930',
    name: 'test',
    profile: 'A',
    entryPrice: 100_000,
    entryDate: '2026-01-01T00:00:00.000Z',
    currentPrice: 100_000,
    quantity: 10,
    entryROEType: 3,
    entryRegime: 'R2_BULL',
    highSinceEntry: 100_000,
    trailingEnabled: false,
    trailingHighWaterMark: 100_000,
    trailPct: 0.10,
    trailingRemainingRatio: 0.40,
    revalidated: false,
    takenProfit: [],
    ...overrides,
  };
}

// ─── PositionEventBus ─────────────────────────────────────────────────────────

describe('PositionEventBus', () => {
  it('publish → subscribe 동작', () => {
    const bus = new PositionEventBus();
    const received: PositionEvent[] = [];
    bus.subscribe(e => { received.push(e); });

    bus.publish({
      type: 'STOP_HIT',
      positionId: 'p1',
      stockCode: '005930',
      timestamp: 0,
      payload: {
        kind: 'SELL_SIGNAL',
        signal: { action: 'HARD_STOP', ratio: 1, orderType: 'MARKET', reason: 'test' },
        position: basePosition(),
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('STOP_HIT');
  });

  it('type 필터로 일부 이벤트만 구독', () => {
    const bus = new PositionEventBus();
    const received: PositionEvent[] = [];
    bus.subscribe(e => { received.push(e); }, ['LIFECYCLE_TRANSITION']);

    const baseEvt = (type: PositionEvent['type']): PositionEvent => ({
      type,
      positionId: 'p1',
      stockCode: '005930',
      timestamp: 0,
      payload: { kind: 'HIGH_WATER_MARK', newMark: 0, previousMark: 0, position: basePosition() },
    });
    bus.publish(baseEvt('STOP_HIT'));
    bus.publish(baseEvt('LIFECYCLE_TRANSITION'));
    bus.publish(baseEvt('PROFIT_TAKE'));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('LIFECYCLE_TRANSITION');
  });

  it('unsubscribe 반환값 호출 시 구독 해제', () => {
    const bus = new PositionEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe(handler);
    expect(bus.subscriberCount).toBe(1);
    unsub();
    expect(bus.subscriberCount).toBe(0);
  });

  it('핸들러 실패가 다른 핸들러 실행을 막지 않음', () => {
    const bus = new PositionEventBus();
    const okHandler = vi.fn();
    const errConsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe(okHandler);

    bus.publish({
      type: 'STOP_HIT',
      positionId: 'p',
      stockCode: 'x',
      timestamp: 0,
      payload: { kind: 'HIGH_WATER_MARK', newMark: 0, previousMark: 0, position: basePosition() },
    });
    expect(okHandler).toHaveBeenCalledTimes(1);
    errConsole.mockRestore();
  });

  it('publishSellSignals: SellSignal[] → 이벤트 일괄 발행', () => {
    const bus = new PositionEventBus();
    const received: PositionEvent[] = [];
    bus.subscribe(e => { received.push(e); });

    const signals: SellSignal[] = [
      { action: 'HARD_STOP',   ratio: 1,   orderType: 'MARKET', reason: 'stop' },
      { action: 'PROFIT_TAKE', ratio: 0.3, orderType: 'LIMIT',  reason: 'profit' },
    ];
    publishSellSignals(bus, basePosition(), signals);
    expect(received.map(e => e.type)).toEqual(['STOP_HIT', 'PROFIT_TAKE']);
  });
});

// ─── sellChecklist27 ──────────────────────────────────────────────────────────

describe('evaluateSellChecklist27 (매수 Gate 대칭)', () => {
  it('Survival 3개 이상 이탈 → FULL_EXIT', () => {
    const breach: ConditionBreachMap = {
      1: true, 3: true, 5: true, // Survival 3개 이탈
    };
    const r = evaluateSellChecklist27(basePosition(), { currentBreachMap: breach });
    expect(r.verdict).toBe('FULL_EXIT');
    expect(r.sellRatio).toBe(1.0);
    expect(r.survivalFails).toEqual([1, 3, 5]);
  });

  it('Warning 9개 이상 이탈 → HALF_EXIT', () => {
    const breach: ConditionBreachMap = {};
    for (const id of WARNING_EXIT_IDS.slice(0, 9)) {
      (breach as Record<number, boolean>)[id] = true;
    }
    const r = evaluateSellChecklist27(basePosition(), { currentBreachMap: breach });
    expect(r.verdict).toBe('HALF_EXIT');
    expect(r.sellRatio).toBe(0.5);
  });

  it('Precision 7개 이탈 → ALERT (매도 없음)', () => {
    const breach: ConditionBreachMap = {};
    for (const id of PRECISION_EXIT_IDS.slice(0, 7)) {
      (breach as Record<number, boolean>)[id] = true;
    }
    const r = evaluateSellChecklist27(basePosition(), { currentBreachMap: breach });
    expect(r.verdict).toBe('ALERT');
    expect(r.sellRatio).toBe(0);
  });

  it('entryPassMap이 있으면 "매수 때 통과 AND 현재 이탈"만 카운트', () => {
    const entry: ConditionBreachMap = { 1: false, 3: true, 5: false };
    const curr: ConditionBreachMap  = { 1: true, 3: true, 5: true };
    const r = evaluateSellChecklist27(basePosition(), {
      entryPassMap: entry,
      currentBreachMap: curr,
    });
    // 1, 5는 매수 때 통과였고 지금 이탈 → count, 3은 매수 때부터 breach였으므로 skip
    expect(r.survivalFails).toEqual([1, 5]);
  });

  it('임계 미만이면 NONE', () => {
    const r = evaluateSellChecklist27(basePosition(), { currentBreachMap: {} });
    expect(r.verdict).toBe('NONE');
  });

  it('ID 배열 합계가 27개 (매수 27조건과 일치)', () => {
    expect(SURVIVAL_EXIT_IDS.length + WARNING_EXIT_IDS.length + PRECISION_EXIT_IDS.length).toBe(27);
  });
});

// ─── TrailingOcoSyncer ────────────────────────────────────────────────────────

describe('calcTrailingStopPrice', () => {
  it('신고가 × (1 - trailPct) 로 새 손절가 계산', () => {
    const pos = basePosition({
      trailingHighWaterMark: 120_000,
      trailPct: 0.10,
      currentPrice: 120_000,
    });
    const r = calcTrailingStopPrice({ position: pos, entryStopPrice: 85_000 });
    // 120k × 0.9 = 108k, entry 100k보다 수익 +20% → BEP 보호 발동 (신손절 ≥ entryPrice)
    expect(r.newStopPrice).toBe(108_000);
    expect(r.shouldUpdate).toBe(true);
    expect(r.bepProtectionActive).toBe(true);
  });

  it('수익 < 5%면 BEP 보호 비활성 + 원 손절가 하한 유지', () => {
    const pos = basePosition({
      trailingHighWaterMark: 102_000,
      trailPct: 0.10,
      currentPrice: 102_000,
    });
    // 102k × 0.9 = 91,800 → entryStopPrice 95_000보다 낮음 → 95_000 유지
    const r = calcTrailingStopPrice({ position: pos, entryStopPrice: 95_000 });
    expect(r.newStopPrice).toBe(95_000);
    expect(r.shouldUpdate).toBe(false);
    expect(r.bepProtectionActive).toBe(false);
  });
});

describe('syncTrailingOco (mock adapter)', () => {
  const stubAdapter = (opts: Partial<OcoAdapter> = {}): OcoAdapter => ({
    cancelOrder: opts.cancelOrder ?? (async () => true),
    registerStopLoss: opts.registerStopLoss ?? (async () => 'NEW_ORD_001'),
  });

  it('정상 경로: cancel → register → UPDATED', async () => {
    const pos = basePosition({
      trailingHighWaterMark: 120_000,
      trailPct: 0.10,
      currentPrice: 120_000,
    });
    const adapter = stubAdapter();
    const r = await syncTrailingOco({
      position: pos,
      entryStopPrice: 85_000,
      existingOrdNo: 'OLD_001',
      adapter,
    });
    expect(r.status).toBe('UPDATED');
    expect(r.newOrdNo).toBe('NEW_ORD_001');
    expect(r.newStopPrice).toBe(108_000);
  });

  it('취소 실패 시 CANCEL_FAILED + 버스로 CRITICAL 이벤트', async () => {
    const pos = basePosition({
      trailingHighWaterMark: 120_000,
      trailPct: 0.10,
      currentPrice: 120_000,
    });
    const bus = new PositionEventBus();
    const received: PositionEvent[] = [];
    bus.subscribe(e => { received.push(e); });
    const adapter = stubAdapter({ cancelOrder: async () => false });
    const r = await syncTrailingOco({
      position: pos,
      entryStopPrice: 85_000,
      existingOrdNo: 'OLD_001',
      adapter,
      bus,
    });
    expect(r.status).toBe('CANCEL_FAILED');
    expect(received).toHaveLength(1);
    if (received[0].payload.kind === 'EXECUTION') {
      expect(received[0].payload.signal.severity).toBe('CRITICAL');
    }
  });

  it('shouldUpdate=false면 어댑터 호출 없이 SKIPPED', async () => {
    const pos = basePosition({
      trailingHighWaterMark: 102_000,
      trailPct: 0.10,
      currentPrice: 102_000,
    });
    const cancel = vi.fn(async () => true);
    const register = vi.fn(async () => 'NEW');
    const r = await syncTrailingOco({
      position: pos,
      entryStopPrice: 95_000,
      existingOrdNo: 'OLD_001',
      adapter: { cancelOrder: cancel, registerStopLoss: register },
    });
    expect(r.status).toBe('SKIPPED');
    expect(cancel).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});

// ─── VDA ──────────────────────────────────────────────────────────────────────

describe('VDA (Volume Dry-up Alert)', () => {
  it('calcVdaScore: 거래량 완전 건조 + 변동성 수축 → score 1에 근접', () => {
    const stats: VolumeStats = {
      avgVolume20d: 300_000,  // 20일 평균
      avgVolume60d: 1_000_000, // 60일 평균 → ratio 0.3 (< 0.4 dry)
      priceStd20d: 500,
      priceStd60d: 1000,       // 0.5 (< 0.7 dry)
    };
    const r = calcVdaScore(stats);
    expect(r.score).toBeCloseTo(1.0, 5);
  });

  it('calcVdaScore: 평상 범위 → 0', () => {
    const stats: VolumeStats = {
      avgVolume20d: 1_000_000,
      avgVolume60d: 1_000_000,
      priceStd20d: 1000,
      priceStd60d: 1000,
    };
    expect(calcVdaScore(stats).score).toBe(0);
  });

  it('L5.5 VDA 레이어: 건조 + 캔들 미주입 → 경보(sellRatio=0)만', () => {
    const ctx: SellContext = {
      position: basePosition({ currentPrice: 105_000 }),
      regime: 'R2_BULL',
      preMortem: {
        currentROEType: 3,
        foreignNetBuy5d: 100,
        ma20: 105_000,
        ma60: 100_000,
        currentRegime: 'R2_BULL',
      },
      euphoria: null,
      volumeStats: {
        avgVolume20d: 300_000,
        avgVolume60d: 1_000_000,
        priceStd20d: 500,
        priceStd60d: 1000,
      },
      // candles 없음 → isNearCloudSupport=false → 경보만
    };
    const signals = evaluateSellSignalsFromContext(ctx);
    const vda = signals.find(s => s.action === 'VDA_ALERT');
    expect(vda).toBeDefined();
    expect(vda?.ratio).toBe(0);
  });
});
