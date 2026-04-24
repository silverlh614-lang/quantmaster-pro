/**
 * exitEngineMutex.test.ts — PR-6 #12 동시 실행 가드.
 *
 * updateShadowResults 가 이미 실행 중일 때 두 번째 호출은 즉시 skip 되어야 한다.
 * 목표: orchestratorJobs 매 1분 cron 과 shadowResolverJob 매 5분 cron 이 5분마다
 * 겹칠 때 L3 분할 익절·원금보호 메시지가 두 번 송출되던 문제 방지.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// exitEngine 내부 의존성을 mock — 실제 KIS/텔레그램 경로는 타지 않음.
vi.mock('../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
  placeKisStopLossLimitOrder: vi.fn(() => Promise.resolve(null)),
  placeKisTakeProfitLimitOrder: vi.fn(() => Promise.resolve(null)),
  fetchCurrentPrice: vi.fn(() => Promise.resolve(100)),
}));
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../alerts/channelPipeline.js', () => ({
  channelSellSignal: vi.fn(() => Promise.resolve()),
  channelBuySignalEmitted: vi.fn(() => Promise.resolve()),
}));
vi.mock('./fillMonitor.js', () => ({
  fillMonitor: { getSnapshot: () => ({ active: [] }), addOrder: vi.fn() },
  addSellOrder: vi.fn(),
}));

describe('updateShadowResults 동시 실행 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('두 번째 동시 호출은 즉시 skip (concurrent tick 가드)', async () => {
    const { updateShadowResults } = await import('./exitEngine.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 빈 shadows 배열이어도 가드는 동일하게 작동 — 단순 동시성 테스트.
    const p1 = updateShadowResults([], 'R2_BULL' as any);
    const p2 = updateShadowResults([], 'R2_BULL' as any);

    await Promise.all([p1, p2]);

    // 두 번째 호출 skip 경보가 정확히 1회 출력돼야 함.
    const skipCalls = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && msg.includes('중복 진입 skip'),
    );
    expect(skipCalls.length).toBe(1);
    warnSpy.mockRestore();
  });

  it('순차 호출은 정상 실행 (가드 해제 후 재진입)', async () => {
    const { updateShadowResults } = await import('./exitEngine.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await updateShadowResults([], 'R2_BULL' as any);
    await updateShadowResults([], 'R2_BULL' as any);

    // 직렬 실행은 skip 경보가 나오면 안 된다.
    const skipCalls = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && msg.includes('중복 진입 skip'),
    );
    expect(skipCalls.length).toBe(0);
    warnSpy.mockRestore();
  });
});
