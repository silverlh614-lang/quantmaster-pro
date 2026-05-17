// @responsibility Normal supply preview field-availability diagnostic aggregation.
import {
  formatList,
  formatReasonDistribution,
} from './formatters.js';
import type {
  ProgramFlowDiagnostic,
  ProgramFlowEvidenceTrace,
} from './programFlowTypes.js';
import type {
  NormalSupplyFieldAvailability,
  NormalSupplyPreviewCandidate,
} from './types.js';

const PROGRAM_FLOW_NOT_AVAILABLE_MARKET: ProgramFlowDiagnostic['marketLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};

export function buildNormalSupplyFieldAvailability(
  candidates: NormalSupplyPreviewCandidate[],
  evidenceTrace?: ProgramFlowEvidenceTrace,
): NormalSupplyFieldAvailability {
  const marketProgram = candidates.find((candidate) => candidate.programFlow?.marketLevel)?.programFlow?.marketLevel
    ?? PROGRAM_FLOW_NOT_AVAILABLE_MARKET;
  const stockProgramAvailable = candidates.filter((candidate) => candidate.programFlow?.stockLevel.available).length;
  return {
    total: candidates.length,
    foreignNetBuyField: candidates.filter((candidate) => candidate.foreignNetBuyAmount !== undefined).length,
    institutionNetBuyField: candidates.filter((candidate) => candidate.institutionNetBuyAmount !== undefined).length,
    programNetBuyField: stockProgramAvailable,
    stockProgramNetBuyField: candidates.filter((candidate) => candidate.programFlow?.stockLevel.netBuy !== undefined).length,
    stockProgramAvailable,
    stockProgramRowsAvailable: stockProgramAvailable,
    stockProgramRowsWithAnyProgramKey: evidenceTrace?.stockLevel.candidateRowsWithAnyProgramKey ?? stockProgramAvailable,
    stockProgramRowsWithNumericProgramValue: evidenceTrace?.stockLevel.candidateRowsWithNumericProgramValue ?? stockProgramAvailable,
    stockProgramRowsWithParsableProgramValue: evidenceTrace?.stockLevel.candidateRowsWithParsableProgramValue ?? stockProgramAvailable,
    stockProgramValueReasonDistribution: evidenceTrace?.stockLevel.valueReasonDistribution ?? {},
    stockProgramValueReasonTop: evidenceTrace ? formatReasonDistribution(evidenceTrace.stockLevel.valueReasonDistribution) : 'none',
    stockProgramSanitizedSampleTop: evidenceTrace?.stockLevel.sanitizedSampleTop ?? [],
    stockProgramFieldKeysTop: evidenceTrace ? formatList(evidenceTrace.stockLevel.candidateFieldsFound) : 'none',
    stockProgramBreakPoint: evidenceTrace?.stockLevel.breakPoint ?? 'UNKNOWN',
    marketProgramAvailable: marketProgram.available,
    marketProgramSignal: marketProgram.signal,
    marketProgramSource: marketProgram.sourceProvider ?? 'NONE',
    marketProgramContextFound: evidenceTrace
      ? (
          evidenceTrace.marketLevel.fieldsFound.length > 0
          || evidenceTrace.marketLevel.programTradingContextFound
          || evidenceTrace.marketLevel.programMarketRouterResultFound
          || evidenceTrace.marketLevel.programTodayContextFound
          || evidenceTrace.marketLevel.cacheContextFound
          || evidenceTrace.marketLevel.snapshotContextFound
        )
      : false,
    marketProgramBreakPoint: evidenceTrace?.marketLevel.breakPoint ?? 'UNKNOWN',
    marketProgramParsableFieldsFound: evidenceTrace?.marketLevel.parsableFieldsFound ?? [],
    marketProgramValueReasonTop: evidenceTrace ? formatReasonDistribution(evidenceTrace.marketLevel.valueReasonDistribution) : 'none',
    marketProgramSanitizedSample: evidenceTrace?.marketLevel.sanitizedSample,
    missingProgramFlowAsBearish: false,
    marketProgramProviderIssue: marketProgram.providerIssue,
    marketProgramMarketSignal: marketProgram.marketSignal,
    programPenaltyApplied: false,
    programFlowUsedForLiveDecision: false,
    passiveProxyUsedForLiveDecision: false,
    providerCallsAdded: 0,
    executionImpact: 'NONE',
    semanticRowAvailable: candidates.filter((candidate) => candidate.semanticRowAvailable).length,
    rawInvestorRowAvailable: candidates.filter((candidate) => candidate.rawInvestorRowAvailable).length,
    selectedCandidateCarriesSemanticRow: candidates.filter((candidate) => candidate.selectedCandidateCarriesSemanticRow).length,
    selectedCandidateCarriesActualRow: candidates.filter((candidate) => candidate.selectedCandidateCarriesActualRow).length,
  };
}
