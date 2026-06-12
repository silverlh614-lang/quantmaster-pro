/**
 * ADR-0607 — LIVE 모드 SHADOW → CH4(JOURNAL) 격리 라우팅 회귀 테스트.
 *
 * 검증:
 *  (1) OFF byte-equivalent — SHADOW 신호 CH2(SIGNAL) 유지
 *  (2) ON + LIVE + SHADOW → CH4(JOURNAL)
 *  (3) ON + 비LIVE(OFF/PAPER) → SHADOW CH2 유지
 *  (4) LIVE 체결(EXECUTION_EVENTS) 은 CH1(EXECUTION) 유지 (SHADOW 아님)
 *  (5) 순수 헬퍼 resolveShadowChannelRoute 진리표
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelSemantic } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  getExecutionMode: vi.fn<() => 'OFF' | 'PAPER' | 'LIVE'>(() => 'OFF'),
}));

vi.mock('../state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state.js')>();
  return { ...actual, getExecutionMode: mocks.getExecutionMode };
});

const { resolveShadowChannelRoute, isLiveShadowQuietEnabled } = await import('./shadowQuietRouting.js');
const { routeTelegramEvent } = await import('./telegramEventRouter.js');

const ORIGINAL_FLAG = process.env.LIVE_SHADOW_QUIET_ENABLED;

beforeEach(() => {
  mocks.getExecutionMode.mockReset();
  mocks.getExecutionMode.mockReturnValue('OFF');
  delete process.env.LIVE_SHADOW_QUIET_ENABLED;
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.LIVE_SHADOW_QUIET_ENABLED;
  else process.env.LIVE_SHADOW_QUIET_ENABLED = ORIGINAL_FLAG;
});

// ── (5) 순수 헬퍼 진리표 ──────────────────────────────────────────────────────
describe('resolveShadowChannelRoute — 순수 헬퍼 진리표 (ADR-0607)', () => {
  it('ENV OFF + LIVE + SHADOW → intendedRoute 유지 (byte-equivalent)', () => {
    delete process.env.LIVE_SHADOW_QUIET_ENABLED;
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, true)).toBe(ChannelSemantic.SIGNAL);
  });

  it('ENV ON + LIVE + SHADOW → JOURNAL 격리', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, true)).toBe(ChannelSemantic.JOURNAL);
  });

  it('ENV ON + LIVE + 비SHADOW → intendedRoute 유지 (LIVE 신호는 CH2)', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, false)).toBe(ChannelSemantic.SIGNAL);
  });

  it('ENV ON + PAPER + SHADOW → intendedRoute 유지 (비LIVE)', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('PAPER');
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, true)).toBe(ChannelSemantic.SIGNAL);
  });

  it('ENV ON + OFF + SHADOW → intendedRoute 유지 (비LIVE)', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('OFF');
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, true)).toBe(ChannelSemantic.SIGNAL);
  });

  it('intendedRoute 가 EXECUTION 이어도 비SHADOW 면 그대로 (격리는 isShadow 한정)', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(resolveShadowChannelRoute(ChannelSemantic.EXECUTION, false)).toBe(ChannelSemantic.EXECUTION);
  });

  it("정확 비교 — LIVE_SHADOW_QUIET_ENABLED='1' 은 OFF 로 취급", () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = '1';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(isLiveShadowQuietEnabled()).toBe(false);
    expect(resolveShadowChannelRoute(ChannelSemantic.SIGNAL, true)).toBe(ChannelSemantic.SIGNAL);
  });
});

// ── routeTelegramEvent 통합 ───────────────────────────────────────────────────
describe('routeTelegramEvent — SHADOW 신호 격리 (ADR-0607)', () => {
  // (1) OFF byte-equivalent
  it('OFF: SHADOW_BUY_SIGNAL → SIGNAL(CH2) 유지', () => {
    delete process.env.LIVE_SHADOW_QUIET_ENABLED;
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(routeTelegramEvent('SHADOW_BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
    expect(routeTelegramEvent('SHADOW_SELL_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  // (2) ON + LIVE + SHADOW → CH4
  it('ON + LIVE: SHADOW_BUY/SELL_SIGNAL → JOURNAL(CH4) 격리', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(routeTelegramEvent('SHADOW_BUY_SIGNAL')).toBe(ChannelSemantic.JOURNAL);
    expect(routeTelegramEvent('SHADOW_SELL_SIGNAL')).toBe(ChannelSemantic.JOURNAL);
  });

  // (3) ON + 비LIVE → CH2 유지
  it('ON + PAPER: SHADOW_BUY_SIGNAL → SIGNAL(CH2) 유지', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('PAPER');
    expect(routeTelegramEvent('SHADOW_BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  it('ON + OFF: SHADOW_BUY_SIGNAL → SIGNAL(CH2) 유지', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('OFF');
    expect(routeTelegramEvent('SHADOW_BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  // 비-SHADOW SIGNAL 이벤트는 LIVE+ON 에서도 CH2 유지 (격리 대상 아님)
  it('ON + LIVE: BUY_SIGNAL(비SHADOW) → SIGNAL(CH2) 유지', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(routeTelegramEvent('BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
    expect(routeTelegramEvent('STRONG_BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  // (4) LIVE 체결(EXECUTION) 은 CH1 유지 — SHADOW 아님, 격리 영향 0
  it('ON + LIVE: BUY_FILLED/SELL_FILLED/STOP_LOSS_HIT → EXECUTION(CH1) 유지', () => {
    process.env.LIVE_SHADOW_QUIET_ENABLED = 'true';
    mocks.getExecutionMode.mockReturnValue('LIVE');
    expect(routeTelegramEvent('BUY_FILLED')).toBe(ChannelSemantic.EXECUTION);
    expect(routeTelegramEvent('SELL_FILLED')).toBe(ChannelSemantic.EXECUTION);
    expect(routeTelegramEvent('STOP_LOSS_HIT')).toBe(ChannelSemantic.EXECUTION);
  });

  // getExecutionMode 미호출 보장 (OFF 단락) — 불필요한 상태 조회 회피 + byte-equivalent 보강
  it('OFF: getExecutionMode 미호출 (단락)', () => {
    delete process.env.LIVE_SHADOW_QUIET_ENABLED;
    routeTelegramEvent('SHADOW_BUY_SIGNAL');
    expect(mocks.getExecutionMode).not.toHaveBeenCalled();
  });
});
