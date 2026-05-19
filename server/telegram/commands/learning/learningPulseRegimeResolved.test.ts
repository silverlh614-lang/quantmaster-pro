import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Learning Pulse regime resolved-sample fields', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-regime-resolved-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('prints R2/R3/R6 resolved sample sizes and active regime reliability fields', async () => {
    const { collectLearningPulse, formatLearningPulseMessage } = await import('./learningPulse.cmd.js');
    const msg = formatLearningPulseMessage(collectLearningPulse(new Date('2026-04-30T06:00:00Z')));

    expect(msg).toContain('Regime Learning v6');
    expect(msg).toContain('activeRegimeResolvedSampleSize=');
    expect(msg).toContain('activeRegimePendingCounterfactualCount=');
    expect(msg).toContain('activeRegimeAttributableSampleSize=');
    expect(msg).toContain('activeRegimeWhyNotReliable=');
    expect(msg).toContain('R2ResolvedSampleSize=');
    expect(msg).toContain('R2PendingCounterfactual=');
    expect(msg).toContain('R3ResolvedSampleSize=');
    expect(msg).toContain('R3PendingCounterfactual=');
    expect(msg).toContain('R6ResolvedSampleSize=');
    expect(msg).toContain('R6PendingCounterfactual=');
    expect(msg).toContain('Fresh Shadow Zero Detail:');
    expect(msg).toContain('noFreshReason=');
    expect(msg).toContain('shadowLearningLane=');
    expect(msg).toContain('R6ResolvedSampleGate=');
    expect(msg).toContain('R6PromotionBlocker=');
    expect(msg).toContain('nextRegimeMaturityAt=');
    expect(msg).toContain('regimesNeedingAttributionRecalc=');
    expect(msg).toContain('regimeLearningNextAction=');
    expect(msg).toContain('unknownRatioRaw=');
    expect(msg).toContain('recoveredLowConfidenceRegimeRatio=');
    expect(msg).toContain('trueUnknownRatio=');
    expect(msg).toContain('regimeRatioDenominator=regimeLearningSampleSize');
    expect(msg).toContain('regimeBackfillTargetUnknownCount=');
    expect(msg).toContain('regimeBackfillAttemptedTotal=');
    expect(msg).toContain('regimeBackfillAttemptedUnique=');
    expect(msg).toContain('regimeBackfillAttemptedDuplicates=');
    expect(msg).toContain('regimeBackfillFailureBySourceLane=');
    expect(msg).toContain('regimeBackfillFailureByTimestampSource=');
    expect(msg).toContain('regimeBackfillFailureSampleKeys=');
    expect(msg).toContain('regimeDuplicatePreventedAtSource=');
    expect(msg).toContain('regimeDuplicateSuppressedAfterInsert=');
    expect(msg).toContain('nextOpenShadowScanStatus=');
    expect(msg).toContain('lastShadowScanStartedAt=');
    expect(msg).toContain('lastShadowScanCandidateCount=');
    expect(msg).toContain('lastShadowScanResult=');
    expect(msg).toContain('cohortSnapshotRefreshFailureReason=');
    expect(msg).toContain('recommendationOnly=true');
    expect(msg).toContain('promotionAllowed=false');
  }, 20000);
});
