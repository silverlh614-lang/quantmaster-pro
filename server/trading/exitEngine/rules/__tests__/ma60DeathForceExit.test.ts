/**
 * @responsibility ma60DeathForceExit 5영업일 만료 + 역배열 유지 시 전량 강제청산 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../../helpers/ma60.js', () => ({
  fetchMaFromCloses: vi.fn(),
  isMA60Death: vi.fn(),
  kstBusinessDateStr: vi.fn(),
}));

const { ma60DeathForceExit } = await import('../ma60DeathForceExit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { fetchMaFromCloses, isMA60Death, kstBusinessDateStr } = await import('../../helpers/ma60.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');

describe('ma60DeathForceExit (5영업일 만료 강제청산)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('이미 ma60DeathForced=true → NO_OP', async () => {
    const shadow = makeMockShadow({ ma60DeathForced: true, ma60ForceExitDate: '2026-04-25' });
    const r = await ma60DeathForceExit(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('ma60ForceExitDate 미설정 → NO_OP', async () => {
    const shadow = makeMockShadow({ ma60ForceExitDate: undefined });
    const r = await ma60DeathForceExit(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
  });

  it('만료일 도달 전 (today < forceDate) → NO_OP', async () => {
    (kstBusinessDateStr as any).mockReturnValue('2026-04-26');
    const shadow = makeMockShadow({ ma60ForceExitDate: '2026-05-01' });
    await ma60DeathForceExit(makeMockCtx({ shadow }));
    expect(fetchMaFromCloses).not.toHaveBeenCalled();
  });

  it('만료 + 역배열 회복됨 → 스케줄 초기화 (강제청산 안 함)', async () => {
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
    (fetchMaFromCloses as any).mockResolvedValue({ ma20: 100, ma60: 95 });
    (isMA60Death as any).mockReturnValue(false);
    const shadow = makeMockShadow({ ma60ForceExitDate: '2026-05-01', ma60DeathDetectedAt: '2026-04-26' });
    const r = await ma60DeathForceExit(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    expect(shadow.ma60DeathDetectedAt).toBeUndefined();
    expect(shadow.ma60ForceExitDate).toBeUndefined();
  });

  it('만료 + 역배열 유지 → 전량 강제청산 + ma60DeathForced=true', async () => {
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
    (fetchMaFromCloses as any).mockResolvedValue({ ma20: 95, ma60: 100 });
    (isMA60Death as any).mockReturnValue(true);
    const shadow = makeMockShadow({ quantity: 100, ma60ForceExitDate: '2026-05-01' });
    const r = await ma60DeathForceExit(makeMockCtx({ shadow, currentPrice: 90 }));
    expect(r.skipRest).toBe(true);
    expect(shadow.status).toBe('HIT_STOP');
    expect(shadow.ma60DeathForced).toBe(true);
    expect(shadow.exitRuleTag).toBe('MA60_DEATH_FORCE_EXIT');
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 100, 'STOP_LOSS');
  });

  it('FAILED outcome → CRITICAL 알림 발송', async () => {
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
    (fetchMaFromCloses as any).mockResolvedValue({ ma20: 95, ma60: 100 });
    (isMA60Death as any).mockReturnValue(true);
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100, ma60ForceExitDate: '2026-05-01' });
    await ma60DeathForceExit(makeMockCtx({ shadow, currentPrice: 90 }));
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });
});
