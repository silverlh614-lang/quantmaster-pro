// @responsibility EntryGate 단위 테스트용 mock context + WatchlistEntry 픽스처 헬퍼
/**
 * entryGates/__tests__/_testHelpers.ts — EntryGate 테스트 헬퍼 (ADR-0030).
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import { createScanCounters } from '../../scanDiagnostics.js';
import type { EntryGateContext } from '../types.js';

/** 정상적으로 RRR 임계 통과하는 기본 종목 픽스처 (entry=100, target=120, stop=90 → RRR=2.0). */
export function makeMockStock(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    code: '005930',
    name: '삼성전자',
    entryPrice: 100,
    targetPrice: 120,
    stopLoss: 90,
    addedAt: '2026-04-26T00:00:00.000Z',
    sector: '반도체',
    track: 'A',
    ...overrides,
  } as WatchlistEntry;
}

export function makeMockShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'TEST-SHADOW',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-26T00:00:00.000Z',
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 100,
    stopLoss: 90,
    targetPrice: 120,
    status: 'ACTIVE',
    mode: 'SHADOW',
    fills: [],
    ...overrides,
  } as ServerShadowTrade;
}

export function makeMockCtx(overrides: Partial<EntryGateContext> = {}): EntryGateContext {
  return {
    stock: overrides.stock ?? makeMockStock(),
    shadows: overrides.shadows ?? [],
    scanCounters: overrides.scanCounters ?? createScanCounters(),
  };
}
