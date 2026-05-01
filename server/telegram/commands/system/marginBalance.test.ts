/**
 * @responsibility marginBalance.cmd 회귀 테스트 — ADR-0139.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _fetchLatestMarginBalance5dChange = vi.fn();
const _loadMacroState = vi.fn();

vi.mock('../../../clients/ecosClient.js', () => ({
  fetchLatestMarginBalance5dChange: _fetchLatestMarginBalance5dChange,
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: _loadMacroState,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let marginBalance: typeof import('./marginBalance.cmd.js').default;
let buildMarginBalanceMessage: typeof import('./marginBalance.cmd.js').buildMarginBalanceMessage;

beforeEach(async () => {
  vi.resetModules();
  _fetchLatestMarginBalance5dChange.mockReset();
  _loadMacroState.mockReset();
  const mod = await import('./marginBalance.cmd.js');
  marginBalance = mod.default;
  buildMarginBalanceMessage = mod.buildMarginBalanceMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildMarginBalanceMessage', () => {
  it('실시간 정상 (양수 +3.5%) + 영속 ECOS_API → 비교 표기', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue({
      changePct: 3.5,
      latestDate: '2026-04-29',
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'ECOS_API',
    });
    _loadMacroState.mockReturnValue({
      mhs: 60, regime: 'GREEN', updatedAt: '2026-05-01T01:00:00Z',
      marginBalance5dChange: 3.0,
      marginBalanceFetchedAt: '2026-05-01T00:30:00Z',
      marginBalanceSource: 'ECOS_API',
    });
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('실시간 (ECOS 직접 호출)');
    expect(msg).toContain('🟢');
    expect(msg).toContain('+3.50%');
    expect(msg).toContain('증가');
    expect(msg).toContain('2026-04-29');
    expect(msg).toContain('macroState 영속');
    expect(msg).toContain('+3.00%');
  });

  it('실시간 5% 임계 도달 → 🔴 + 과열 라벨', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue({
      changePct: 5.0,
      latestDate: '2026-04-29',
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'ECOS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('🔴');
    expect(msg).toContain('과열');
    expect(msg).toContain('+5.00%');
  });

  it('실시간 음수 (감소) → 🔵', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue({
      changePct: -2.5,
      latestDate: '2026-04-29',
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'ECOS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('🔵');
    expect(msg).toContain('-2.50%');
    expect(msg).toContain('감소');
  });

  it('ECOS null 응답 → 운영자 안내 4종', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue(null);
    _loadMacroState.mockReturnValue(null);
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('ECOS 실시간 조회 실패');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('ECOS_API_KEY');
    expect(msg).toContain('ECOS_API_DISABLED');
    expect(msg).toContain('ECOS_MARGIN_LOAN_STAT_CODE');
    expect(msg).toContain('ECOS_MARGIN_LOAN_ITEM_CODE');
  });

  it('영속 marginBalanceSource=NONE → 마지막 cron 실패 안내', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue(null);
    _loadMacroState.mockReturnValue({
      mhs: 50, regime: 'GREEN', updatedAt: '2026-05-01T01:00:00Z',
      marginBalanceSource: 'NONE',
    });
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('마지막 cron 사이클 ECOS 호출 실패');
  });

  it('영속 marginBalanceSource 부재 → 미수집 안내', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue(null);
    _loadMacroState.mockReturnValue({ mhs: 50, regime: 'GREEN', updatedAt: '2026-05-01T01:00:00Z' });
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('미수집');
  });

  it('5% 임계 안내 항상 표시', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue(null);
    _loadMacroState.mockReturnValue(null);
    const msg = await buildMarginBalanceMessage();
    expect(msg).toContain('임계 안내');
    expect(msg).toContain('5%');
    expect(msg).toContain('enemyChecklist');
  });
});

describe('marginBalance.cmd execute', () => {
  it('정상 실행 + 헤더 포함', async () => {
    _fetchLatestMarginBalance5dChange.mockResolvedValue({
      changePct: 1.5,
      latestDate: '2026-04-29',
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'ECOS_API',
    });
    _loadMacroState.mockReturnValue(null);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await marginBalance.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('신용공여잔액');
  });

  it('throw → ❌ 실패 응답', async () => {
    _fetchLatestMarginBalance5dChange.mockRejectedValue(new Error('ECOS down'));
    _loadMacroState.mockReturnValue(null);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await marginBalance.execute({ args: [], reply });
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });
});

describe('marginBalance 메타데이터', () => {
  it('name=/margin_balance + alias=/margin + /mb', () => {
    expect(marginBalance.name).toBe('/margin_balance');
    expect(marginBalance.aliases).toEqual(['/margin', '/mb']);
  });

  it('SYS / riskLevel=0 / ADMIN', () => {
    expect(marginBalance.category).toBe('SYS');
    expect(marginBalance.riskLevel).toBe(0);
    expect(marginBalance.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(marginBalance.description.length).toBeGreaterThan(10);
    expect(marginBalance.usage).toBe('/margin_balance');
  });
});
