/**
 * @responsibility fssStatus.cmd 회귀 테스트 — ADR-0136
 *
 * 검증:
 *   - formatFssStatusMessage: OK / STALE / MISSING / passiveActiveBoth=true|false|null 분기
 *   - 운영자 안내 분기 (MISSING / STALE / 표본 부족)
 *   - cmd execute: 정상 / throw graceful
 *   - 메타데이터: name + aliases (/fss) + category=SYS + riskLevel=0 + visibility=ADMIN
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _getFssRecordsAge = vi.fn();
const _loadFssRecords = vi.fn();
const _loadMacroState = vi.fn();

vi.mock('../../../persistence/fssRepo.js', () => ({
  getFssRecordsAge: _getFssRecordsAge,
  loadFssRecords: _loadFssRecords,
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: _loadMacroState,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let fssStatus: typeof import('./fssStatus.cmd.js').default;
let formatFssStatusMessage: typeof import('./fssStatus.cmd.js').formatFssStatusMessage;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./fssStatus.cmd.js');
  fssStatus = mod.default;
  formatFssStatusMessage = mod.formatFssStatusMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('formatFssStatusMessage', () => {
  it('OK + passiveActiveBoth=true', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'OK', latestDate: '2026-05-01', ageDays: 0, recordCount: 30,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: 80, activeNetBuy: 30 },
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    _loadMacroState.mockReturnValue({ passiveActiveBoth: true, mhs: 70, regime: 'GREEN' });

    const msg = formatFssStatusMessage();
    expect(msg).toContain('✅');
    expect(msg).toContain('OK');
    expect(msg).toContain('2026-05-01 (0일 전)');
    expect(msg).toContain('영속 레코드: 30건');
    expect(msg).toContain('last5 표본: 3건');
    expect(msg).toContain('Passive+Active 5일 동시 외인 순매수');
    // 정상 시 운영자 안내 미노출
    expect(msg).not.toContain('운영자 안내');
  });

  it('STALE + passiveActiveBoth=null + 운영자 안내', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'STALE', latestDate: '2026-04-25', ageDays: 6, recordCount: 5,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-25', passiveNetBuy: 100, activeNetBuy: 50 },
    ]);
    _loadMacroState.mockReturnValue({ passiveActiveBoth: null });

    const msg = formatFssStatusMessage();
    expect(msg).toContain('⚠️');
    expect(msg).toContain('STALE');
    expect(msg).toContain('2026-04-25 (6일 전)');
    expect(msg).toContain('평가 제외');
    expect(msg).toContain('STALE/MISSING');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('6일 전');
  });

  it('MISSING + passiveActiveBoth 미수집 + 운영자 안내', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'MISSING', latestDate: null, ageDays: null, recordCount: 0,
    });
    _loadFssRecords.mockReturnValue([]);
    _loadMacroState.mockReturnValue(null);

    const msg = formatFssStatusMessage();
    expect(msg).toContain('❌');
    expect(msg).toContain('MISSING');
    expect(msg).toContain('미수집');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('POST /api/macro/fss-records');
  });

  it('OK + passiveActiveBoth=false', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'OK', latestDate: '2026-05-01', ageDays: 0, recordCount: 5,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: -10, activeNetBuy: 30 },  // passive 음수
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    _loadMacroState.mockReturnValue({ passiveActiveBoth: false });

    const msg = formatFssStatusMessage();
    expect(msg).toContain('OK');
    expect(msg).toContain('외인 합치 미감지');
  });

  it('OK + 표본 < 3 시 운영자 안내 표본 부족', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'OK', latestDate: '2026-05-01', ageDays: 0, recordCount: 2,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-30', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-05-01', passiveNetBuy: 80, activeNetBuy: 30 },
    ]);
    _loadMacroState.mockReturnValue({ passiveActiveBoth: null });

    const msg = formatFssStatusMessage();
    expect(msg).toContain('OK');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('표본 < 3');
  });

  it('passiveActiveBoth 미수집 (undefined)', () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'OK', latestDate: '2026-05-01', ageDays: 0, recordCount: 5,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: 80, activeNetBuy: 30 },
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    _loadMacroState.mockReturnValue({ /* passiveActiveBoth 부재 */ });

    const msg = formatFssStatusMessage();
    expect(msg).toContain('미수집');
  });
});

describe('fssStatus.cmd execute', () => {
  it('정상 실행 시 reply 한 번 호출 + FSS 진단 헤더 포함', async () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'OK', latestDate: '2026-05-01', ageDays: 0, recordCount: 10,
    });
    _loadFssRecords.mockReturnValue([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: 80, activeNetBuy: 30 },
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    _loadMacroState.mockReturnValue({ passiveActiveBoth: true });

    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssStatus.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('FSS 수급 진단');
  });

  it('formatFssStatusMessage throw 시 ❌ 실패 응답', async () => {
    _getFssRecordsAge.mockImplementation(() => { throw new Error('disk read failed'); });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssStatus.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('FSS 진단 실패');
  });

  it('args 무시 — 인자 무관 동작', async () => {
    _getFssRecordsAge.mockReturnValue({
      status: 'MISSING', latestDate: null, ageDays: null, recordCount: 0,
    });
    _loadFssRecords.mockReturnValue([]);
    _loadMacroState.mockReturnValue(null);

    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssStatus.execute({ args: ['random', 'arg'], reply });
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe('fssStatus 메타데이터', () => {
  it('name=/fss_status + alias=/fss', () => {
    expect(fssStatus.name).toBe('/fss_status');
    expect(fssStatus.aliases).toEqual(['/fss']);
  });

  it('category=SYS + riskLevel=0 (read-only) + visibility=ADMIN', () => {
    expect(fssStatus.category).toBe('SYS');
    expect(fssStatus.riskLevel).toBe(0);
    expect(fssStatus.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(fssStatus.description.length).toBeGreaterThan(10);
    expect(fssStatus.usage).toBeTruthy();
  });
});
