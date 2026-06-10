// @responsibility ADR-0176 Phase 3 — replay dispatcher jobName→실함수 매핑 회귀 (7 union 전수 + 실패 전파)
/**
 * missedLearningReplayDispatcher.test.ts (PENDING_WIRING A10+A15 wiring)
 *
 * `dispatchMissedLearningReplay` 의 7 MissedLearningJobName → 실제 학습 복구 함수
 * 매핑 검증. 모든 학습 모듈은 mock — 실제 영속/KIS 호출 0건.
 *
 * invariant:
 *   1. 7 jobName 전수 매핑 (union exhaustive switch)
 *   2. 매핑 외 함수 미호출 (cross-call 0건)
 *   3. 본체 함수 reject → dispatch reject (queue 가 FAILED 영속하도록 전파)
 *   4. suggest 보조 평가 reject → swallow + warn (본체 복구 성공 유지)
 *   5. ledger priceFetcher 는 fetchCurrentPrice 위임 + 실패 시 null (read-only)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./backtestEngine.js', () => ({ runWeeklyMiniBacktest: vi.fn(async () => ({})) }));
vi.mock('./nightlyReflectionEngine.js', () => ({ runNightlyReflection: vi.fn(async () => ({})) }));
vi.mock('./ghostPortfolioTracker.js', () => ({ refreshGhostPortfolio: vi.fn(async () => ({})) }));
vi.mock('./counterfactualShadow.js', () => ({
  evaluateCounterfactualSuggestion: vi.fn(async () => ({})),
}));
vi.mock('./learningSampleQuality.js', () => ({ counterfactualResolveDueRun: vi.fn(() => ({})) }));
vi.mock('./ledgerSimulator.js', () => ({
  resolveLedger: vi.fn(async () => ({})),
  evaluateLedgerSuggestion: vi.fn(async () => ({})),
}));
vi.mock('./kellySurfaceMap.js', () => ({ evaluateKellySurfaceSuggestion: vi.fn(async () => ({})) }));
vi.mock('./regimeBalancedSampler.js', () => ({
  evaluateRegimeCoverageSuggestion: vi.fn(async () => ({})),
}));
vi.mock('./safetyGateAttribution.js', () => ({ computeSafetyGateAttribution: vi.fn(() => []) }));
vi.mock('./shadowVsLiveDelta.js', () => ({ computeShadowVsLiveDelta: vi.fn(() => []) }));
vi.mock('../clients/kisClient.js', () => ({ fetchCurrentPrice: vi.fn(async () => 1000) }));
vi.mock('../persistence/shadowLearningOnlySignalRepo.js', () => ({
  loadShadowLearningOnlySignals: vi.fn(() => []),
}));
vi.mock('../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: vi.fn(() => []) }));

import { dispatchMissedLearningReplay } from './missedLearningReplayDispatcher.js';
import type { MissedLearningJobName } from './missedLearningQueue.js';
import { runWeeklyMiniBacktest } from './backtestEngine.js';
import { runNightlyReflection } from './nightlyReflectionEngine.js';
import { refreshGhostPortfolio } from './ghostPortfolioTracker.js';
import { evaluateCounterfactualSuggestion } from './counterfactualShadow.js';
import { counterfactualResolveDueRun } from './learningSampleQuality.js';
import { resolveLedger, evaluateLedgerSuggestion } from './ledgerSimulator.js';
import { evaluateKellySurfaceSuggestion } from './kellySurfaceMap.js';
import { evaluateRegimeCoverageSuggestion } from './regimeBalancedSampler.js';
import { computeSafetyGateAttribution } from './safetyGateAttribution.js';
import { computeShadowVsLiveDelta } from './shadowVsLiveDelta.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';

const ALL_JOB_NAMES: MissedLearningJobName[] = [
  'counterfactual_resolve',
  'ledger_resolve',
  'ghost_portfolio',
  'nightly_reflection',
  'daily_mini_backtest',
  'shadow_live_delta_report',
  'safety_gate_attribution',
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchMissedLearningReplay — jobName → 실함수 매핑', () => {
  it('counterfactual_resolve → counterfactualResolveDueRun + suggest 평가', async () => {
    await dispatchMissedLearningReplay('counterfactual_resolve');
    expect(counterfactualResolveDueRun).toHaveBeenCalledTimes(1);
    expect(evaluateCounterfactualSuggestion).toHaveBeenCalledTimes(1);
    expect(resolveLedger).not.toHaveBeenCalled();
  });

  it('ledger_resolve → resolveLedger + 3 suggest 스윕 (원본 cron 정합)', async () => {
    await dispatchMissedLearningReplay('ledger_resolve');
    expect(resolveLedger).toHaveBeenCalledTimes(1);
    expect(evaluateLedgerSuggestion).toHaveBeenCalledTimes(1);
    expect(evaluateKellySurfaceSuggestion).toHaveBeenCalledTimes(1);
    expect(evaluateRegimeCoverageSuggestion).toHaveBeenCalledTimes(1);
    expect(counterfactualResolveDueRun).not.toHaveBeenCalled();
  });

  it('ledger_resolve priceFetcher — fetchCurrentPrice 위임 (read-only) + 실패 시 null', async () => {
    await dispatchMissedLearningReplay('ledger_resolve');
    const fetcher = vi.mocked(resolveLedger).mock.calls[0]![0] as (
      code: string,
    ) => Promise<number | null>;
    await expect(fetcher('005930')).resolves.toBe(1000);
    expect(fetchCurrentPrice).toHaveBeenCalledWith('005930');
    vi.mocked(fetchCurrentPrice).mockRejectedValueOnce(new Error('kis down'));
    await expect(fetcher('000660')).resolves.toBeNull();
  });

  it('ghost_portfolio → refreshGhostPortfolio', async () => {
    await dispatchMissedLearningReplay('ghost_portfolio');
    expect(refreshGhostPortfolio).toHaveBeenCalledTimes(1);
    expect(runNightlyReflection).not.toHaveBeenCalled();
  });

  it('nightly_reflection → runNightlyReflection', async () => {
    await dispatchMissedLearningReplay('nightly_reflection');
    expect(runNightlyReflection).toHaveBeenCalledTimes(1);
    expect(refreshGhostPortfolio).not.toHaveBeenCalled();
  });

  it('daily_mini_backtest → runWeeklyMiniBacktest', async () => {
    await dispatchMissedLearningReplay('daily_mini_backtest');
    expect(runWeeklyMiniBacktest).toHaveBeenCalledTimes(1);
  });

  it('shadow_live_delta_report → computeShadowVsLiveDelta (영속 read 2종 입력)', async () => {
    await dispatchMissedLearningReplay('shadow_live_delta_report');
    expect(computeShadowVsLiveDelta).toHaveBeenCalledTimes(1);
    expect(loadShadowLearningOnlySignals).toHaveBeenCalled();
    expect(loadShadowTrades).toHaveBeenCalled();
    expect(computeSafetyGateAttribution).not.toHaveBeenCalled();
  });

  it('safety_gate_attribution → computeSafetyGateAttribution (영속 read 입력)', async () => {
    await dispatchMissedLearningReplay('safety_gate_attribution');
    expect(computeSafetyGateAttribution).toHaveBeenCalledTimes(1);
    expect(loadShadowLearningOnlySignals).toHaveBeenCalled();
    expect(computeShadowVsLiveDelta).not.toHaveBeenCalled();
  });

  it('7 jobName union 전수 — 모두 reject 없이 dispatch 가능', async () => {
    for (const name of ALL_JOB_NAMES) {
      await expect(dispatchMissedLearningReplay(name)).resolves.toBeUndefined();
    }
  });
});

describe('dispatchMissedLearningReplay — 실패 전파 / 보조 평가 격리', () => {
  it('본체 함수 reject → dispatch reject (queue FAILED 영속 전파)', async () => {
    vi.mocked(refreshGhostPortfolio).mockRejectedValueOnce(new Error('ghost boom'));
    await expect(dispatchMissedLearningReplay('ghost_portfolio')).rejects.toThrow('ghost boom');
  });

  it('suggest 보조 평가 reject → swallow + warn (본체 복구 성공 유지)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(evaluateLedgerSuggestion).mockRejectedValueOnce(new Error('suggest boom'));
    await expect(dispatchMissedLearningReplay('ledger_resolve')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
