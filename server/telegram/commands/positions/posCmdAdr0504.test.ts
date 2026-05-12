// @responsibility ADR-0504 /pos cmd wiring + POSITION_STATUS_CARD + forbidden 정적 grep.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORIGINAL_ENV = { ...process.env };
let TEST_DIR = '';

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'poscmd0504-'));
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE;
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
  originalQuantity: number;
  stopLoss: number;
  targetPrice: number;
  status: string;
  mode: 'SHADOW' | 'LIVE';
  watchlistSource?: string;
  fills: Array<{ id: string; type: 'BUY' | 'SELL'; qty: number; price: number; reason: string; timestamp: string; status: string }>;
}

function writeShadowTrades(trades: MinimalTrade[]): void {
  fs.writeFileSync(path.join(TEST_DIR, 'shadow-trades.json'), JSON.stringify(trades), 'utf-8');
}

function realTrade(o: Partial<MinimalTrade> = {}): MinimalTrade {
  return {
    id: o.id ?? 't1',
    stockCode: o.stockCode ?? '005930',
    stockName: o.stockName ?? '삼성전자',
    signalTime: o.signalTime ?? '2026-05-12T00:00:00.000Z',
    signalPrice: 70000,
    shadowEntryPrice: 70000,
    quantity: 1,
    originalQuantity: 1,
    stopLoss: 65000,
    targetPrice: 80000,
    status: 'ACTIVE',
    mode: 'SHADOW',
    watchlistSource: o.watchlistSource ?? 'PRE_MARKET',
    fills: [{ id: 'f1', type: 'BUY', qty: 1, price: 70000, reason: 'buy', timestamp: '2026-05-12T00:00:00Z', status: 'CONFIRMED' }],
  };
}

describe('ADR-0504 /pos cmd wiring', () => {
  it('빈 보유 → 응답 메시지 "현재 Shadow 보유 포지션 없음"', async () => {
    writeShadowTrades([]);
    const replyMock: ReturnType<typeof vi.fn> = vi.fn(async (_msg: string) => {});
    const m = await import('./pos.cmd.js');
    await m.default.execute({ args: [], reply: replyMock } as Parameters<typeof m.default.execute>[0]);
    expect(replyMock).toHaveBeenCalledTimes(1);
    expect(replyMock.mock.calls[0][0]).toContain('현재 Shadow 보유 포지션 없음');
  });

  it('정상 보유 1건 → 카드 응답 + 종목명 포함 + Shadow note', async () => {
    writeShadowTrades([realTrade({ stockCode: '005930', stockName: '삼성전자' })]);
    const replyMock: ReturnType<typeof vi.fn> = vi.fn(async (_msg: string) => {});
    const m = await import('./pos.cmd.js');
    await m.default.execute({ args: [], reply: replyMock } as Parameters<typeof m.default.execute>[0]);
    expect(replyMock).toHaveBeenCalledTimes(1);
    const msg = replyMock.mock.calls[0][0] as unknown as string;
    expect(msg).toContain('삼성전자');
    expect(msg).toContain('005930');
    expect(msg).toContain('[보유 포지션] 1개');
    expect(msg).toContain('[SHADOW]'); // SHADOW note
  });

  it('SHADOW_NEAR_BREAKOUT 학습 entry 차단 → 빈 보유 응답', async () => {
    writeShadowTrades([
      realTrade({ id: 'learn-1', watchlistSource: 'SHADOW_NEAR_BREAKOUT' }),
      realTrade({ id: 'learn-2', stockCode: '000660', watchlistSource: 'SHADOW_NEAR_BREAKOUT' }),
    ]);
    const replyMock: ReturnType<typeof vi.fn> = vi.fn(async (_msg: string) => {});
    const m = await import('./pos.cmd.js');
    await m.default.execute({ args: [], reply: replyMock } as Parameters<typeof m.default.execute>[0]);
    expect(replyMock.mock.calls[0][0]).toContain('현재 Shadow 보유 포지션 없음');
  });
});

describe('ADR-0504 /pos cmd 정적 grep 가드', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'server/telegram/commands/positions/pos.cmd.ts'),
    'utf-8',
  );

  it('shadowPositionLedger SSOT 위임 + getOpenPositions 사용', () => {
    expect(src).toContain('getOpenPositions');
    expect(src).toContain('shadowPositionLedger');
  });

  it('POSITION_STATUS_CARD cardType 명시', () => {
    expect(src).toContain("'POSITION_STATUS_CARD'");
  });

  it('validatePositionCardPayload + buildShadowPositionCardPayload SSOT 사용', () => {
    expect(src).toContain('validatePositionCardPayload');
    expect(src).toContain('buildShadowPositionCardPayload');
  });

  it('forbidden 패턴 부재 — lastKnownPositions / previousTelegramCache / loadCounterfactuals', () => {
    expect(src).not.toMatch(/lastKnownPositions/);
    expect(src).not.toMatch(/previousTelegramCache/);
    expect(src).not.toMatch(/loadCounterfactuals/);
    expect(src).not.toMatch(/loadProvisionalShadowLedger/);
  });

  it('KIS 주문 함수 5종 / autoTradeEngine 등 import 0건', () => {
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
    expect(src).not.toMatch(/from.*autoTradeEngine|from.*orderExecutor|from.*trancheExecutor/);
  });
});
