/**
 * ADR-0607 — channelBuySignalEmitted 의 LIVE 모드 SHADOW → CH4(JOURNAL) 격리 검증.
 *
 * channelBuySignalEmitted 는 SHADOW/LIVE 매수 신호의 *실제* CH2(SIGNAL) 발송 chokepoint
 * (mode-aware, approvalQueue.ts:130 가 mode 주입). 본 테스트는 dispatchAlert 의 category
 * 인자가 ENV/모드/mode 조합에 따라 SIGNAL↔JOURNAL 로 정확히 분기하는지 검증.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelSemantic } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn<(category: unknown, ...rest: unknown[]) => Promise<number>>(async () => 1),
  sendPrivateAlert: vi.fn(async () => 11),
  getExecutionMode: vi.fn<() => 'OFF' | 'PAPER' | 'LIVE'>(() => 'OFF'),
}));

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: mocks.dispatchAlert,
}));
vi.mock('./telegramClient.js', async () => {
  const actual = await vi.importActual<typeof import('./telegramClient.js')>('./telegramClient.js');
  return { ...actual, sendPrivateAlert: mocks.sendPrivateAlert };
});
vi.mock('../state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state.js')>();
  return { ...actual, getExecutionMode: mocks.getExecutionMode };
});

const { channelBuySignalEmitted } = await import('./channelPipeline.js');

const ORIGINAL_FLAG = process.env.LIVE_SHADOW_QUIET_ENABLED;

const SHADOW_PARAMS = {
  mode: 'SHADOW' as const,
  stockName: 'TEST', stockCode: '000001', price: 10000, quantity: 1,
  gateScore: 80, mtas: 8, cs: 0.5, stopLoss: 9000, targetPrice: 12000, rrr: 2,
  signalType: 'BUY' as const,
};
const LIVE_PARAMS = { ...SHADOW_PARAMS, mode: 'LIVE' as const };

/** dispatchAlert 의 첫 호출 category(채널) 인자 추출. */
function firstDispatchRoute(): unknown {
  return mocks.dispatchAlert.mock.calls[0]?.[0];
}

beforeEach(() => {
  mocks.dispatchAlert.mockClear();
  mocks.sendPrivateAlert.mockClear();
  mocks.getExecutionMode.mockReset();
  mocks.getExecutionMode.mockReturnValue('OFF');
  delete process.env.LIVE_SHADOW_QUIET_ENABLED;
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.LIVE_SHADOW_QUIET_ENABLED;
  else process.env.LIVE_SHADOW_QUIET_ENABLED = ORIGINAL_FLAG;
});

describe('channelBuySignalEmitted — ADR-0607 SHADOW 격리', () => {
  // (1) OFF byte-equivalent
  it('OFF + LIVE 모드 + SHADOW 신호 → SIGNAL(CH2) 유지', async () => {
    delete process.env.LIVE_SHADOW_QUIET_ENABLED;
    mocks.getExecutionMode.mockReturnValue('LIVE');
    await channelBuySignalEmitted(SHADOW_PARAMS);
    expect(firstDispatchRoute()).toBe(ChannelSemantic.SIGNAL);
  });

  // (2) ON + LIVE + SHADOW → CH4
  it('ON + LIVE 모드 + SHADOW 신호 → JOURNAL(CH4) 격리', async () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    await channelBuySignalEmitted(SHADOW_PARAMS);
    expect(firstDispatchRoute()).toBe(ChannelSemantic.JOURNAL);
  });

  // (3) ON + 비LIVE → CH2 유지
  it('ON + PAPER 모드 + SHADOW 신호 → SIGNAL(CH2) 유지', async () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('PAPER');
    await channelBuySignalEmitted(SHADOW_PARAMS);
    expect(firstDispatchRoute()).toBe(ChannelSemantic.SIGNAL);
  });

  // (4 변형) ON + LIVE + LIVE 신호(비SHADOW) → CH2 유지 (LIVE 신호는 비우지 않음)
  it('ON + LIVE 모드 + LIVE 신호 → SIGNAL(CH2) 유지', async () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    await channelBuySignalEmitted(LIVE_PARAMS);
    expect(firstDispatchRoute()).toBe(ChannelSemantic.SIGNAL);
  });
});
