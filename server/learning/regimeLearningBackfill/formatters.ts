// @responsibility Telegram HTML formatters for regime learning backfill diagnostic results.
import type {
  RegimeLearningBackfillDryRunResult,
  RegimeLearningBackfillRunResult,
  RegimeUnknownAnalysisResult,
  RegimeUnknownRepairResult,
} from './types.js';

export function formatRegimeLearningBackfillDryRun(s: RegimeLearningBackfillDryRunResult): string {
  return [
    '<b>[Regime Learning Backfill Dryrun]</b>',
    `scannedTotal=${s.scannedTotal} missingRegimePhase=${s.missingRegimePhase}`,
    `recoverableByStoredSnapshot=${s.recoverableByStoredSnapshot} recoverableByTimestampMacroState=${s.recoverableByTimestampMacroState} recoverableByRegimeTransitionState=${s.recoverableByRegimeTransitionState} recoverableByCurrentRegimeFallback=${s.recoverableByCurrentRegimeFallback} recoverableByR6Trigger=${s.recoverableByR6Trigger}`,
    `unrecoverable=${s.unrecoverable} expectedByRegime=${JSON.stringify(s.expectedByRegime)} expectedUnknown=${s.expectedUnknown}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated}`,
  ].join('\n');
}

export function formatRegimeLearningBackfillRun(s: RegimeLearningBackfillRunResult): string {
  return [
    '<b>[Regime Learning Backfill Run]</b>',
    `scannedTotal=${s.scannedTotal} updated=${s.updated} missingRegimePhase=${s.missingRegimePhase}`,
    `byRegime=${JSON.stringify(s.byRegime)} unknownCount=${s.unknownCount}`,
    `recoverySourceBreakdown=${JSON.stringify(s.recoverySourceBreakdown)}`,
    `recoveryConfidenceBreakdown=${JSON.stringify(s.recoveryConfidenceBreakdown)}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}

export function formatRegimeUnknownAnalysis(s: RegimeUnknownAnalysisResult): string {
  return [
    '<b>[Regime UNKNOWN Analysis]</b>',
    `unknownTotal=${s.unknownTotal}`,
    `unknownBySource=${JSON.stringify(s.unknownBySource)}`,
    `unknownByCaseType=${JSON.stringify(s.unknownByCaseType)}`,
    `unknownByDate=${JSON.stringify(s.unknownByDate)}`,
    `unknownReasonBreakdown=${JSON.stringify(s.unknownReasonBreakdown)}`,
    `missingTimestampCount=${s.missingTimestampCount} missingMacroSnapshotCount=${s.missingMacroSnapshotCount} missingTransitionStateCount=${s.missingTransitionStateCount}`,
    `recoverableByNearestSnapshot=${s.recoverableByNearestSnapshot} recoverableByTradingDayRegime=${s.recoverableByTradingDayRegime} recoverableByR6Trigger=${s.recoverableByR6Trigger} unrecoverableCount=${s.unrecoverableCount}`,
    `recommendedFix=${s.recommendedFix}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}

export function formatRegimeUnknownRepair(s: RegimeUnknownRepairResult, mode: 'dryrun' | 'run'): string {
  return [
    `<b>[Regime UNKNOWN Repair ${mode}]</b>`,
    `scannedUnknown=${s.scannedUnknown} attemptedUnique=${s.attemptedUnique} attemptedDuplicates=${s.attemptedDuplicates} repaired=${s.repaired} stillUnknown=${s.stillUnknown}`,
    `byRecoveredRegime=${JSON.stringify(s.byRecoveredRegime)}`,
    `recoverySourceBreakdown=${JSON.stringify(s.recoverySourceBreakdown)}`,
    `recoveryConfidenceBreakdown=${JSON.stringify(s.recoveryConfidenceBreakdown)}`,
    `recoveredBySource=${JSON.stringify(s.recoveredBySource)}`,
    `recoveredByConfidence=${JSON.stringify(s.recoveredByConfidence)}`,
    `failedAfterDailyFallback=${s.failedAfterDailyFallback}`,
    `failureReasonBreakdownAfterDailyFallback=${JSON.stringify(s.failureReasonBreakdownAfterDailyFallback)}`,
    `failureReasonBreakdown=${JSON.stringify(s.failureReasonBreakdown)}`,
    `failureBySourceLane=${JSON.stringify(s.failureBySourceLane)}`,
    `failureByTimestampSource=${JSON.stringify(s.failureByTimestampSource)}`,
    `failureByTradingDate=${JSON.stringify(s.failureByTradingDate)}`,
    `snapshotCoverageByTradingDate=${JSON.stringify(s.snapshotCoverageByTradingDate)}`,
    `missingRegimeSnapshotDates=${JSON.stringify(s.missingRegimeSnapshotDates)}`,
    `dailyRegimeFallbackStatus=${s.dailyRegimeFallbackStatus}`,
    `snapshotReconstructionAttemptedDates=${JSON.stringify(s.snapshotReconstructionAttemptedDates)}`,
    `snapshotReconstructionSucceededDates=${JSON.stringify(s.snapshotReconstructionSucceededDates)}`,
    `snapshotReconstructionFailedDates=${JSON.stringify(s.snapshotReconstructionFailedDates)}`,
    `snapshotReconstructionSourceBreakdown=${JSON.stringify(s.snapshotReconstructionSourceBreakdown)}`,
    `snapshotReconstructionConfidenceBreakdown=${JSON.stringify(s.snapshotReconstructionConfidenceBreakdown)}`,
    `sourceInventoryByDate=${JSON.stringify(s.sourceInventoryByDate)}`,
    `sourceInventoryTopAvailable=${JSON.stringify(s.sourceInventoryTopAvailable)}`,
    `sourceInventoryMissingSources=${JSON.stringify(s.sourceInventoryMissingSources)}`,
    `sourceInventoryAuditStatus=${s.sourceInventoryAuditStatus}`,
    `snapshotReconstructionPriorityDate=${s.snapshotReconstructionPriorityDate}`,
    `priorityDateReconstructionStatus=${s.priorityDateReconstructionStatus}`,
    `priorityDateRecoveredSampleCount=${s.priorityDateRecoveredSampleCount}`,
    `priorityDateFailureReason=${s.priorityDateFailureReason}`,
    `telegramArchiveCountByDate=${JSON.stringify(s.telegramArchiveCountByDate)}`,
    `telegramArchiveRegimePatternMatchedByDate=${JSON.stringify(s.telegramArchiveRegimePatternMatchedByDate)}`,
    `telegramArchiveEffectiveRegimeExtractedByDate=${JSON.stringify(s.telegramArchiveEffectiveRegimeExtractedByDate)}`,
    `telegramArchiveRejectedNoRegimeByDate=${JSON.stringify(s.telegramArchiveRejectedNoRegimeByDate)}`,
    `telegramArchiveParseFailureTopReasons=${JSON.stringify(s.telegramArchiveParseFailureTopReasons)}`,
    `priorityDateTelegramArchiveCount=${s.priorityDateTelegramArchiveCount}`,
    `priorityDateRegimePatternMatched=${s.priorityDateRegimePatternMatched}`,
    `priorityDateEffectiveRegimeExtracted=${s.priorityDateEffectiveRegimeExtracted}`,
    `priorityDateTelegramParseFailureReason=${s.priorityDateTelegramParseFailureReason}`,
    `failureSampleKeys=${JSON.stringify(s.failureSampleKeys)}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}
