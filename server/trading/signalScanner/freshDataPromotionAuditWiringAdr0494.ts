// @responsibility ADR-0494 Fresh Data promotion audit wiring; diagnostic-only bridge into ADR-0493, no stage/live mutations.
import type {
  DataLineStage,
  DataPromotionAuditInput,
  DataPromotionAuditResult,
  DataPromotionSourceType,
} from '../../../src/types/dataPromotion.types.js';
import { evaluatePromotionReadiness, type EvaluatePromotionReadinessOptions } from '../../../src/data-line/promotion/dataPromotionAudit.js';
import type { SectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import type { InvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import type { ProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';
import type { SupplySnapshotReplayResultAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import type { FreshDataSchedulerResultAdr0492 } from './freshDataSchedulerAdr0492.js';

export type FreshDataPromotionAuditSourceTypeAdr0494 =
  | 'SECTOR_ENERGY'
  | 'INVESTOR_FLOW'
  | 'PROGRAM_TRADING'
  | 'SUPPLY_SNAPSHOT'
  | 'FRESH_DATA_SCHEDULER';

export type FreshDataPromotionAuditReportAdr0494 =
  | SectorEnergyAndSupplyUnknownPolicyReportAdr0488
  | InvestorFlowSampleAcquisitionReportAdr0489
  | ProgramTradingDataLineReportAdr0490
  | SupplySnapshotReplayResultAdr0491
  | FreshDataSchedulerResultAdr0492;

export interface BuildPromotionAuditInputForDataLineOptionsAdr0494 {
  sourceType: FreshDataPromotionAuditSourceTypeAdr0494;
  report: FreshDataPromotionAuditReportAdr0494;
  dataLineId?: string;
  dataLineName?: string;
  currentStage?: DataLineStage;
  requestedNextStage?: DataLineStage;
  tradingDaysObserved?: number;
  liveRegressionPassed?: boolean;
  nullZeroSeparationPassed?: boolean;
  holidayFreshnessPassed?: boolean;
  testCoveragePassed?: boolean;
  shadowContributionScore?: number | null;
}

export interface FreshDataPromotionAuditEvaluationAdr0494 {
  input: DataPromotionAuditInput;
  result: DataPromotionAuditResult;
  executionImpact: 'NONE';
}

export interface FreshDataPromotionAuditSummaryAdr0494 {
  generatedAt: string;
  audits: FreshDataPromotionAuditEvaluationAdr0494[];
  promotionAuditSummary: string;
  promotionAuditBlockers: string[];
  promotionAuditReadyLines: string[];
  promotionAuditBlockedLines: string[];
  executionImpact: 'NONE';
}

type EvaluatorAdr0494 = (input: DataPromotionAuditInput, options?: EvaluatePromotionReadinessOptions) => DataPromotionAuditResult;

function countTradingDays(defaultValue: number, override: number | undefined): number {
  return Number.isFinite(override) && override !== undefined ? Math.max(0, override) : defaultValue;
}

function finiteCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sourceTypeForAdr0493(sourceType: FreshDataPromotionAuditSourceTypeAdr0494): DataPromotionSourceType {
  return sourceType;
}

function defaultStages(sourceType: FreshDataPromotionAuditSourceTypeAdr0494): { currentStage: DataLineStage; requestedNextStage: DataLineStage } {
  if (sourceType === 'SECTOR_ENERGY') return { currentStage: 'SHADOW_SCORE', requestedNextStage: 'ADVISORY' };
  if (sourceType === 'SUPPLY_SNAPSHOT' || sourceType === 'FRESH_DATA_SCHEDULER') return { currentStage: 'SHADOW_RAW', requestedNextStage: 'SHADOW_SCORE' };
  return { currentStage: 'OBSERVE', requestedNextStage: 'SHADOW_RAW' };
}

function withCommonFields(args: {
  sourceType: FreshDataPromotionAuditSourceTypeAdr0494;
  dataLineId: string;
  dataLineName: string;
  currentStage: DataLineStage;
  requestedNextStage: DataLineStage;
  tradingDaysObserved: number;
  totalSnapshots: number;
  missingSnapshotCount: number;
  staleSnapshotCount: number;
  staleMisclassificationCount?: number;
  providerFailureCount: number;
  providerMarketSignalMixedCount?: number;
  shadowContributionScore?: number | null;
  liveRegressionPassed?: boolean;
  nullZeroSeparationPassed?: boolean;
  holidayFreshnessPassed?: boolean;
  testCoveragePassed?: boolean;
  snapshotRecordable?: boolean;
  providerHealthFieldPresent?: boolean;
  freshnessFieldPresent?: boolean;
}): DataPromotionAuditInput {
  return {
    dataLineId: args.dataLineId,
    dataLineName: args.dataLineName,
    sourceType: sourceTypeForAdr0493(args.sourceType),
    currentStage: args.currentStage,
    requestedNextStage: args.requestedNextStage,
    tradingDaysObserved: args.tradingDaysObserved,
    totalSnapshots: args.totalSnapshots,
    missingSnapshotCount: args.missingSnapshotCount,
    staleSnapshotCount: args.staleSnapshotCount,
    staleMisclassificationCount: args.staleMisclassificationCount ?? 0,
    providerFailureCount: args.providerFailureCount,
    providerMarketSignalMixedCount: args.providerMarketSignalMixedCount ?? 0,
    shadowContributionScore: args.shadowContributionScore ?? null,
    liveRegressionPassed: args.liveRegressionPassed ?? true,
    nullZeroSeparationPassed: args.nullZeroSeparationPassed ?? true,
    holidayFreshnessPassed: args.holidayFreshnessPassed ?? true,
    executionImpactNonePassed: true,
    testCoveragePassed: args.testCoveragePassed ?? true,
    latestExecutionImpact: 'NONE',
    providerHealthFieldPresent: args.providerHealthFieldPresent ?? true,
    freshnessFieldPresent: args.freshnessFieldPresent ?? true,
    snapshotRecordable: args.snapshotRecordable,
  };
}

function sectorEnergyInput(report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488, options: BuildPromotionAuditInputForDataLineOptionsAdr0494): DataPromotionAuditInput {
  const stages = defaultStages(options.sourceType);
  const master = report.sectorEnergyMaster;
  const providerMarketSignalMixed = report.supplyUnknownPolicy.providerIssue && report.supplyUnknownPolicy.marketSignal ? 1 : 0;
  return withCommonFields({
    sourceType: 'SECTOR_ENERGY',
    dataLineId: options.dataLineId ?? 'sectorEnergy',
    dataLineName: options.dataLineName ?? 'Sector Energy Master Supply Line',
    currentStage: options.currentStage ?? stages.currentStage,
    requestedNextStage: options.requestedNextStage ?? stages.requestedNextStage,
    tradingDaysObserved: countTradingDays(master.records.length > 0 ? 1 : 0, options.tradingDaysObserved),
    totalSnapshots: master.records.length,
    missingSnapshotCount: finiteCount(master.missing),
    staleSnapshotCount: finiteCount(master.stale),
    staleMisclassificationCount: 0,
    providerFailureCount: finiteCount(master.providerError),
    providerMarketSignalMixedCount: providerMarketSignalMixed,
    shadowContributionScore: options.shadowContributionScore ?? (master.leadershipConfidence === 'OBSERVE_READY' ? master.coveragePct : null),
    liveRegressionPassed: options.liveRegressionPassed,
    nullZeroSeparationPassed: options.nullZeroSeparationPassed,
    holidayFreshnessPassed: options.holidayFreshnessPassed,
    testCoveragePassed: options.testCoveragePassed,
    snapshotRecordable: master.records.length > 0,
  });
}

function investorFlowInput(report: InvestorFlowSampleAcquisitionReportAdr0489, options: BuildPromotionAuditInputForDataLineOptionsAdr0494): DataPromotionAuditInput {
  const stages = defaultStages(options.sourceType);
  return withCommonFields({
    sourceType: 'INVESTOR_FLOW',
    dataLineId: options.dataLineId ?? 'investorFlow',
    dataLineName: options.dataLineName ?? 'Investor Flow Sample Probe',
    currentStage: options.currentStage ?? stages.currentStage,
    requestedNextStage: options.requestedNextStage ?? stages.requestedNextStage,
    tradingDaysObserved: countTradingDays(report.samples.length > 0 ? 1 : 0, options.tradingDaysObserved),
    totalSnapshots: report.samples.length,
    missingSnapshotCount: report.samples.filter((sample) => sample.status === 'DATA_UNAVAILABLE' || sample.status === 'EMPTY').length,
    staleSnapshotCount: 0,
    providerFailureCount: report.status === 'PROVIDER_ERROR' ? 1 : 0,
    shadowContributionScore: options.shadowContributionScore ?? null,
    liveRegressionPassed: options.liveRegressionPassed,
    nullZeroSeparationPassed: options.nullZeroSeparationPassed,
    holidayFreshnessPassed: options.holidayFreshnessPassed,
    testCoveragePassed: options.testCoveragePassed,
    snapshotRecordable: report.samples.length > 0,
  });
}

function programTradingInput(report: ProgramTradingDataLineReportAdr0490, options: BuildPromotionAuditInputForDataLineOptionsAdr0494): DataPromotionAuditInput {
  const stages = defaultStages(options.sourceType);
  return withCommonFields({
    sourceType: 'PROGRAM_TRADING',
    dataLineId: options.dataLineId ?? 'programTrading',
    dataLineName: options.dataLineName ?? 'Program Trading Data Line',
    currentStage: options.currentStage ?? stages.currentStage,
    requestedNextStage: options.requestedNextStage ?? stages.requestedNextStage,
    tradingDaysObserved: countTradingDays(report.rows.length > 0 ? 1 : 0, options.tradingDaysObserved),
    totalSnapshots: report.rows.length,
    missingSnapshotCount: report.rows.filter((row) => row.status === 'DATA_UNAVAILABLE' || row.status === 'EMPTY').length,
    staleSnapshotCount: 0,
    providerFailureCount: report.status === 'PROVIDER_ERROR' ? 1 : 0,
    shadowContributionScore: options.shadowContributionScore ?? null,
    liveRegressionPassed: options.liveRegressionPassed,
    nullZeroSeparationPassed: options.nullZeroSeparationPassed,
    holidayFreshnessPassed: options.holidayFreshnessPassed,
    testCoveragePassed: options.testCoveragePassed,
    snapshotRecordable: report.rows.length > 0,
  });
}

function supplySnapshotInput(report: SupplySnapshotReplayResultAdr0491, options: BuildPromotionAuditInputForDataLineOptionsAdr0494): DataPromotionAuditInput {
  const stages = defaultStages(options.sourceType);
  const latest = report.snapshots[0];
  const total = report.retained > 0 ? report.retained : report.snapshots.length;
  return withCommonFields({
    sourceType: 'SUPPLY_SNAPSHOT',
    dataLineId: options.dataLineId ?? 'supplySnapshot',
    dataLineName: options.dataLineName ?? 'Supply Snapshot Store Replay',
    currentStage: options.currentStage ?? stages.currentStage,
    requestedNextStage: options.requestedNextStage ?? stages.requestedNextStage,
    tradingDaysObserved: countTradingDays(total, options.tradingDaysObserved),
    totalSnapshots: total,
    missingSnapshotCount: report.replayAvailable ? 0 : Math.max(1, total),
    staleSnapshotCount: report.status === 'REPLAY_UNAVAILABLE' ? Math.max(1, total) : 0,
    providerFailureCount: latest?.providerIssue ? 1 : 0,
    providerMarketSignalMixedCount: latest?.providerIssue && latest.marketSignal ? 1 : 0,
    shadowContributionScore: options.shadowContributionScore ?? (report.replayAvailable ? total : null),
    liveRegressionPassed: options.liveRegressionPassed,
    nullZeroSeparationPassed: options.nullZeroSeparationPassed,
    holidayFreshnessPassed: options.holidayFreshnessPassed,
    testCoveragePassed: options.testCoveragePassed,
    snapshotRecordable: report.replayAvailable,
  });
}

function schedulerInput(report: FreshDataSchedulerResultAdr0492, options: BuildPromotionAuditInputForDataLineOptionsAdr0494): DataPromotionAuditInput {
  const stages = defaultStages(options.sourceType);
  const providerFailures = Object.values(report.providerHealthSummary).filter((health) => health === 'DOWN' || health === 'RATE_LIMITED').length;
  return withCommonFields({
    sourceType: 'FRESH_DATA_SCHEDULER',
    dataLineId: options.dataLineId ?? 'freshDataScheduler',
    dataLineName: options.dataLineName ?? 'Fresh Data Scheduler',
    currentStage: options.currentStage ?? stages.currentStage,
    requestedNextStage: options.requestedNextStage ?? stages.requestedNextStage,
    tradingDaysObserved: countTradingDays(report.snapshotCount > 0 ? 1 : 0, options.tradingDaysObserved),
    totalSnapshots: report.snapshotCount,
    missingSnapshotCount: report.freshness === 'MISSING' || report.freshness === 'UNKNOWN' ? Math.max(1, report.snapshotCount) : 0,
    staleSnapshotCount: report.freshness === 'STALE' ? Math.max(1, report.snapshotCount) : 0,
    providerFailureCount: providerFailures,
    providerMarketSignalMixedCount: 0,
    shadowContributionScore: options.shadowContributionScore ?? (report.status === 'SUCCESS' ? report.snapshotCount : null),
    liveRegressionPassed: options.liveRegressionPassed,
    nullZeroSeparationPassed: options.nullZeroSeparationPassed,
    holidayFreshnessPassed: options.holidayFreshnessPassed ?? report.freshness === 'HOLIDAY_VALID',
    testCoveragePassed: options.testCoveragePassed,
    snapshotRecordable: report.snapshotCount > 0,
  });
}

export function buildPromotionAuditInputForDataLineAdr0494(
  options: BuildPromotionAuditInputForDataLineOptionsAdr0494,
): DataPromotionAuditInput {
  if (options.sourceType === 'SECTOR_ENERGY') return sectorEnergyInput(options.report as SectorEnergyAndSupplyUnknownPolicyReportAdr0488, options);
  if (options.sourceType === 'INVESTOR_FLOW') return investorFlowInput(options.report as InvestorFlowSampleAcquisitionReportAdr0489, options);
  if (options.sourceType === 'PROGRAM_TRADING') return programTradingInput(options.report as ProgramTradingDataLineReportAdr0490, options);
  if (options.sourceType === 'SUPPLY_SNAPSHOT') return supplySnapshotInput(options.report as SupplySnapshotReplayResultAdr0491, options);
  return schedulerInput(options.report as FreshDataSchedulerResultAdr0492, options);
}

export function evaluateFreshDataPromotionAuditsAdr0494(
  inputs: readonly DataPromotionAuditInput[],
  options: EvaluatePromotionReadinessOptions & { evaluator?: EvaluatorAdr0494 } = {},
): FreshDataPromotionAuditEvaluationAdr0494[] {
  const { evaluator = evaluatePromotionReadiness, ...auditOptions } = options;
  return inputs.map((input) => {
    const result = evaluator({ ...input, executionImpactNonePassed: true, latestExecutionImpact: 'NONE' }, auditOptions);
    return {
      input,
      result: { ...result, executionImpact: 'NONE', recommendedStage: result.canPromote ? input.requestedNextStage : input.currentStage },
      executionImpact: 'NONE',
    };
  });
}

export function formatPromotionAuditCompactAdr0494(audit: FreshDataPromotionAuditEvaluationAdr0494 | DataPromotionAuditResult): string {
  const result = 'result' in audit ? audit.result : audit;
  const sourceType = 'input' in audit ? audit.input.sourceType : 'UNKNOWN';
  const blocks = result.blockReasons.length > 0 ? result.blockReasons.join(',') : 'none';
  return `PROMO_AUDIT ${result.dataLineId} source=${sourceType} stage=${result.currentStage}→${result.requestedNextStage} decision=${result.decision} score=${result.score}/${result.requiredScore} blocks=${blocks} impact=${result.executionImpact}`;
}

export function formatPromotionAuditDetailAdr0494(audit: FreshDataPromotionAuditEvaluationAdr0494 | DataPromotionAuditResult): string {
  const result = 'result' in audit ? audit.result : audit;
  const sourceType = 'input' in audit ? audit.input.sourceType : 'UNKNOWN';
  return [
    `dataLineId=${result.dataLineId}`,
    `sourceType=${sourceType}`,
    `currentStage=${result.currentStage}`,
    `requestedNextStage=${result.requestedNextStage}`,
    `canPromote=${result.canPromote}`,
    `score=${result.score}`,
    `requiredScore=${result.requiredScore}`,
    `blockReasons=${result.blockReasons.join(',') || 'none'}`,
    `warnings=${result.warnings.join(' | ') || 'none'}`,
    `executionImpact=${result.executionImpact}`,
  ].join('\n');
}

export function summarizeFreshDataPromotionAuditsAdr0494(
  audits: readonly FreshDataPromotionAuditEvaluationAdr0494[],
  generatedAt = new Date().toISOString(),
): FreshDataPromotionAuditSummaryAdr0494 {
  const ready = audits.filter((audit) => audit.result.canPromote).map((audit) => audit.result.dataLineId);
  const blocked = audits.filter((audit) => !audit.result.canPromote).map((audit) => audit.result.dataLineId);
  const blockers = audits.flatMap((audit) => audit.result.blockReasons.map((reason) => `${audit.result.dataLineId}:${reason}`));
  return {
    generatedAt,
    audits: audits.map((audit) => ({ ...audit, executionImpact: 'NONE', result: { ...audit.result, executionImpact: 'NONE' } })),
    promotionAuditSummary: `ADR-0494 promotionAudits=${audits.length} ready=${ready.length} blocked=${blocked.length} impact=NONE`,
    promotionAuditBlockers: blockers,
    promotionAuditReadyLines: ready,
    promotionAuditBlockedLines: blocked,
    executionImpact: 'NONE',
  };
}
