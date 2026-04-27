/**
 * @responsibility cooldownGate 단위 테스트 — Regret Asymmetry 3 분기 동작
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../regretAsymmetryFilter.js', () => ({
  checkCooldownRelease: vi.fn(),
}));

const { cooldownGate } = await import('../cooldownGate.js');
const { makeMockCtx, makeMockStock, makeMockMutables } = await import('./_testHelpers.js');
const { checkCooldownRelease } = await import('../../../regretAsymmetryFilter.js');

describe('cooldownGate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cooldownUntil 미설정 → pass=true (no-op, mutate 없음)', async () => {
    const stock = makeMockStock({ cooldownUntil: undefined });
    const mutables = makeMockMutables();
    const r = await cooldownGate(makeMockCtx({ stock, mutables }));
    expect(r.pass).toBe(true);
    expect(checkCooldownRelease).not.toHaveBeenCalled();
    expect(mutables.watchlistMutated.value).toBe(false);
  });

  it('cooldownUntil 설정 + released=true → pass + mutate (cooldownUntil/recentHigh undefined + watchlistMutated)', async () => {
    (checkCooldownRelease as any).mockReturnValue(true);
    const stock = makeMockStock({ cooldownUntil: '2026-04-30', recentHigh: 5000 });
    const mutables = makeMockMutables();
    const r = await cooldownGate(makeMockCtx({ stock, mutables, currentPrice: 4500 }));
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toContain('쿨다운 해제');
      expect(r.passLogMessage).toContain('진입 재허용');
    }
    expect(stock.cooldownUntil).toBeUndefined();
    expect(stock.recentHigh).toBeUndefined();
    expect(mutables.watchlistMutated.value).toBe(true);
  });

  it('cooldownUntil 설정 + released=false → pass=false (차단) + cooldownUntil 보존', async () => {
    (checkCooldownRelease as any).mockReturnValue(false);
    const stock = makeMockStock({ cooldownUntil: '2026-04-30', recentHigh: 5000 });
    const mutables = makeMockMutables();
    const r = await cooldownGate(makeMockCtx({ stock, mutables }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('쿨다운 유지');
      expect(r.logMessage).toContain('2026-04-30');
    }
    // mutation 차단 확인
    expect(stock.cooldownUntil).toBe('2026-04-30');
    expect(mutables.watchlistMutated.value).toBe(false);
  });

  it('checkCooldownRelease 호출 시 stock.recentHigh ?? entryPrice fallback', async () => {
    (checkCooldownRelease as any).mockReturnValue(true);
    const stock = makeMockStock({ cooldownUntil: '2026-04-30', recentHigh: undefined, entryPrice: 1000 });
    await cooldownGate(makeMockCtx({ stock, currentPrice: 950 }));
    // recentHigh fallback 으로 entryPrice (1000) 사용
    expect(checkCooldownRelease).toHaveBeenCalledWith('2026-04-30', 1000, 950);
  });

  it('차단 메시지에 recentHigh.toLocaleString 포함', async () => {
    (checkCooldownRelease as any).mockReturnValue(false);
    const stock = makeMockStock({ cooldownUntil: '2026-04-30', recentHigh: 12500 });
    const r = await cooldownGate(makeMockCtx({ stock }));
    if (!r.pass) {
      expect(r.logMessage).toContain('12,500'); // toLocaleString
    }
  });
});
