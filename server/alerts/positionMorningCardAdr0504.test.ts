// @responsibility ADR-0504 positionMorningCard wiring + forbidden 정적 grep 회귀.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORIGINAL_ENV = { ...process.env };
let TEST_DIR = '';

vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice: vi.fn(async () => null),
}));

const sendPrivateAlertMock: ReturnType<typeof vi.fn> = vi.fn(async (_msg: string, _opts?: unknown) => ({ ok: true }));
vi.mock('./telegramClient.js', () => ({
  sendPrivateAlert: sendPrivateAlertMock,
  escapeHtml: (s: string) => s,
}));

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcard0504-'));
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.TELEGRAM_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_SHADOW_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_MORNING_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD;
  delete process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE;
  delete process.env.AUTO_TRADE_MODE;
  delete process.env.MORNING_CARD_SHADOW_HEADER_DISABLED;
  vi.resetModules();
  sendPrivateAlertMock.mockClear();
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
    id: o.id ?? 't-real',
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

function learnTrade(idx: number): MinimalTrade {
  return realTrade({ id: `learn-${idx}`, stockCode: `00000${idx}`, watchlistSource: 'SHADOW_NEAR_BREAKOUT' });
}

describe('ADR-0504 positionMorningCard wiring', () => {
  it('빈 보유 + default OFF → 발송 생략 + console.log 진단', async () => {
    writeShadowTrades([]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('skipped empty shadow positions'))).toBe(true);
    logSpy.mockRestore();
  });

  it('빈 보유 + ENV `TELEGRAM_SEND_EMPTY_POSITION_CARD=true` → 카드 발송 + 메시지 정확', async () => {
    process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD = 'true';
    writeShadowTrades([]);
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).toHaveBeenCalledTimes(1);
    const msg = sendPrivateAlertMock.mock.calls[0][0] as unknown as string;
    expect(msg).toContain('현재 Shadow 보유 포지션 없음');
    expect(msg).toContain('executionImpact=NONE');
    // 별도 dedupeKey
    const opts = sendPrivateAlertMock.mock.calls[0][1] as unknown as { dedupeKey: string };
    expect(opts.dedupeKey).toMatch(/^morning_card_empty:/);
  });

  it('11 SHADOW_NEAR_BREAKOUT 학습 entry 만 → 빈 보유 처리 (정상 Morning Card 미발송)', async () => {
    const learnings = Array.from({ length: 11 }, (_, i) => learnTrade(i));
    writeShadowTrades(learnings);
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    // default OFF → 발송 0회
    expect(sendPrivateAlertMock).not.toHaveBeenCalled();
  });

  it('ENV `TELEGRAM_MORNING_POSITION_CARD_ENABLED=false` → 차단 + 진단 로그', async () => {
    process.env.TELEGRAM_MORNING_POSITION_CARD_ENABLED = 'false';
    writeShadowTrades([realTrade({ id: 't1' })]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('TELEGRAM_MORNING_POSITION_CARD_ENABLED=false'))).toBe(true);
    logSpy.mockRestore();
  });

  it('ENV `TELEGRAM_POSITION_CARD_ENABLED=false` → 차단', async () => {
    process.env.TELEGRAM_POSITION_CARD_ENABLED = 'false';
    writeShadowTrades([realTrade({ id: 't1' })]);
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).not.toHaveBeenCalled();
  });

  it('정상 보유 1건 → 카드 발송 + validation 통과 + dedupeKey=morning_card:YYYY-MM-DD', async () => {
    writeShadowTrades([realTrade({ id: 't1', stockCode: '005930', stockName: '삼성전자' })]);
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).toHaveBeenCalledTimes(1);
    const msg = sendPrivateAlertMock.mock.calls[0][0] as unknown as string;
    expect(msg).toContain('삼성전자');
    expect(msg).toContain('005930');
    const opts = sendPrivateAlertMock.mock.calls[0][1] as unknown as { dedupeKey: string; category: string };
    expect(opts.dedupeKey).toMatch(/^morning_card:\d{4}-\d{2}-\d{2}$/);
    expect(opts.category).toBe('position_morning_card');
  });

  it('SHADOW_NEAR_BREAKOUT 11건 + 정상 보유 1건 → 정상 1건만 카드', async () => {
    const learnings = Array.from({ length: 11 }, (_, i) => learnTrade(i));
    learnings.push(realTrade({ id: 't-real', stockCode: '005930', stockName: '삼성전자' }));
    writeShadowTrades(learnings);
    const m = await import('./positionMorningCard.js');
    await m.sendPositionMorningCard();
    expect(sendPrivateAlertMock).toHaveBeenCalledTimes(1);
    const msg = sendPrivateAlertMock.mock.calls[0][0] as unknown as string;
    expect(msg).toContain('현재 1개 포지션 보유 중');
    expect(msg).not.toContain('000000'); // learning entries 미노출
  });
});

describe('ADR-0504 positionMorningCard 정적 grep 가드 (forbidden 패턴 영구 차단)', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'server/alerts/positionMorningCard.ts'),
    'utf-8',
  );

  it('lastKnownPositions / previousTelegramCache 패턴 부재', () => {
    expect(src).not.toMatch(/lastKnownPositions/);
    expect(src).not.toMatch(/previousTelegramCache/);
  });

  it('recommendationHistory / loadWatchlist / loadCounterfactuals import 부재', () => {
    expect(src).not.toMatch(/recommendationHistory/);
    expect(src).not.toMatch(/loadWatchlist\b/);
    expect(src).not.toMatch(/loadCounterfactuals\b/);
    expect(src).not.toMatch(/loadProvisionalShadowLedger/);
    expect(src).not.toMatch(/loadCounterfactualUniverseLearningLedger/);
  });

  it('aggregateAllPositions 호출 / import 영구 제거 (positionAggregator 우회 의무)', () => {
    // 코드 본체 호출 / import 만 차단 (ADR 헤더 주석은 결함 진원지 추적 위해 보존).
    expect(src).not.toMatch(/import\s*\{[^}]*aggregateAllPositions[^}]*\}/);
    expect(src).not.toMatch(/\baggregateAllPositions\s*\(/);
  });

  it('shadowPositionLedger SSOT 위임 의무', () => {
    expect(src).toContain('getOpenPositions');
    expect(src).toContain('shadowPositionLedger');
  });

  it('KIS 주문 함수 5종 import 0건', () => {
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(src).not.toMatch(/from.*autoTradeEngine|from.*orderExecutor|from.*trancheExecutor/);
  });

  it('호출자 측 inline ENV 검사 0건 (SSOT 위임)', () => {
    // process.env.TELEGRAM_* 직접 비교 패턴이 헬퍼 호출 외에 부재. AUTO_TRADE_MODE 와
    // MORNING_CARD_SHADOW_HEADER_DISABLED 는 ADR-0191 SHADOW 헤더 정합으로 보존.
    const telegramEnvDirect = src.match(/process\.env\.TELEGRAM_POSITION_CARD/g);
    const telegramEnvHelpers = src.match(/isPositionCardEnabled|isShadowPositionCardEnabled|isMorningPositionCardEnabled|isSendEmptyPositionCardEnabled|isPositionCardSourceValidationEnabled/g);
    expect(telegramEnvDirect).toBeNull();
    expect(telegramEnvHelpers).not.toBeNull();
  });
});
