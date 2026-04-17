import { describe, it, expect, vi, beforeEach } from 'vitest';

// fs 모킹 — 파일 I/O 없이 순수 로직 테스트
vi.mock('fs', () => ({ default: { readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(() => false), appendFileSync: vi.fn() } }));
vi.mock('../persistence/paths.js', () => ({
  SHADOW_FILE: '/mock/shadow-trades.json',
  SHADOW_LOG_FILE: '/mock/shadow-log.json',
  ensureDataDir: vi.fn(),
  tradeEventsFile: vi.fn(() => '/mock/events.jsonl'),
}));

import { updateShadow } from '../persistence/shadowTradeRepo.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// ─── 테스트용 최소 ShadowTrade 팩토리 ─────────────────────────────────────────
function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'test-001',
    stockCode: '005930',
    stockName: '삼성전자',
    shadowEntryPrice: 70_000,
    entryPrice: 70_000,
    targetPrice: 80_000,
    stopLoss: 63_000,
    quantity: 100,
    originalQuantity: 100,
    status: 'ACTIVE',
    signalTime: '2026-04-17T09:00:00.000Z',
    fills: [],
    ...overrides,
  } as ServerShadowTrade;
}

describe('TradeInvariants — updateShadow()', () => {

  it('정상 패치: status·exitPrice·quantity 업데이트', () => {
    const t = makeTrade();
    updateShadow(t, { status: 'HIT_STOP', exitPrice: 63_000, quantity: 0 });
    expect(t.status).toBe('HIT_STOP');
    expect(t.exitPrice).toBe(63_000);
    expect(t.quantity).toBe(0);
  });

  it('규칙 1: returnPct가 패치에 포함되어도 trade에 반영되지 않는다', () => {
    const t = makeTrade();
    const before = t.returnPct;
    updateShadow(t, { status: 'HIT_STOP', returnPct: -5.3 } as any);
    expect(t.returnPct).toBe(before); // 변경 없음
    expect(t.status).toBe('HIT_STOP'); // 나머지는 적용됨
  });

  it('규칙 2: originalQuantity가 이미 양수면 변경이 차단된다', () => {
    const t = makeTrade({ originalQuantity: 100 });
    updateShadow(t, { originalQuantity: 999 } as any);
    expect(t.originalQuantity).toBe(100); // 차단
  });

  it('규칙 2: originalQuantity가 미설정(0/undefined)이면 설정 가능하다', () => {
    const t = makeTrade({ originalQuantity: undefined });
    updateShadow(t, { originalQuantity: 50 } as any);
    expect(t.originalQuantity).toBe(50);
  });

  it('규칙 1+2 동시: returnPct 제거 + originalQuantity 차단 후 나머지 적용', () => {
    const t = makeTrade({ originalQuantity: 100 });
    updateShadow(t, { status: 'HIT_TARGET', exitPrice: 80_000, returnPct: 14.3, originalQuantity: 999 } as any);
    expect(t.status).toBe('HIT_TARGET');
    expect(t.exitPrice).toBe(80_000);
    expect(t.returnPct).toBeUndefined();
    expect(t.originalQuantity).toBe(100); // 차단됨
  });

  it('quantity를 0으로 줄이는 것은 허용된다', () => {
    const t = makeTrade({ quantity: 100 });
    updateShadow(t, { quantity: 0 });
    expect(t.quantity).toBe(0);
  });
});
