/**
 * @responsibility forceWatchScan.cmd 회귀 테스트 (PR-EG3 ADR-0058 §Migration & Compat + Patch-VITEST-CAT-C-CARRY-OVER-002)
 *
 * 검증:
 *   - light 모드: autoPopulateWatchlist 만 호출, runGuardedFullDiscoveryPipeline 미호출
 *   - full 모드: runGuardedFullDiscoveryPipeline + autoPopulateWatchlist 순서 호출
 *   - rate-limit 60s 차단
 *   - AUTO_TRADE_ENABLED=false 차단
 *   - emergencyStop=true 차단
 *   - autoPopulateWatchlist throw 시 에러 메시지 응답 + rate-limit 갱신 유지
 *
 * Patch-VITEST-CAT-C-CARRY-OVER-002: forceWatchScan.cmd 가 dynamic import 로
 * guardedDiscoveryPipeline.runGuardedFullDiscoveryPipeline 을 호출하므로,
 * 테스트 mock 도 동일 모듈을 mock 해야 한다. universeScanner.runFullDiscoveryPipeline
 * 은 더 이상 직접 호출되지 않고 guardedDiscoveryPipeline 이 내부적으로 재호출함.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _runGuardedFullDiscoveryPipeline = vi.fn(
  async (_regime: string, _macro: unknown): Promise<{ ok: boolean; status: string; reason?: string }> => ({
    ok: true,
    status: 'OK',
  }),
);
const _autoPopulateWatchlist = vi.fn(async (): Promise<number> => 7);
const _loadWatchlist = vi.fn(() => [{ code: '005930' }, { code: '000660' }]);
const _loadMacroState = vi.fn(() => null);
// ADR-0531: forceWatchScan.cmd 가 정본 레짐 accessor 로 마이그레이션 — mock 경계도 동일하게 이동.
const _resolveCanonicalRegimeLevel = vi.fn(() => 'R4_NEUTRAL');
const _getEmergencyStop = vi.fn(() => false);

vi.mock('../../../screener/guardedDiscoveryPipeline.js', () => ({
  runGuardedFullDiscoveryPipeline: _runGuardedFullDiscoveryPipeline,
}));

vi.mock('../../../screener/stockScreener.js', () => ({
  autoPopulateWatchlist: _autoPopulateWatchlist,
}));

vi.mock('../../../persistence/watchlistRepo.js', () => ({
  loadWatchlist: _loadWatchlist,
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: _loadMacroState,
}));

vi.mock('../../../trading/regime/canonicalRegimeAccess.js', () => ({
  resolveCanonicalRegimeLevel: _resolveCanonicalRegimeLevel,
}));

vi.mock('../../../state.js', () => ({
  getEmergencyStop: _getEmergencyStop,
  // Patch-VITEST-CAT-B: production(전이 import — guards.cmd 경유)이 사용하는 smoke-test
  // accessor 들을 타입 정합 stub 으로 보강 (state.js mock 전체 교체로 누락 시 throw).
  getSmokeTestLiveBlocked: () => false,
  getSmokeTestLastFailedReason: () => null,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

// 동적 import — vi.mock 이 적용된 후 본 모듈을 로드
let forceWatchScan: typeof import('./forceWatchScan.cmd.js').default;
let __resetForceWatchScanRateLimitForTests: typeof import('./forceWatchScan.cmd.js').__resetForceWatchScanRateLimitForTests;

beforeEach(async () => {
  const mod = await import('./forceWatchScan.cmd.js');
  forceWatchScan = mod.default;
  __resetForceWatchScanRateLimitForTests = mod.__resetForceWatchScanRateLimitForTests;
  __resetForceWatchScanRateLimitForTests();

  process.env.AUTO_TRADE_ENABLED = 'true';
  _runGuardedFullDiscoveryPipeline.mockClear();
  _runGuardedFullDiscoveryPipeline.mockResolvedValue({ ok: true, status: 'OK' });
  _autoPopulateWatchlist.mockClear();
  _autoPopulateWatchlist.mockResolvedValue(7);
  _loadWatchlist.mockClear();
  _loadWatchlist.mockReturnValue([{ code: '005930' }, { code: '000660' }]);
  _loadMacroState.mockClear();
  _resolveCanonicalRegimeLevel.mockClear();
  _getEmergencyStop.mockClear();
  _getEmergencyStop.mockReturnValue(false);
});

afterEach(() => {
  delete process.env.AUTO_TRADE_ENABLED;
});

describe('/force_watch_scan — light 모드', () => {
  it('인자 없으면 autoPopulateWatchlist 만 호출, runGuardedFullDiscoveryPipeline 미호출', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply });

    expect(_runGuardedFullDiscoveryPipeline).not.toHaveBeenCalled();
    expect(_autoPopulateWatchlist).toHaveBeenCalledOnce();

    // reply 두 번 호출: 시작 / 결과
    const startMsg = reply.mock.calls[0]![0];
    expect(startMsg).toContain('LIGHT');
    const resultMsg = reply.mock.calls[1]![0];
    expect(resultMsg).toContain('완료');
    expect(resultMsg).toContain('7건');
    expect(resultMsg).not.toContain('universe 발굴');
  });
});

describe('/force_watch_scan — full 모드', () => {
  it("'full' 인자 → runGuardedFullDiscoveryPipeline + autoPopulateWatchlist 순서 호출", async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: ['full'], reply });

    expect(_runGuardedFullDiscoveryPipeline).toHaveBeenCalledOnce();
    expect(_autoPopulateWatchlist).toHaveBeenCalledOnce();

    // 호출 순서 검증 (mock invocation order)
    const fullCallOrder = _runGuardedFullDiscoveryPipeline.mock.invocationCallOrder[0]!;
    const populateCallOrder = _autoPopulateWatchlist.mock.invocationCallOrder[0]!;
    expect(fullCallOrder).toBeLessThan(populateCallOrder);

    const startMsg = reply.mock.calls[0]![0];
    expect(startMsg).toContain('FULL');
    const resultMsg = reply.mock.calls[1]![0];
    expect(resultMsg).toContain('universe 발굴');
  });

  it("'FULL' 대문자 인자도 동일하게 인식 (toLowerCase 정규화)", async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: ['FULL'], reply });

    expect(_runGuardedFullDiscoveryPipeline).toHaveBeenCalledOnce();
    expect(_autoPopulateWatchlist).toHaveBeenCalledOnce();
  });
});

describe('/force_watch_scan — 안전 가드', () => {
  it('60s 이내 재호출 → 차단 + 카운트다운 안내', async () => {
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply: reply1 });
    expect(_autoPopulateWatchlist).toHaveBeenCalledOnce();

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply: reply2 });

    // 두 번째 호출은 차단 메시지 1번만
    expect(reply2).toHaveBeenCalledOnce();
    expect(reply2.mock.calls[0]![0]).toContain('60초 이내');
    expect(reply2.mock.calls[0]![0]).toMatch(/\d+초 후/);

    // autoPopulate 는 첫 호출만 — 두 번째 호출에서 추가 진입 없음
    expect(_autoPopulateWatchlist).toHaveBeenCalledOnce();
  });

  it('AUTO_TRADE_ENABLED=false 시 차단', async () => {
    process.env.AUTO_TRADE_ENABLED = 'false';
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]![0]).toContain('AUTO_TRADE_ENABLED=false');
    expect(_autoPopulateWatchlist).not.toHaveBeenCalled();
    expect(_runGuardedFullDiscoveryPipeline).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_ENABLED 미설정 시 차단', async () => {
    delete process.env.AUTO_TRADE_ENABLED;
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]![0]).toContain('AUTO_TRADE_ENABLED=false');
    expect(_autoPopulateWatchlist).not.toHaveBeenCalled();
  });

  it('emergencyStop=true 시 차단', async () => {
    _getEmergencyStop.mockReturnValue(true);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]![0]).toContain('비상정지');
    expect(_autoPopulateWatchlist).not.toHaveBeenCalled();
    expect(_runGuardedFullDiscoveryPipeline).not.toHaveBeenCalled();
  });
});

describe('/force_watch_scan — 에러 처리', () => {
  it('autoPopulateWatchlist throw → 에러 메시지 응답', async () => {
    _autoPopulateWatchlist.mockRejectedValueOnce(new Error('스크리너 실패'));
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply });

    // reply 두 번 호출: 시작 / 에러
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1]![0]).toContain('재스캔 실패');
    expect(reply.mock.calls[1]![0]).toContain('스크리너 실패');
  });

  it('throw 후에도 rate-limit 갱신 유지 (재시도 폭주 차단)', async () => {
    _autoPopulateWatchlist.mockRejectedValueOnce(new Error('실패'));
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply: reply1 });

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await forceWatchScan.execute({ args: [], reply: reply2 });

    // 두 번째 호출은 차단 메시지
    expect(reply2.mock.calls[0]![0]).toContain('60초 이내');
  });
});

describe('TelegramCommand 메타데이터 정합', () => {
  it('name + aliases 양쪽 등록', () => {
    expect(forceWatchScan.name).toBe('/force_watch_scan');
    expect(forceWatchScan.aliases).toContain('/force_scan');
  });

  it('category=TRD, riskLevel=1, visibility=ADMIN', () => {
    expect(forceWatchScan.category).toBe('TRD');
    expect(forceWatchScan.riskLevel).toBe(1);
    expect(forceWatchScan.visibility).toBe('ADMIN');
  });

  it('description + usage 노출', () => {
    expect(forceWatchScan.description).toBeTruthy();
    expect(forceWatchScan.usage).toContain('/force_watch_scan');
  });
});
