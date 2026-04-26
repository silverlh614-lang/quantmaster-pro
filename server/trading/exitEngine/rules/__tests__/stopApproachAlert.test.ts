/**
 * @responsibility stopApproachAlert 손절 접근 3단계 경보 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

const { stopApproachAlert } = await import('../stopApproachAlert.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');

describe('stopApproachAlert (3-stage dedupe)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('손절가 위 5% 초과 거리 → 어떤 stage 도 발동 안 함', async () => {
    const shadow = makeMockShadow({ stopLoss: 90, hardStopLoss: 90 });
    // currentPrice 100 → stopLoss 90 → distToStop ≈ 11.1% (5% 초과)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 100, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBeUndefined();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('Stage 1 (-5% 이내) 진입 → stage=1 + 1 telegram 호출', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 94, hardStopLoss 90 → distToStop ≈ 4.4% < 5
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 94, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(1);
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
  });

  it('Stage 2 (-3% 이내) 진입 → stage=2 + 2 telegram (1 + 2)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 92, hardStopLoss 90 → distToStop ≈ 2.2% < 3 (and < 5)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 92, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(2);
    // Stage 1 발동 (4.4% < 5) + Stage 2 발동 (2.2% < 3) = 2 호출
    expect(sendTelegramAlert).toHaveBeenCalledTimes(2);
  });

  it('Stage 3 (-1% 이내) 진입 → stage=3 + 3 telegram (모두 신규)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    // currentPrice 90.5, hardStopLoss 90 → distToStop ≈ 0.55% < 1 (and < 3, < 5)
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 90.5, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(3);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(3);
  });

  it('이미 stage=2 인 상태에서 Stage 1/2 재발동 차단, Stage 3 만 신규 송출', async () => {
    const shadow = makeMockShadow({ stopLoss: 90, stopApproachStage: 2 });
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 90.5, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBe(3);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1); // Stage 3 만
  });

  it('손절가 아래 (distToStop ≤ 0) → 모든 stage 차단 (하드스톱 영역)', async () => {
    const shadow = makeMockShadow({ stopLoss: 90 });
    await stopApproachAlert(makeMockCtx({ shadow, currentPrice: 89, hardStopLoss: 90 }));
    expect(shadow.stopApproachStage).toBeUndefined();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
});
