// @responsibility PATCH-0183 preflightLearningRecorder 회귀 테스트 — learning-only invariant + universe snapshot wiring

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shadowLearningOnlyScan.js', () => ({
  isShadowLearningOnBlockedDaysEnabled: vi.fn(),
  runShadowLearningOnlyScan: vi.fn(),
}));

vi.mock('./counterfactualUniverseLearningWiring.js', () => ({
  deriveUniverseLearningReason: vi.fn((primary: string) => {
    if (primary === 'VOLUME_CLOCK_BLOCK') return 'CANDIDATE_EVALUATION_SKIPPED';
    if (primary === 'POSITION_FULL') return 'CANDIDATE_EVALUATION_SKIPPED';
    if (primary === 'FOMC_BLOCK') return 'FOMC_BLOCK_PREFLIGHT';
    return 'LEARNING_ONLY';
  }),
  recordCounterfactualUniverseLearningSnapshot: vi.fn(),
}));

import {
  recordBlockedDayShadowScan,
  recordPreflightUniverseLearningSnapshot,
} from './preflightLearningRecorder.js';
import {
  isShadowLearningOnBlockedDaysEnabled,
  runShadowLearningOnlyScan,
} from '../shadowLearningOnlyScan.js';
import {
  deriveUniverseLearningReason,
  recordCounterfactualUniverseLearningSnapshot,
} from './counterfactualUniverseLearningWiring.js';

const mockedIsShadowLearningOnBlockedDaysEnabled = vi.mocked(isShadowLearningOnBlockedDaysEnabled);
const mockedRunShadowLearningOnlyScan = vi.mocked(runShadowLearningOnlyScan);
const mockedDeriveUniverseLearningReason = vi.mocked(deriveUniverseLearningReason);
const mockedRecordCounterfactualUniverseLearningSnapshot = vi.mocked(recordCounterfactualUniverseLearningSnapshot);

describe('preflightLearningRecorder', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.SUPPLY_HEALTH_LEARNING_ENABLED;
    mockedRunShadowLearningOnlyScan.mockResolvedValue({
      skipped: false,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-10',
      candidates: 0,
      wouldBuyCount: 0,
      signalsRecorded: 0,
    } as Awaited<ReturnType<typeof runShadowLearningOnlyScan>>);
  });

  it('does not run shadow learning when blocked-day learning is disabled', async () => {
    mockedIsShadowLearningOnBlockedDaysEnabled.mockReturnValue(false);

    await recordBlockedDayShadowScan('FOMC_BLOCK');

    expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalled();
  });

  it('records blocked-day shadow learning with real-order disabled invariant and VolumeClock universe snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T00:30:00.000Z'));
    mockedIsShadowLearningOnBlockedDaysEnabled.mockReturnValue(true);

    await recordBlockedDayShadowScan('VOLUME_CLOCK_BLOCK');

    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'BEFORE_BUYLIST_LOOP',
      blockedBy: ['VOLUME_CLOCK_BLOCK'],
      reasons: ['CANDIDATE_EVALUATION_SKIPPED'],
      universeSize: 0,
      candidateCount: 0,
      notes: expect.arrayContaining([
        expect.stringContaining('VOLUME_CLOCK_BLOCK'),
      ]),
    }));
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledTimes(1);
    expect(mockedRunShadowLearningOnlyScan).toHaveBeenCalledWith(expect.objectContaining({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'VOLUME_CLOCK_BLOCK',
      scanDate: '2026-05-10',
    }));
    vi.useRealTimers();
  });

  it('catch-isolates shadow learning failures so preflight callers are not blocked', async () => {
    mockedIsShadowLearningOnBlockedDaysEnabled.mockReturnValue(true);
    mockedRunShadowLearningOnlyScan.mockRejectedValueOnce(new Error('boom'));

    await expect(recordBlockedDayShadowScan('DATA_STARVED')).resolves.toBeUndefined();
  });

  it('records universe learning snapshots with lightweight watchlist candidate summaries', async () => {
    await recordPreflightUniverseLearningSnapshot({
      stage: 'BEFORE_BUYLIST_LOOP',
      primaryReason: 'VOLUME_CLOCK_BLOCK',
      watchlist: [
        { code: '005930', name: '삼성전자', sector: '반도체' } as any,
        { code: '000660', name: 'SK하이닉스', sector: '반도체' } as any,
      ],
      regime: 'R2_BULL',
      marketSnapshot: {
        emergencyStop: false,
        regime: 'R2_BULL',
        vkospiLevel: 18.2,
      },
      notes: ['volume clock closed'],
    });

    expect(mockedDeriveUniverseLearningReason).toHaveBeenCalledWith('VOLUME_CLOCK_BLOCK');
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledTimes(1);
    expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      preflightStage: 'BEFORE_BUYLIST_LOOP',
      blockedBy: ['VOLUME_CLOCK_BLOCK'],
      reasons: ['CANDIDATE_EVALUATION_SKIPPED'],
      regime: 'R2_BULL',
      universeSize: 2,
      candidateCount: 2,
      candidates: [
        { symbol: '005930', name: '삼성전자', sector: '반도체', source: 'watchlist', rank: 1 },
        { symbol: '000660', name: 'SK하이닉스', sector: '반도체', source: 'watchlist', rank: 2 },
      ],
      marketSnapshot: expect.objectContaining({
        emergencyStop: false,
        regime: 'R2_BULL',
      }),
      notes: ['volume clock closed'],
    }));
  });

  it('catch-isolates universe snapshot failures so preflight callers are not blocked', async () => {
    mockedRecordCounterfactualUniverseLearningSnapshot.mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    await expect(recordPreflightUniverseLearningSnapshot({
      stage: 'AFTER_UNIVERSE_BUILD',
      primaryReason: 'FOMC_BLOCK',
    })).resolves.toBeUndefined();
  });
});
