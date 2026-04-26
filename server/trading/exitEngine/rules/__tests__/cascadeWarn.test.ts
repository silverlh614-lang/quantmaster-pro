/**
 * @responsibility cascadeWarn -7% 추가매수 차단 규칙 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return { ...actual, appendShadowLog: vi.fn() };
});

const { cascadeWarn } = await import('../cascadeWarn.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { appendShadowLog } = await import('../../../../persistence/shadowTradeRepo.js');

describe('cascadeWarn (-7% 추가매수 차단)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returnPct > -7 면 NO_OP (트리거 안 됨)', async () => {
    const shadow = makeMockShadow();
    const r = await cascadeWarn(makeMockCtx({ shadow, currentPrice: 95 })); // -5%
    expect(r.skipRest).toBe(false);
    expect(shadow.cascadeStep).toBeUndefined();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('returnPct=-7 boundary 미진입 (≤ -7 조건이라 -7 진입)', async () => {
    const shadow = makeMockShadow();
    const r = await cascadeWarn(makeMockCtx({ shadow, currentPrice: 93 })); // 정확히 -7%
    expect(r.skipRest).toBe(true);
    expect(shadow.cascadeStep).toBe(1);
    expect(shadow.addBuyBlocked).toBe(true);
    expect(shadow.exitRuleTag).toBe('CASCADE_WARN_BLOCK');
  });

  it('returnPct ≤ -7 + cascadeStep < 1 → 트리거 + 텔레그램 알림', async () => {
    const shadow = makeMockShadow();
    const r = await cascadeWarn(makeMockCtx({ shadow, currentPrice: 90 })); // -10%
    expect(r.skipRest).toBe(true);
    expect(shadow.cascadeStep).toBe(1);
    expect(shadow.addBuyBlocked).toBe(true);
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
    expect(appendShadowLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'CASCADE_WARN' }));
  });

  it('cascadeStep ≥ 1 (이미 발동) 시 재트리거 차단', async () => {
    const shadow = makeMockShadow({ cascadeStep: 1 });
    const r = await cascadeWarn(makeMockCtx({ shadow, currentPrice: 90 }));
    expect(r.skipRest).toBe(false);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
});
