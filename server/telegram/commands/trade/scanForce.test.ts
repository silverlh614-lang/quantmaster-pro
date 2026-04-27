/**
 * @responsibility scanForce.cmd 회귀 — 비상정지 차단 / 장외 강제 wrapping / 예외 catch
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../state.js', () => ({
  getEmergencyStop: vi.fn(),
}));

vi.mock('../../../trading/signalScanner.js', () => ({
  runAutoSignalScan: vi.fn(),
}));

vi.mock('../../../utils/marketClock.js', () => ({
  isMarketOpen: vi.fn(),
}));

import { getEmergencyStop } from '../../../state.js';
import { runAutoSignalScan } from '../../../trading/signalScanner.js';
import { isMarketOpen } from '../../../utils/marketClock.js';
import { commandRegistry } from '../../commandRegistry.js';
import './scanForce.cmd.js';

const FORCE_KEY = 'DATA_FETCH_FORCE_MARKET';

beforeEach(() => {
  vi.mocked(getEmergencyStop).mockReturnValue(false);
  vi.mocked(isMarketOpen).mockReturnValue(false);
  vi.mocked(runAutoSignalScan).mockResolvedValue({});
  delete process.env[FORCE_KEY];
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env[FORCE_KEY];
});

describe('/scan_offhours 등록', () => {
  it('commandRegistry 에 /scan_offhours 등록 + alias /scan_force', () => {
    expect(commandRegistry.resolve('/scan_offhours')).toBeDefined();
    expect(commandRegistry.resolve('/scan_force')).toBeDefined();
  });

  it('/scan_offhours 와 /scan_force 동일 인스턴스', () => {
    expect(commandRegistry.resolve('/scan_offhours')).toBe(commandRegistry.resolve('/scan_force'));
  });

  it('category=TRD + riskLevel=2', () => {
    const cmd = commandRegistry.resolve('/scan_offhours');
    expect(cmd?.category).toBe('TRD');
    expect(cmd?.riskLevel).toBe(2);
  });
});

describe('/scan_offhours 동작', () => {
  it('비상정지 활성 시 차단 + runAutoSignalScan 미호출', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/scan_offhours');
    await cmd!.execute({ args: [], reply });

    expect(replies[0]).toContain('비상 정지');
    expect(runAutoSignalScan).not.toHaveBeenCalled();
  });

  it('장외 시각 → "장외" 태그 + 회로 부담 경고 표시', async () => {
    vi.mocked(isMarketOpen).mockReturnValue(false);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/scan_offhours');
    await cmd!.execute({ args: [], reply });

    expect(replies[0]).toContain('장외');
    expect(replies[0]).toContain('회로차단기');
    expect(runAutoSignalScan).toHaveBeenCalledOnce();
    expect(replies[1]).toContain('장외');
  });

  it('장중 시각 → "장중" 태그 + /scan 동일 안내', async () => {
    vi.mocked(isMarketOpen).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/scan_offhours');
    await cmd!.execute({ args: [], reply });

    expect(replies[0]).toContain('장중');
    expect(replies[0]).toContain('/scan 과 동일');
    expect(runAutoSignalScan).toHaveBeenCalledOnce();
  });

  it('runAutoSignalScan 실행 중 FORCE_MARKET=true 활성 + 종료 후 복구', async () => {
    let envInsideScan: string | undefined;
    vi.mocked(runAutoSignalScan).mockImplementation(async () => {
      envInsideScan = process.env[FORCE_KEY];
      return {};
    });

    const cmd = commandRegistry.resolve('/scan_offhours');
    await cmd!.execute({ args: [], reply: async () => {} });

    expect(envInsideScan).toBe('true');
    expect(process.env[FORCE_KEY]).toBeUndefined(); // 복구
  });

  it('runAutoSignalScan throw → ❌ 메시지 + env 복구', async () => {
    vi.mocked(runAutoSignalScan).mockRejectedValue(new Error('scan boom'));
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/scan_offhours');
    await cmd!.execute({ args: [], reply });

    expect(replies.some((r) => r.includes('❌'))).toBe(true);
    expect(replies.some((r) => r.includes('scan boom'))).toBe(true);
    expect(process.env[FORCE_KEY]).toBeUndefined();
  });
});
