/**
 * trancheExecutorAutoTradeGuard.test.ts — PR-52 H1 회귀 가드.
 *
 * 자동매매 audit 결과 — `trancheExecutor.checkPendingTranches()` 가
 * `AUTO_TRADE_ENABLED` 가드 밖에서 호출돼 분할 매수 2·3차 LIVE 실주문이
 * 의도와 무관하게 발송될 수 있던 잠재 위험을 차단.
 *
 * 본 테스트는 `checkPendingTranches()` 본체의 가드 진입부 동작을 검증한다:
 *   1. AUTO_TRADE_ENABLED=false → loadTranches 호출 전 즉시 return
 *   2. AUTO_TRADE_ENABLED=true + KIS_APP_KEY 미설정 → 즉시 return (기존 동작 보존)
 *   3. AUTO_TRADE_ENABLED=true + KIS_APP_KEY='test' → 가드 통과 후 본체 진입
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../persistence/paths.js', () => ({
  TRANCHE_FILE: '/tmp/tranches.json',
  ensureDataDir: vi.fn(),
}));

vi.mock('../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn(() => ({})),
}));

vi.mock('../quantFilter.js', () => ({
  evaluateServerGate: vi.fn(),
}));

vi.mock('../clients/kisClient.js', () => ({
  kisPost: vi.fn(),
  BUY_TR_ID: 'TTTC0802U',
  fetchCurrentPrice: vi.fn(),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(),
}));

vi.mock('./fillMonitor.js', () => ({
  fillMonitor: { startWatching: vi.fn() },
}));

vi.mock('../screener/stockScreener.js', () => ({
  fetchYahooQuote: vi.fn(),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => []),
}));

vi.mock('../telegram/buyApproval.js', () => ({
  requestBuyApproval: vi.fn(),
}));

vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => null),
}));

vi.mock('./regimeBridge.js', () => ({
  getLiveRegime: vi.fn(() => 'R3_NEUTRAL'),
}));

vi.mock('./krxHolidays.js', () => ({
  KRX_HOLIDAYS: new Set<string>(),
}));

describe('trancheExecutor.checkPendingTranches AUTO_TRADE_ENABLED 가드 (PR-52 H1)', () => {
  const originalEnv = { ...process.env };
  let trancheExecutor: typeof import('./trancheExecutor.js')['trancheExecutor'];
  let fsMock: { existsSync: ReturnType<typeof vi.fn>; readFileSync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();
    fsMock = (await import('fs')) as unknown as {
      existsSync: ReturnType<typeof vi.fn>;
      readFileSync: ReturnType<typeof vi.fn>;
    };
    fsMock.existsSync.mockClear();
    fsMock.readFileSync.mockClear();
    const mod = await import('./trancheExecutor.js');
    trancheExecutor = mod.trancheExecutor;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('AUTO_TRADE_ENABLED=false 시 즉시 return — loadTranches 미호출', async () => {
    process.env.KIS_APP_KEY = 'test_key';
    process.env.AUTO_TRADE_ENABLED = 'false';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await trancheExecutor.checkPendingTranches();

    // loadTranches 가 호출되지 않았는지 — fs.existsSync 가 호출 안 됐어야 함
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    // 가드 진단 로그 검증
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('AUTO_TRADE_ENABLED=false'),
    );
    logSpy.mockRestore();
  });

  it('AUTO_TRADE_ENABLED 미설정 (undefined) 시에도 가드 작동 — undefined !== "true"', async () => {
    process.env.KIS_APP_KEY = 'test_key';
    delete process.env.AUTO_TRADE_ENABLED;

    await trancheExecutor.checkPendingTranches();

    expect(fsMock.existsSync).not.toHaveBeenCalled();
  });

  it('KIS_APP_KEY 미설정 시 enabled 무관 즉시 return — 기존 동작 보존', async () => {
    delete process.env.KIS_APP_KEY;
    process.env.AUTO_TRADE_ENABLED = 'true';

    await trancheExecutor.checkPendingTranches();

    // KIS_APP_KEY 가드가 먼저 발동 → 가드 진단 로그 미출력
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_ENABLED=true + KIS_APP_KEY 설정 시 가드 미진입 — 진단 로그 미출력', async () => {
    process.env.KIS_APP_KEY = 'test_key';
    process.env.AUTO_TRADE_ENABLED = 'true';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await trancheExecutor.checkPendingTranches();

    // enabled=true 면 enabled 가드 진단 로그가 출력되지 않는다.
    const guardLogs = logSpy.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('AUTO_TRADE_ENABLED=false'),
    );
    expect(guardLogs).toHaveLength(0);
    logSpy.mockRestore();
  });
});
