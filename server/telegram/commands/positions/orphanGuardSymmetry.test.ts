// @responsibility 중복정리 #3 작업2 — guard7 orphan 비대칭 제거 특성화 (표시 경로 정합).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 네트워크 차단 — 가격 조회는 본 테스트 관심사 아님 (filter 정합만 검증).
vi.mock('../../../clients/kisClient.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCurrentPrice: vi.fn(async () => null),
}));
vi.mock('../../../clients/kisStreamClient.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRealtimePrice: vi.fn(() => undefined),
}));

const ORIGINAL_ENV = { ...process.env };
let TEST_DIR = '';

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-guard-'));
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

interface Fill {
  id: string;
  type: 'BUY' | 'SELL';
  qty: number;
  price: number;
  reason: string;
  timestamp: string;
  status: string;
}

interface MinimalTrade {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  signalPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  originalQuantity: number;
  stopLoss: number;
  targetPrice: number;
  status: string;
  mode: 'SHADOW' | 'LIVE';
  watchlistSource?: string;
  fills: Fill[];
}

function writeShadowTrades(trades: MinimalTrade[]): void {
  fs.writeFileSync(path.join(TEST_DIR, 'shadow-trades.json'), JSON.stringify(trades), 'utf-8');
}

/** 정상 포지션: BUY fill 1건 (가드7 통과). */
function normalTrade(o: Partial<MinimalTrade> = {}): MinimalTrade {
  return {
    id: o.id ?? 'normal-1',
    stockCode: o.stockCode ?? '005930',
    stockName: o.stockName ?? '삼성전자',
    signalTime: o.signalTime ?? '2026-05-12T00:00:00.000Z',
    signalPrice: 70000,
    shadowEntryPrice: 70000,
    quantity: 1,
    originalQuantity: 1,
    stopLoss: 65000,
    targetPrice: 80000,
    status: o.status ?? 'ACTIVE',
    mode: 'SHADOW',
    watchlistSource: o.watchlistSource ?? 'PRE_MARKET',
    fills: [
      { id: 'f1', type: 'BUY', qty: 1, price: 70000, reason: 'buy', timestamp: '2026-05-12T00:00:00Z', status: 'CONFIRMED' },
    ],
  };
}

/**
 * orphan: BUY fill 부재. getRemainingQty 가 legacy quantity 캐시(>0) 로 fallback →
 * 잔량>0 로 보이지만 BUY 체결 없음 (가드7 차단 대상).
 */
function orphanTrade(o: Partial<MinimalTrade> = {}): MinimalTrade {
  return {
    id: o.id ?? 'orphan-1',
    stockCode: o.stockCode ?? '000660',
    stockName: o.stockName ?? 'SK하이닉스',
    signalTime: o.signalTime ?? '2026-05-12T00:00:00.000Z',
    signalPrice: 120000,
    shadowEntryPrice: 120000,
    quantity: 1, // legacy 캐시 — getRemainingQty fallback 으로 잔량>0
    originalQuantity: 1,
    stopLoss: 110000,
    targetPrice: 140000,
    status: o.status ?? 'ACTIVE',
    mode: 'SHADOW',
    watchlistSource: o.watchlistSource ?? 'PRE_MARKET',
    fills: [], // BUY fill 부재 = orphan
  };
}

describe('중복정리 #3 작업2 — guard7 orphan 표시 비대칭 제거', () => {
  it('정상 포지션(BUY fill≥1)은 ShadowTradeRepo 표시 경로에 그대로 표시 (회귀 0)', async () => {
    writeShadowTrades([normalTrade({ id: 'normal-1', stockCode: '005930' })]);
    const m = await import('./shadowPositionSources.js');
    const snapshot = await m.aggregatePositionSources();
    const codes = snapshot.positions.map((p) => p.stockCode);
    expect(codes).toContain('005930');
    expect(snapshot.counts.shadowTradeOpenCount).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it('orphan(BUY fill 0)은 어떤 표시 경로로도 노출되지 않음 (ledger·repo 정합)', async () => {
    writeShadowTrades([orphanTrade({ id: 'orphan-1', stockCode: '000660' })]);
    const m = await import('./shadowPositionSources.js');
    const snapshot = await m.aggregatePositionSources();
    const codes = snapshot.positions.map((p) => p.stockCode);
    // orphan 은 ledger(가드7) + repo(가드7 신규) + aggregator(reader 가드7) 어디서도 미표시.
    expect(codes).not.toContain('000660');
  }, 15_000);

  it('정상 + orphan 혼재 → 정상만 표시, orphan만 사라짐 (orphan만 영향 단언)', async () => {
    writeShadowTrades([
      normalTrade({ id: 'normal-1', stockCode: '005930' }),
      orphanTrade({ id: 'orphan-1', stockCode: '000660' }),
    ]);
    const m = await import('./shadowPositionSources.js');
    const snapshot = await m.aggregatePositionSources();
    const codes = snapshot.positions.map((p) => p.stockCode);
    expect(codes).toContain('005930'); // 정상 불변
    expect(codes).not.toContain('000660'); // orphan 만 숨김
  }, 15_000);

  it('SHADOW_POSITION_LEDGER_GUARDS_DISABLED=true 시 orphan 표시 복원 (정합 우회)', async () => {
    process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED = 'true';
    writeShadowTrades([orphanTrade({ id: 'orphan-1', stockCode: '000660' })]);
    const m = await import('./shadowPositionSources.js');
    const snapshot = await m.aggregatePositionSources();
    const codes = snapshot.positions.map((p) => p.stockCode);
    // 가드 우회 시 ledger·repo 모두 orphan 을 다시 노출 (대칭 유지).
    expect(codes).toContain('000660');
  }, 15_000);
});
