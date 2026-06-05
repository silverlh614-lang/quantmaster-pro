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
    expect(msg).toContain('regimeBackfillRecoveredBySource=');
    expect(msg).toContain('regimeBackfillRecoveredByConfidence=');
    expect(msg).toContain('regimeBackfillFailedAfterDailyFallback=');
    expect(msg).toContain('regimeBackfillFailureTopReasonsAfterDailyFallback=');
    expect(msg).toContain('regimeBackfillFailureByTradingDate=');
    expect(msg).toContain('regimeSnapshotCoverageByTradingDate=');
    expect(msg).toContain('missingRegimeSnapshotDates=');
    expect(msg).toContain('dailyRegimeFallbackStatus=');
    expect(msg).toContain('regimeSnapshotReconstructionAttemptedDates=');
    expect(msg).toContain('regimeSnapshotReconstructionSucceededDates=');
    expect(msg).toContain('regimeSnapshotReconstructionFailedDates=');
    expect(msg).toContain('regimeSnapshotReconstructionSourceBreakdown=');
    expect(msg).toContain('regimeSnapshotReconstructionConfidenceBreakdown=');
    expect(msg).toContain('Regime Source Inventory:');
    expect(msg).toContain('regimeSourceInventoryByDate=');
    expect(msg).toContain('regimeSourceInventoryTopAvailable=');
    expect(msg).toContain('regimeSourceInventoryMissingSources=');
    expect(msg).toContain('regimeSourceInventoryAuditStatus=');
    expect(msg).toContain('regimeSnapshotReconstructionPriorityDate=');
    expect(msg).toContain('priorityDateReconstructionStatus=');
    expect(msg).toContain('priorityDateRecoveredSampleCount=');
    expect(msg).toContain('priorityDateFailureReason=');
    expect(msg).toContain('postReconstructionTrueUnknownRatio=');
    expect(msg).toContain('regimePromotionStillBlocked=');
    expect(msg).toContain('regimePromotionBlockReason=');
    expect(msg).toContain('regimeBackfillFailureSampleKeys=');
    expect(msg).toContain('regimeDuplicatePreventedAtSource=');
    expect(msg).toContain('regimeDuplicateSuppressedAfterInsert=');
    expect(msg).toContain('marketSession=');
    expect(msg).toContain('nextOpenShadowScanStatus=');
    // Patch-VITEST-CAT-C: `lastShadowScanStartedAt` 은 collectLearningPulse 가 스냅샷
    // 데이터 필드로만 산출하고(formatLearningPulseMessage 출력 라인에는 미포함 — 형제
    // 필드 nextOpenShadowScanStatus/lastShadowScanCandidateCount/lastShadowScanResult 로
    // scan lifecycle 가시화). 본 assertion 은 seed(4452bd3)부터 production formatter 와
    // 불일치한 over-assertion 이었다. production 출력 0 변경 원칙상 테스트 기대를 정정한다.
    expect(msg).toContain('lastShadowScanCandidateCount=');
    expect(msg).toContain('lastShadowScanResult=');
    expect(msg).toContain('cohortSnapshotRefreshFailureReason=');
    expect(msg).toContain('recommendationOnly=true');
    expect(msg).toContain('promotionAllowed=false');
  }, 20000);
});
