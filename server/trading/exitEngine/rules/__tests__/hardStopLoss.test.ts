/**
 * @responsibility hardStopLoss 고정/레짐/Profit Protection 손절 전량청산 단위 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../alerts/channelPipeline.js', () => ({ channelSellSignal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../alerts/stopLossTransparencyReport.js', () => ({ sendStopLossTransparencyReport: vi.fn(() => Promise.resolve()) }));
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
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));
vi.mock('../../../preMortemStructured.js', () => ({
  matchExitInvalidation: vi.fn(() => null),
  promoteInvalidationPatternIfRepeated: vi.fn(),
}));
vi.mock('../../../../learning/kellyDriftFailurePromotion.js', () => ({ promoteKellyDriftPattern: vi.fn() }));

const { hardStopLoss } = await import('../hardStopLoss.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { sendStopLossTransparencyReport } = await import('../../../../alerts/stopLossTransparencyReport.js');

describe('hardStopLoss (고정/레짐/Profit Protection)', () => {
  // ADR-0085 PR-B1-1 — Two-Bar Confirmation Gate 가 PROFIT_PROTECTION 1차 터치 시 WAIT
  // 분기로 빠지므로, 본 테스트 suite 의 *분류 로직 검증* 영향을 격리한다. 게이트 자체
  // 회귀는 helpers/twoBarBepGate.test.ts + rules/__tests__/hardStopLossBepWiring.test.ts.
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BEP_PROTECTION_DISABLED = 'true';
  });
  afterEach(() => {
    delete process.env.BEP_PROTECTION_DISABLED;
  });

  it('currentPrice > hardStopLoss → NO_OP', async () => {
    const shadow = makeMockShadow();
    const r = await hardStopLoss(makeMockCtx({ shadow, currentPrice: 95, hardStopLoss: 90 }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('currentPrice ≤ hardStopLoss → 전량 청산 + skipRest=true', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    const r = await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 89, hardStopLoss: 90,
      initialStopLoss: 90, regimeStopLoss: 90,
    }));
    expect(r.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 100, 'STOP_LOSS');
    expect(shadow.status).toBe('HIT_STOP');
    expect(shadow.exitRuleTag).toBe('HARD_STOP');
    expect(shadow.stopLossExitType).toBe('INITIAL_AND_REGIME'); // gap < 0.5
    expect(sendStopLossTransparencyReport).toHaveBeenCalledOnce();
  });

  it('hardStop > both initial and regime → PROFIT_PROTECTION 분류', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 99, hardStopLoss: 100,
      initialStopLoss: 90, regimeStopLoss: 92,
    }));
    expect(shadow.stopLossExitType).toBe('PROFIT_PROTECTION');
  });

  it('initial > regime + gap ≥ 0.5 → INITIAL 분류', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 89, hardStopLoss: 90,
      initialStopLoss: 92, regimeStopLoss: 90,
    }));
    expect(shadow.stopLossExitType).toBe('INITIAL');
  });

  it('regime > initial + gap ≥ 0.5 → REGIME 분류', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 89, hardStopLoss: 90,
      initialStopLoss: 90, regimeStopLoss: 92,
    }));
    expect(shadow.stopLossExitType).toBe('REGIME');
  });

  it('FAILED outcome → CRITICAL 알림 발송', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100 });
    await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 89, hardStopLoss: 90,
      initialStopLoss: 90, regimeStopLoss: 90,
    }));
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });
});
