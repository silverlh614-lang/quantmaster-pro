// @responsibility 수동 스캔 명령이 모든 모드에서 현재 dispatcher를 호출하고 재호출 제한·비상정지·오류 처리를 유지하는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scan: vi.fn(async () => ({})), emergency: vi.fn(() => false), mode: vi.fn(() => 'LIVE'),
  regime: vi.fn(() => { throw new Error('REGIME_RETIRED'); }),
  legacyDiscovery: vi.fn(() => { throw new Error('REGIME_RETIRED'); }),
}));
vi.mock('../../../state.js', () => ({ getEmergencyStop: mocks.emergency, getTradingMode: mocks.mode }));
vi.mock('../../../trading/scanDispatcher.js', () => ({ runAutoSignalScan: mocks.scan }));
vi.mock('../../../trading/regime/canonicalRegimeAccess.js', () => ({ resolveCanonicalRegimeLevel: mocks.regime }));
vi.mock('../../../screener/guardedDiscoveryPipeline.js', () => ({ runGuardedFullDiscoveryPipeline: mocks.legacyDiscovery }));
vi.mock('../../metaCommands.js', () => ({ composeNowVerdict: () => '현재 관측·매매 현황' }));
vi.mock('../../commandRegistry.js', () => ({ commandRegistry: { register: vi.fn() } }));
import forceWatchScan, { __resetForceWatchScanRateLimitForTests } from './forceWatchScan.cmd.js';
import krxScan from './krxScan.cmd.js';

const originalAutoTrade = process.env.AUTO_TRADE_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scan.mockResolvedValue({});
  mocks.emergency.mockReturnValue(false);
  mocks.mode.mockReturnValue('LIVE');
  __resetForceWatchScanRateLimitForTests();
});
afterEach(() => {
  if (originalAutoTrade === undefined) delete process.env.AUTO_TRADE_ENABLED;
  else process.env.AUTO_TRADE_ENABLED = originalAutoTrade;
});

for (const command of [forceWatchScan, krxScan]) {
  describe(command.name, () => {
    it.each(['LIVE', 'PAPER', 'SHADOW'])('%s에서도 구 레짐 발굴 없이 현재 시그널을 실행한다', async (mode) => {
      mocks.mode.mockReturnValue(mode);
      delete process.env.AUTO_TRADE_ENABLED;
      const reply = vi.fn(async (_message: string) => undefined);
      await command.execute({ args: [], reply });
      expect(mocks.scan).toHaveBeenCalledOnce();
      expect(mocks.regime).not.toHaveBeenCalled();
      expect(mocks.legacyDiscovery).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledWith('현재 관측·매매 현황');
    });
    it('비상정지 상태에서는 수동 스캔을 실행하지 않는다', async () => {
      mocks.emergency.mockReturnValue(true);
      const reply = vi.fn(async (_message: string) => undefined);
      await command.execute({ args: [], reply });
      expect(mocks.scan).not.toHaveBeenCalled();
      expect(reply.mock.calls[0]![0]).toMatch(/비상\s?정지/);
    });
    it('스캔 오류를 HTML 이스케이프하여 응답한다', async () => {
      mocks.scan.mockRejectedValueOnce(new Error('<가격 조회 실패>'));
      const reply = vi.fn(async (_message: string) => undefined);
      await command.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledOnce();
      expect(reply.mock.calls[0]![0]).toContain('스캔 실패');
      expect(reply.mock.calls[0]![0]).toContain('&lt;가격 조회 실패&gt;');
    });
  });
}

describe('/force_watch_scan 호환성과 호출 제한', () => {
  it.each(['full', 'FULL'])('과거 %s 인자도 현재 시그널 경로로 연결한다', async (arg) => {
    const reply = vi.fn(async (_message: string) => undefined);
    await forceWatchScan.execute({ args: [arg], reply });
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(mocks.legacyDiscovery).not.toHaveBeenCalled();
  });
  it('60초 이내 재호출을 차단하고 대기 시간을 안내한다', async () => {
    const reply = vi.fn(async (_message: string) => undefined);
    await forceWatchScan.execute({ args: [], reply });
    await forceWatchScan.execute({ args: [], reply });
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(reply.mock.calls[1]![0]).toMatch(/60초 이내.*\d+초 후/);
  });
  it('실패한 호출도 제한하여 반복 실행을 막는다', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('실패'));
    const reply = vi.fn(async (_message: string) => undefined);
    await forceWatchScan.execute({ args: [], reply });
    await forceWatchScan.execute({ args: [], reply });
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(reply.mock.calls[1]![0]).toContain('60초 이내');
  });
  it('명령 이름·별칭과 관리자 권한을 유지한다', () => {
    expect(forceWatchScan.name).toBe('/force_watch_scan');
    expect(forceWatchScan.aliases).toContain('/force_scan');
    expect(forceWatchScan).toMatchObject({ category: 'TRD', riskLevel: 1, visibility: 'ADMIN' });
    expect(forceWatchScan.usage).toContain('/force_watch_scan');
    expect(krxScan).toMatchObject({ category: 'TRD', riskLevel: 2, visibility: 'ADMIN' });
  });
});
