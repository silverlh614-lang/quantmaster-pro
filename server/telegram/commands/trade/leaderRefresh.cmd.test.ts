/**
 * @responsibility leaderRefresh.cmd 회귀 — 등록/메타 · 갱신건수 출력 · 장외 경고 · injection OFF 경고 · 예외 격리
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../state.js')>();
  return { ...actual, getEmergencyStop: vi.fn() };
});

vi.mock('../../../screener/dynamicUniverseExpander.js', () => ({
  runLeaderUniverseDailyRefresh: vi.fn(),
  isLeaderUniverseDailyRefreshEnabled: vi.fn(),
  loadDynamicUniverse: vi.fn(),
}));

vi.mock('../../../screener/leaderUniverseInjectionAdr0617.js', () => ({
  isLeaderUniverseInjectionEnabled: vi.fn(),
}));

import { getEmergencyStop } from '../../../state.js';
import {
  runLeaderUniverseDailyRefresh,
  isLeaderUniverseDailyRefreshEnabled,
  loadDynamicUniverse,
} from '../../../screener/dynamicUniverseExpander.js';
import { isLeaderUniverseInjectionEnabled } from '../../../screener/leaderUniverseInjectionAdr0617.js';
import { commandRegistry } from '../../commandRegistry.js';
import './leaderRefresh.cmd.js';

beforeEach(() => {
  vi.mocked(getEmergencyStop).mockReturnValue(false);
  vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(5);
  vi.mocked(isLeaderUniverseDailyRefreshEnabled).mockReturnValue(true);
  vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(true);
  vi.mocked(loadDynamicUniverse).mockReturnValue([{ ticker: 'A' }, { ticker: 'B' }] as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/leader_refresh 등록·메타', () => {
  it('commandRegistry 에 /leader_refresh 등록 + alias /lr', () => {
    expect(commandRegistry.resolve('/leader_refresh')).toBeDefined();
    expect(commandRegistry.resolve('/lr')).toBeDefined();
  });

  it('/leader_refresh 와 /lr 동일 인스턴스', () => {
    expect(commandRegistry.resolve('/leader_refresh')).toBe(commandRegistry.resolve('/lr'));
  });

  it('name·category·riskLevel·visibility 메타 검증', () => {
    const cmd = commandRegistry.resolve('/leader_refresh');
    expect(cmd?.name).toBe('/leader_refresh');
    expect(cmd?.category).toBe('TRD');
    expect(cmd?.riskLevel).toBe(2);
    expect(cmd?.visibility).toBe('ADMIN');
  });
});

describe('/leader_refresh 동작', () => {
  it('비상정지 활성 시 차단 + refresh 미호출', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[0]).toContain('비상 정지');
    expect(runLeaderUniverseDailyRefresh).not.toHaveBeenCalled();
  });

  it('반환 > 0 → 갱신 건수 출력', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(5);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(runLeaderUniverseDailyRefresh).toHaveBeenCalledOnce();
    expect(replies[1]).toContain('갱신 5건');
    expect(replies[1]).not.toContain('ADR-0009');
  });

  it('반환 0 → 장외 경고(ADR-0009) 출력', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(0);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('갱신 0건');
    expect(replies[1]).toContain('ADR-0009');
    expect(replies[1]).toContain('09:00~15:30');
  });

  it('injection flag OFF → 풀 반영 경고 포함', async () => {
    vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(false);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('LEADER_UNIVERSE_INJECTION_ENABLED');
    expect(replies[1]).toContain('INJECTION flag: OFF');
  });

  it('injection flag ON → 풀 반영 경고 미포함', async () => {
    vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).not.toContain('후보 풀 반영은 LEADER_UNIVERSE_INJECTION_ENABLED 의존');
  });

  it('runLeaderUniverseDailyRefresh throw → ❌ 안전 메시지 + 미전파', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockRejectedValue(new Error('refresh boom'));
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await expect(cmd!.execute({ args: [], reply })).resolves.toBeUndefined();

    expect(replies.some((r) => r.includes('❌'))).toBe(true);
    expect(replies.some((r) => r.includes('refresh boom'))).toBe(true);
  });
});
