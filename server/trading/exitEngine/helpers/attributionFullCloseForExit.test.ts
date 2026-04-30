/**
 * @responsibility PR-2 emitFullCloseAttributionForExit wrapper 회귀 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';

describe('exitEngine/helpers/attribution.emitFullCloseAttributionForExit (PR-2)', () => {
  let tmpDir: string;
  let helpers: typeof import('./attribution.js');
  let repo: typeof import('../../../persistence/attributionRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-exit-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.ATTRIBUTION_FULL_CLOSE_DISABLED;
    vi.resetModules();
    helpers = await import('./attribution.js');
    repo = await import('../../../persistence/attributionRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.ATTRIBUTION_FULL_CLOSE_DISABLED;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  function makeShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
    return {
      id: 'TS1',
      stockCode: '005930',
      stockName: '삼성전자',
      signalTime: '2026-04-28T00:00:00.000Z',
      signalPrice: 100,
      shadowEntryPrice: 100,
      quantity: 0,
      stopLoss: 90,
      targetPrice: 120,
      status: 'HIT_STOP',
      entryRegime: 'R2_BULL',
      entryConditionScores: { 1: 5, 9: 7, 18: 7 } as Record<number, number>,
      ...overrides,
    } as ServerShadowTrade;
  }

  it('정상 — entryConditionScores baseline 으로 FULL_CLOSE 영속', () => {
    const shadow = makeShadow();
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec).not.toBeNull();
    expect(rec!.attributionType).toBe('FULL_CLOSE');
    expect(rec!.qtyRatio).toBe(1.0);
    expect(rec!.tradeId).toBe('TS1');
    expect(rec!.conditionScores[9]).toBe(7);
    expect(rec!.holdingDays).toBe(2); // 4/28 → 4/30 = 2일

    expect(repo.loadAttributionRecords()).toHaveLength(1);
  });

  it('shadow.entryConditionScores 부재 → null 반환 (PR-1 baseline 미영속 레거시)', () => {
    const shadow = makeShadow({ entryConditionScores: undefined });
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec).toBeNull();
    expect(repo.loadAttributionRecords()).toHaveLength(0);
  });

  it('빈 entryConditionScores 객체 → null 반환', () => {
    const shadow = makeShadow({ entryConditionScores: {} });
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec).toBeNull();
  });

  it('shadow.id 부재 → stockCode fallback', () => {
    const shadow = makeShadow();
    delete (shadow as any).id;
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec!.tradeId).toBe('005930');
  });

  it('exitRuleTag → sellReason 영속', () => {
    const shadow = makeShadow();
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 120,
      returnPct: 20,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'TARGET_EXIT',
    });
    expect(rec!.sellReason).toBe('TARGET_EXIT');
    expect(rec!.isWin).toBe(true);
  });

  it('signalTime 잘못된 ISO → holdingDays=0', () => {
    const shadow = makeShadow({ signalTime: 'invalid-date' });
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec!.holdingDays).toBe(0);
  });

  it('ENV ATTRIBUTION_FULL_CLOSE_DISABLED=true → null (긴급 롤백)', async () => {
    process.env.ATTRIBUTION_FULL_CLOSE_DISABLED = 'true';
    vi.resetModules();
    helpers = await import('./attribution.js');

    const shadow = makeShadow();
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 95,
      returnPct: -5.0,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec).toBeNull();
  });

  it('entryRegime 영속', () => {
    const shadow = makeShadow({ entryRegime: 'R5_CAUTION' });
    const rec = helpers.emitFullCloseAttributionForExit({
      shadow,
      exitPrice: 90,
      returnPct: -10,
      closedAt: '2026-04-30T05:30:00.000Z',
      exitRuleTag: 'CASCADE_FINAL',
    });
    expect(rec!.entryRegime).toBe('R5_CAUTION');
  });

  it('emitPartialAttributionForSell 도 shadow.entryConditionScores baseline 활용 (PR-1 정합)', () => {
    const shadow = makeShadow({ originalQuantity: 10, status: 'PARTIALLY_FILLED' });
    const rec = helpers.emitPartialAttributionForSell({
      shadow,
      fill: { type: 'SELL', subType: 'FULL_CLOSE', qty: 3, price: 110, pnlPct: 10, timestamp: '2026-04-29T05:00:00.000Z', reason: 'partial' } as any,
      remainingQty: 7,
      newFillId: 'fill-x',
      now: '2026-04-29T05:00:00.000Z',
    });
    expect(rec).not.toBeNull();
    expect(rec!.attributionType).toBe('PARTIAL');
    expect(rec!.qtyRatio).toBeCloseTo(0.3, 2);
    expect(rec!.conditionScores[9]).toBe(7);
  });
});
