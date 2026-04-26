// @responsibility kellyBudgetDecider 회귀 테스트 — budget 차단 / sized=0 차단 / 통과 + capped 경고

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../accountRiskBudget.js', () => ({
  getAccountRiskBudget: vi.fn(),
  computeRiskAdjustedSize: vi.fn(),
}));

vi.mock('../../../../clients/kisStreamClient.js', () => ({
  getRealtimePrice: vi.fn(() => null),
}));

vi.mock('../../../entryEngine.js', () => ({
  isOpenShadowStatus: vi.fn((_status: string) => true),
}));

import { kellyBudgetDecider } from '../kellyBudgetDecider.js';
import { getAccountRiskBudget, computeRiskAdjustedSize } from '../../../accountRiskBudget.js';

const baseInput = {
  stockName: '삼성전자',
  shadowEntryPrice: 70_000,
  stopLoss: 65_000,
  signalGrade: 'BUY' as const,
  positionPct: 0.05,
  mtas: 7,
  totalAssets: 100_000_000,
  shadows: [],
};

describe('kellyBudgetDecider', () => {
  beforeEach(() => {
    vi.mocked(getAccountRiskBudget).mockReset();
    vi.mocked(computeRiskAdjustedSize).mockReset();
  });

  it('budget.canEnterNew=false — 차단', () => {
    vi.mocked(getAccountRiskBudget).mockReturnValue({
      canEnterNew: false,
      blockedReasons: ['daily_loss_cap', 'concurrent_R_full'],
    } as never);
    const result = kellyBudgetDecider(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.logMessage).toBe('[AutoTrade/RiskBudget] 삼성전자 진입 차단 — daily_loss_cap / concurrent_R_full');
  });

  it('sized.recommendedBudgetKrw <= 0 — 차단', () => {
    vi.mocked(getAccountRiskBudget).mockReturnValue({
      canEnterNew: true, blockedReasons: [], openRiskPct: 0.1,
    } as never);
    vi.mocked(computeRiskAdjustedSize).mockReturnValue({
      recommendedBudgetKrw: 0,
      reason: '리스크 한계',
      effectiveKelly: 0,
      kellyWasCapped: false,
    } as never);
    const result = kellyBudgetDecider(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.logMessage).toBe('[AutoTrade/RiskBudget] 삼성전자 사이즈 0 — 리스크 한계');
  });

  it('정상 통과 — ok=true + budget/sized 반환', () => {
    vi.mocked(getAccountRiskBudget).mockReturnValue({
      canEnterNew: true, blockedReasons: [], openRiskPct: 0.05,
    } as never);
    vi.mocked(computeRiskAdjustedSize).mockReturnValue({
      recommendedBudgetKrw: 5_000_000,
      reason: 'OK',
      effectiveKelly: 0.05,
      kellyWasCapped: false,
    } as never);
    const result = kellyBudgetDecider(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sized.recommendedBudgetKrw).toBe(5_000_000);
    expect(result.confidenceModifier).toBeCloseTo(0.6 + 0.05 * 7);
    expect(result.logMessages).toEqual([]);
  });

  it('Kelly 캡 적용 — 통과 + capped 경고 메시지', () => {
    vi.mocked(getAccountRiskBudget).mockReturnValue({
      canEnterNew: true, blockedReasons: [], openRiskPct: 0.05,
    } as never);
    vi.mocked(computeRiskAdjustedSize).mockReturnValue({
      recommendedBudgetKrw: 3_000_000,
      reason: 'Fractional cap 적용',
      effectiveKelly: 0.025,
      kellyWasCapped: true,
    } as never);
    const result = kellyBudgetDecider(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logMessages).toEqual([
      '[AutoTrade/RiskBudget] 삼성전자 Fractional Kelly 캡 적용 — Fractional cap 적용',
    ]);
  });
});
