/**
 * @responsibility PR-42 M1 — exitEngine.emitPartialAttributionForSell wiring 회귀 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('exitEngine — emitPartialAttributionForSell (PR-42 M1)', () => {
  let tmpDir: string;
  let exitEngine: typeof import('./exitEngine.js');
  let attributionRepo: typeof import('../persistence/attributionRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-attribution-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    attributionRepo = await import('../persistence/attributionRepo.js');
    exitEngine = await import('./exitEngine.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  function makeShadow(overrides: Record<string, unknown> = {}): any {
    return {
      id:               'T-PR42',
      stockCode:        '005930',
      stockName:        '삼성전자',
      signalTime:       '2026-04-22T00:00:00.000Z',
      shadowEntryPrice: 70_000,
      quantity:         100,
      originalQuantity: 100,
      stopLoss:         66_500,
      targetPrice:      77_000,
      status:           'ACTIVE',
      mode:             'SHADOW',
      entryRegime:      'R2_BULL',
      fills:            [],
      ...overrides,
    };
  }

  it('baseline FULL_CLOSE 가 있을 때 PARTIAL 레코드 1건 추가 + qtyRatio 가중', () => {
    // baseline: 동일 tradeId 의 FULL_CLOSE 레코드 (conditionScores 보유)
    attributionRepo.appendAttributionRecord({
      tradeId:    'T-PR42',
      stockCode:  '005930',
      stockName:  '삼성전자',
      closedAt:   '2026-04-23T00:00:00.000Z',
      returnPct:  3.0,
      isWin:      true,
      conditionScores: { 1: 8, 2: 7, 3: 9 },
      holdingDays: 1,
      attributionType: 'FULL_CLOSE',
      qtyRatio:   1.0,
    });

    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow(),
      fill: {
        type:      'SELL',
        subType:   'LIMIT_TP1',
        qty:       30,
        price:     74_000,
        pnl:       120_000,
        pnlPct:    5.71,
        reason:    '분할익절 트랜치 30%',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 70,
      newFillId:    'fill-A',
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result).not.toBeNull();
    const records = attributionRepo.loadAttributionRecords();
    const partials = records.filter(r => r.attributionType === 'PARTIAL');
    expect(partials).toHaveLength(1);
    expect(partials[0].tradeId).toBe('T-PR42');
    expect(partials[0].fillId).toBe('fill-A');
    expect(partials[0].qtyRatio).toBeCloseTo(0.30, 6);
    expect(partials[0].returnPct).toBeCloseTo(5.71, 4);
    expect(partials[0].isWin).toBe(true);
    expect(partials[0].entryRegime).toBe('R2_BULL');
    expect(partials[0].conditionScores).toEqual({ 1: 8, 2: 7, 3: 9 });
  });

  it('baseline 없으면 null 반환 — 학습 오염 차단', () => {
    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow(),
      fill: {
        type:      'SELL',
        subType:   'LIMIT_TP1',
        qty:       30,
        price:     74_000,
        pnl:       120_000,
        pnlPct:    5.71,
        reason:    '분할익절',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 70,
      newFillId:    'fill-noop',
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result).toBeNull();
    expect(attributionRepo.loadAttributionRecords()).toEqual([]);
  });

  it('remainingQty=0 (전량 청산) 은 emit 스킵 — FULL_CLOSE 경로 충돌 방지', () => {
    attributionRepo.appendAttributionRecord({
      tradeId: 'T-PR42', stockCode: '005930', stockName: '삼성전자',
      closedAt: '2026-04-23T00:00:00.000Z', returnPct: 3.0, isWin: true,
      conditionScores: { 1: 8 }, holdingDays: 1,
      attributionType: 'FULL_CLOSE', qtyRatio: 1.0,
    });

    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow({ quantity: 0 }),
      fill: {
        type: 'SELL', subType: 'HARD_STOP', qty: 100, price: 65_000,
        pnl: -500_000, pnlPct: -7.14, reason: '하드스톱',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 0,
      newFillId:    'fill-full',
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result).toBeNull();
    const records = attributionRepo.loadAttributionRecords();
    expect(records.filter(r => r.attributionType === 'PARTIAL')).toHaveLength(0);
  });

  it('newFillId 미지정 시 emit 스킵 — appendFill 실패 방어', () => {
    attributionRepo.appendAttributionRecord({
      tradeId: 'T-PR42', stockCode: '005930', stockName: '삼성전자',
      closedAt: '2026-04-23T00:00:00.000Z', returnPct: 3.0, isWin: true,
      conditionScores: { 1: 8 }, holdingDays: 1,
      attributionType: 'FULL_CLOSE', qtyRatio: 1.0,
    });

    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow(),
      fill: {
        type: 'SELL', subType: 'LIMIT_TP1', qty: 30, price: 74_000,
        pnl: 120_000, pnlPct: 5.71, reason: '분할익절',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 70,
      newFillId:    undefined,
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result).toBeNull();
  });

  it('originalQuantity 누락 fallback: fill.qty + remainingQty 합으로 baseQty 산출', () => {
    attributionRepo.appendAttributionRecord({
      tradeId: 'T-PR42', stockCode: '005930', stockName: '삼성전자',
      closedAt: '2026-04-23T00:00:00.000Z', returnPct: 3.0, isWin: true,
      conditionScores: { 1: 8 }, holdingDays: 1,
      attributionType: 'FULL_CLOSE', qtyRatio: 1.0,
    });

    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow({ originalQuantity: undefined, quantity: 70 }),
      fill: {
        type: 'SELL', subType: 'LIMIT_TP1', qty: 30, price: 74_000,
        pnl: 120_000, pnlPct: 5.71, reason: '분할익절',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 70,
      newFillId:    'fill-fallback',
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result).not.toBeNull();
    expect(result!.qtyRatio).toBeCloseTo(0.30, 6); // 30 / (30+70) = 0.30
  });

  it('holdingDays — signalTime 부터 closedAt 까지 일수 계산', () => {
    attributionRepo.appendAttributionRecord({
      tradeId: 'T-PR42', stockCode: '005930', stockName: '삼성전자',
      closedAt: '2026-04-23T00:00:00.000Z', returnPct: 3.0, isWin: true,
      conditionScores: { 1: 8 }, holdingDays: 1,
      attributionType: 'FULL_CLOSE', qtyRatio: 1.0,
    });

    const result = exitEngine.emitPartialAttributionForSell({
      shadow: makeShadow({ signalTime: '2026-04-20T00:00:00.000Z' }),
      fill: {
        type: 'SELL', subType: 'LIMIT_TP1', qty: 30, price: 74_000,
        pnl: 120_000, pnlPct: 5.71, reason: '분할익절',
        timestamp: '2026-04-24T04:30:00.000Z',
      } as any,
      remainingQty: 70,
      newFillId:    'fill-hold',
      now:          '2026-04-24T04:30:00.000Z',
    });

    expect(result!.holdingDays).toBe(4); // 4월 20 → 24 = 4일
  });
});
