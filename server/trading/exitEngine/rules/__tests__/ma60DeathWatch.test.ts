/**
 * @responsibility ma60DeathWatch 60일선 역배열 최초 감지 5영업일 스케줄 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return { ...actual, appendShadowLog: vi.fn() };
});
vi.mock('../../helpers/ma60.js', () => ({
  fetchMaFromCloses: vi.fn(),
  isMA60Death: vi.fn(),
  kstBusinessDateStr: vi.fn(() => '2026-05-01'),
}));

const { ma60DeathWatch } = await import('../ma60DeathWatch.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { fetchMaFromCloses, isMA60Death } = await import('../../helpers/ma60.js');

describe('ma60DeathWatch (역배열 최초 감지)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('이미 ma60DeathDetectedAt 설정 → NO_OP (이미 스케줄됨)', async () => {
    const shadow = makeMockShadow({ ma60DeathDetectedAt: '2026-04-20T00:00:00Z' });
    const r = await ma60DeathWatch(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(fetchMaFromCloses).not.toHaveBeenCalled();
  });

  it('ma60DeathForced=true → NO_OP (강제 청산 완료된 trade)', async () => {
    const shadow = makeMockShadow({ ma60DeathForced: true });
    const r = await ma60DeathWatch(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(fetchMaFromCloses).not.toHaveBeenCalled();
  });

  it('MA fetch 실패 → NO_OP', async () => {
    (fetchMaFromCloses as any).mockResolvedValue(null);
    const shadow = makeMockShadow();
    const r = await ma60DeathWatch(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(shadow.ma60DeathDetectedAt).toBeUndefined();
  });

  it('역배열 아님 → NO_OP', async () => {
    (fetchMaFromCloses as any).mockResolvedValue({ ma20: 100, ma60: 95 });
    (isMA60Death as any).mockReturnValue(false);
    const shadow = makeMockShadow();
    await ma60DeathWatch(makeMockCtx({ shadow }));
    expect(shadow.ma60DeathDetectedAt).toBeUndefined();
  });

  it('역배열 신규 감지 → ma60DeathDetectedAt + ma60ForceExitDate 설정 + 텔레그램', async () => {
    (fetchMaFromCloses as any).mockResolvedValue({ ma20: 95, ma60: 100 });
    (isMA60Death as any).mockReturnValue(true);
    const shadow = makeMockShadow();
    await ma60DeathWatch(makeMockCtx({ shadow, currentPrice: 90 }));
    expect(shadow.ma60DeathDetectedAt).toBeTruthy();
    expect(shadow.ma60ForceExitDate).toBe('2026-05-01');
    expect(shadow.exitRuleTag).toBe('MA60_DEATH_WATCH');
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
  });
});
