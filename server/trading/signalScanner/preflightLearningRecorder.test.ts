// @responsibility PATCH-0183 preflightLearningRecorder 회귀 테스트 — learning-only invariant + universe snapshot wiring

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  // ADR-0367: recordPreflightUniverseLearningSnapshot 가 candidateSummaryCount 산출용으로 호출.
  buildCandidateSummaries: vi.fn((candidates?: unknown[]) => candidates ?? []),
}));

import {
  recordBlockedDayShadowScan,
  recordPreflightBlockedScan,
  recordPreflightUniverseLearningSnapshot,
} from './preflightLearningRecorder.js';
import { __resetPreflightBlockedScanSummaryForTests } from './preflightBlockedScanSummary.js';
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
    // ADR-0367: recordPreflightUniverseLearningSnapshot 가 result.recorded 를 읽으므로 기본 반환값 지정.
    mockedRecordCounterfactualUniverseLearningSnapshot.mockReturnValue({ recorded: true });
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

    // ADR-0367: catch 격리 시 throw 하지 않고 { recorded: false, candidateSummaryCount: 0 } 반환.
    await expect(recordPreflightUniverseLearningSnapshot({
      stage: 'AFTER_UNIVERSE_BUILD',
      primaryReason: 'FOMC_BLOCK',
    })).resolves.toEqual({ recorded: false, candidateSummaryCount: 0 });
  });

  // ADR-0367: recordPreflightBlockedScan — universe learning + blocked scan summary 동시 영속.
  describe('recordPreflightBlockedScan (ADR-0367)', () => {
    afterEach(() => {
      __resetPreflightBlockedScanSummaryForTests();
    });

    it('still records counterfactual universe learning — shadow/counterfactual 기록 유지', async () => {
      const result = await recordPreflightBlockedScan(
        {
          stage: 'AFTER_UNIVERSE_BUILD',
          primaryReason: 'HARD_BLOCK',
          watchlist: [
            { code: '005930', name: '삼성전자', sector: '반도체' } as any,
            { code: '000660', name: 'SK하이닉스', sector: '반도체' } as any,
          ],
          regime: 'R2_BULL',
        },
        {
          blockedBy: 'HARD_BLOCK',
          hardBlockSource: 'R3_SANITY_LATCH',
          hardBlockModule: 'r3SanityBlockRepo',
          hardBlockReason: 'GATE1_PASS_ZERO',
          preflightDecision: 'ABORT_HARD_BLOCK',
        },
      );

      expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result?.blockedBy).toBe('HARD_BLOCK');
      expect(result?.hardBlockSource).toBe('R3_SANITY_LATCH');
      expect(result?.hardBlockModule).toBe('r3SanityBlockRepo');
      expect(result?.candidateSummaryCount).toBe(2);
      expect(result?.universeSnapshotRecorded).toBe(true);
      expect(result?.counterfactualRecorded).toBe(true);
      expect(result?.executionImpact).toBe('NONE');
      expect(result?.liveExecutionAllowed).toBe(false);
      expect(result?.buyListLoopEntered).toBe(false);
    });

    it('propagates recorded=false when counterfactual recording is disabled — candidateSummaryCount은 순수 계산 유지', async () => {
      mockedRecordCounterfactualUniverseLearningSnapshot.mockReturnValueOnce({ recorded: false, reason: 'env-disabled' });

      const result = await recordPreflightBlockedScan(
        {
          stage: 'BEFORE_BUYLIST_LOOP',
          primaryReason: 'POSITION_FULL',
          watchlist: [{ code: '005930', name: '삼성전자', sector: '반도체' } as any],
        },
        { blockedBy: 'NO_BUYLIST_ELIGIBLE', preflightDecision: 'ABORT_POSITION_FULL' },
      );

      expect(result?.universeSnapshotRecorded).toBe(false);
      expect(result?.counterfactualRecorded).toBe(false);
      expect(result?.candidateSummaryCount).toBe(1);
    });

    it('does not increase external API call count — counterfactual snapshot 외 추가 호출 0', async () => {
      await recordPreflightBlockedScan(
        { stage: 'AFTER_UNIVERSE_BUILD', primaryReason: 'VIX_BLOCK', watchlist: [] },
        { blockedBy: 'PRE_FLIGHT_BLOCK', preflightDecision: 'ABORT_VIX_BLOCK' },
      );
      // recordCounterfactualUniverseLearningSnapshot 만 호출 — shadow scan 등 신규 외부 경로 0건.
      expect(mockedRecordCounterfactualUniverseLearningSnapshot).toHaveBeenCalledTimes(1);
      expect(mockedRunShadowLearningOnlyScan).not.toHaveBeenCalled();
    });
  });
});
