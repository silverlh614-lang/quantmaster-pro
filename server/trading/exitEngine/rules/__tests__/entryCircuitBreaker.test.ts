/**
 * @responsibility entryCircuitBreaker (ADR-0072) 매수 직후 1h 이내 -5% 50% 청산 단위 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    syncPositionCache: vi.fn(),
    appendFill: vi.fn((s: any, f: any) => { s.fills = [...(s.fills ?? []), { ...f, id: 'mid' }]; }),
    updateShadow: vi.fn((s: any, p: any) => { Object.assign(s, p); }),
    getRemainingQty: vi.fn((s: any) => s.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));

const {
  entryCircuitBreaker,
  computeHoldingMinutes,
  ENTRY_CIRCUIT_HOLDING_MINUTES_MAX,
  ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD,
  ENTRY_CIRCUIT_SELL_RATIO,
} = await import('../entryCircuitBreaker.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { addSellOrder } = await import('../../../fillMonitor.js');

/** 진입 시각을 N분 전으로 만드는 헬퍼 */
function signalTimeNMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('entryCircuitBreaker (ADR-0072)', () => {
  const originalEnv = process.env.ENTRY_CIRCUIT_BREAKER_DISABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENTRY_CIRCUIT_BREAKER_DISABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ENTRY_CIRCUIT_BREAKER_DISABLED;
    else process.env.ENTRY_CIRCUIT_BREAKER_DISABLED = originalEnv;
  });

  // ── 상수 SSOT ──────────────────────────────────────────────────────────
  it('상수 SSOT: 60분 / -5% / 0.5', () => {
    expect(ENTRY_CIRCUIT_HOLDING_MINUTES_MAX).toBe(60);
    expect(ENTRY_CIRCUIT_RETURN_PCT_THRESHOLD).toBe(-5);
    expect(ENTRY_CIRCUIT_SELL_RATIO).toBe(0.5);
  });

  // ── computeHoldingMinutes ──────────────────────────────────────────────
  describe('computeHoldingMinutes', () => {
    it('현재 시각 기준 30분 전 진입 → ~30분', () => {
      const minutes = computeHoldingMinutes(signalTimeNMinutesAgo(30));
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThan(31);
    });

    it('잘못된 ISO → Infinity (트리거 미발동)', () => {
      expect(computeHoldingMinutes('not-an-iso')).toBe(Infinity);
    });

    it('미래 시각 → Infinity (음수 차이 안전 fallback)', () => {
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      expect(computeHoldingMinutes(future)).toBe(Infinity);
    });

    it('빈 문자열 → Infinity', () => {
      expect(computeHoldingMinutes('')).toBe(Infinity);
    });
  });

  // ── 트리거 조건 분기 ────────────────────────────────────────────────────
  it('진입 30분 + -6% → 50% 청산 + skipRest=true', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(r.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'STOP_LOSS');
    expect(shadow.entryCircuitTriggered).toBe(true);
    expect(shadow.addBuyBlocked).toBe(true);
    expect(shadow.exitRuleTag).toBe('ENTRY_CIRCUIT_BREAKER');
  });

  it('진입 60분 정확히 + -5% 정확히 → 발동 (boundary 통과)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(59), // 59 < 60 boundary 안전
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 95, returnPct: -5,
    }));
    expect(r.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledOnce();
  });

  it('진입 90분 + -8% → NO_OP (시간 초과)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(90),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 92, returnPct: -8,
    }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('진입 30분 + -4% → NO_OP (손실률 미달)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 96, returnPct: -4,
    }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('진입 30분 + +5% → NO_OP (수익 영역)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 105, returnPct: 5,
    }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  // ── 1회성 가드 ─────────────────────────────────────────────────────────
  it('이미 entryCircuitTriggered=true → NO_OP (재발동 차단)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
      entryCircuitTriggered: true,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 90, returnPct: -10,
    }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  // ── ENV 롤백 스위치 ─────────────────────────────────────────────────────
  it('ENTRY_CIRCUIT_BREAKER_DISABLED=true → NO_OP (즉시 무력화)', async () => {
    process.env.ENTRY_CIRCUIT_BREAKER_DISABLED = 'true';
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 92, returnPct: -8,
    }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('ENTRY_CIRCUIT_BREAKER_DISABLED=false → 정상 발동 (env 명시 false)', async () => {
    process.env.ENTRY_CIRCUIT_BREAKER_DISABLED = 'false';
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    const r = await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(r.skipRest).toBe(true);
  });

  // ── 50% 청산 수량 계산 ──────────────────────────────────────────────────
  it('수량 100 → 50주 청산 (정확히 50%)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'STOP_LOSS');
  });

  it('수량 1주 → 1주 청산 (Math.max 안전 fallback)', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 1,
    });
    await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 1, 'STOP_LOSS');
  });

  it('수량 7주 (홀수) → Math.floor(7×0.5)=3주', async () => {
    const shadow = makeMockShadow({
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 7,
    });
    await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 3, 'STOP_LOSS');
  });

  // ── 텔레그램 알림 ───────────────────────────────────────────────────────
  it('CRITICAL 텔레그램 + dedupeKey 부착', async () => {
    const shadow = makeMockShadow({
      stockCode: '004020', stockName: '현대제철',
      signalTime: signalTimeNMinutesAgo(20),
      quantity: 100,
    });
    await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
    const [message, options] = (sendTelegramAlert as any).mock.calls[0];
    expect(message).toContain('현대제철 (004020)');
    expect(message).toContain('Entry Circuit Breaker');
    expect(options.dedupeKey).toBe('entry_circuit_breaker:004020');
    expect(['HIGH', 'CRITICAL']).toContain(options.priority);
  });

  // ── FAILED 분기 — 플래그 롤백 ───────────────────────────────────────────
  it('LIVE FAILED 시 entryCircuitTriggered/addBuyBlocked 롤백 + CRITICAL', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({
      mode: 'LIVE',
      signalTime: signalTimeNMinutesAgo(30),
      quantity: 100,
    });
    await entryCircuitBreaker(makeMockCtx({
      shadow, currentPrice: 94, returnPct: -6,
    }));
    // 플래그가 *이전 상태로 복원* — 다음 기회 재시도 가능.
    expect(shadow.entryCircuitTriggered).toBeFalsy();
    expect(shadow.addBuyBlocked).toBeFalsy();
    // 텔레그램 CRITICAL 알림은 발송됨.
    const [, options] = (sendTelegramAlert as any).mock.calls[0];
    expect(options.priority).toBe('CRITICAL');
  });
});
