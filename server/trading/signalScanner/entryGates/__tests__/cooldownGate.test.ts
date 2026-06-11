/**
 * @responsibility cooldownGate 단위 테스트 — Regret Asymmetry 3 분기 동작
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../regretAsymmetryFilter.js', () => ({
  checkCooldownRelease: vi.fn(),
  evaluateRegretAsymmetry: vi.fn(),
  isRegretEntryReevaluationEnabled: vi.fn(() => false),
  FOMO_SURGE_THRESHOLD_PCT: 15,
}));

const { cooldownGate } = await import('../cooldownGate.js');
const { makeMockCtx, makeMockStock, makeMockMutables } = await import('./_testHelpers.js');
const { checkCooldownRelease, evaluateRegretAsymmetry, isRegretEntryReevaluationEnabled } = await import('../../../regretAsymmetryFilter.js');

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

describe('cooldownGate — ADR-0598 G1 진입 시점 재평가', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('flag OFF + 5d>+15% → pass=true (observe 전용, stamp 없음 — byte-equivalent)', async () => {
    (isRegretEntryReevaluationEnabled as any).mockReturnValue(false);
    const stock = makeMockStock({ cooldownUntil: undefined, symbolFeatures: { return5d: 22.4 } });
    const mutables = makeMockMutables();
    const r = await cooldownGate(makeMockCtx({ stock, mutables }));
    expect(r.pass).toBe(true);
    expect(evaluateRegretAsymmetry).not.toHaveBeenCalled();
    expect(stock.cooldownUntil).toBeUndefined();
    expect(mutables.watchlistMutated.value).toBe(false);
  });

  it('flag ON + 5d>+15% → pass=false + 쿨다운 신규 stamp + watchlistMutated', async () => {
    (isRegretEntryReevaluationEnabled as any).mockReturnValue(true);
    (evaluateRegretAsymmetry as any).mockReturnValue({
      isCooldown: true, reason: 'FOMO', cooldownUntil: '2026-06-13T03:30:00.000Z', recentHigh: 171_500,
    });
    const stock = makeMockStock({ cooldownUntil: undefined, symbolFeatures: { return5d: 22.4 } });
    const mutables = makeMockMutables();
    const r = await cooldownGate(makeMockCtx({ stock, mutables, currentPrice: 171_500 }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('진입 시점 재평가');
      expect(r.logMessage).toContain('+22.4%');
    }
    expect(evaluateRegretAsymmetry).toHaveBeenCalledWith(22.4, 171_500);
    expect(stock.cooldownUntil).toBe('2026-06-13T03:30:00.000Z');
    expect(stock.recentHigh).toBe(171_500);
    expect(mutables.watchlistMutated.value).toBe(true);
  });

  it('flag ON + 5d<=+15% → pass=true (재평가 미발동)', async () => {
    (isRegretEntryReevaluationEnabled as any).mockReturnValue(true);
    const stock = makeMockStock({ cooldownUntil: undefined, symbolFeatures: { return5d: 9.8 } });
    const r = await cooldownGate(makeMockCtx({ stock }));
    expect(r.pass).toBe(true);
    expect(evaluateRegretAsymmetry).not.toHaveBeenCalled();
  });

  it('flag ON + return5d 결손/NaN → pass=true (결손 ≠ 추격 신호, 불변식 #6)', async () => {
    (isRegretEntryReevaluationEnabled as any).mockReturnValue(true);
    for (const symbolFeatures of [undefined, {}, { return5d: Number.NaN }]) {
      const stock = makeMockStock({ cooldownUntil: undefined, symbolFeatures: symbolFeatures as never });
      const r = await cooldownGate(makeMockCtx({ stock }));
      expect(r.pass).toBe(true);
    }
    expect(evaluateRegretAsymmetry).not.toHaveBeenCalled();
  });
});
