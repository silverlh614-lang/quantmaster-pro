// @responsibility Diagnostic isolation policy. Keeps P3/P4 telemetry away from execution confidence.

import type { ExecutionImpact } from '../runtime/engineRuntimePolicy.js';

type DiagnosticPhase =
  | 'P0_EXECUTION'
  | 'P1_HYDRATION'
  | 'P2_DECISION'
  | 'P3_SCAN_DIAGNOSTIC'
  | 'P4_TELEMETRY_VERBOSE';

export interface DiagnosticIsolationInput {
  phase: DiagnosticPhase;
  budgetExceeded?: boolean;
  coreDataMissing?: boolean;
  reasonCode?: string;
}

export interface DiagnosticIsolationResult {
  phase: DiagnosticPhase;
  diagnosticSuppressed: boolean;
  blocking: boolean;
  dataVacuum: boolean;
  executionImpact: ExecutionImpact;
  reasonCode: string;
}

const NON_BLOCKING_DIAGNOSTIC_PHASES: ReadonlySet<DiagnosticPhase> = new Set([
  'P3_SCAN_DIAGNOSTIC',
  'P4_TELEMETRY_VERBOSE',
]);

export function classifyDiagnosticIsolation(input: DiagnosticIsolationInput): DiagnosticIsolationResult {
  if (NON_BLOCKING_DIAGNOSTIC_PHASES.has(input.phase)) {
    return {
      phase: input.phase,
      diagnosticSuppressed: input.budgetExceeded === true,
      blocking: false,
      dataVacuum: false,
      executionImpact: 'NONE',
      reasonCode: input.reasonCode ?? (input.budgetExceeded ? 'DIAGNOSTIC_BUDGET_EXCEEDED' : 'DIAGNOSTIC_ONLY'),
    };
  }

  const dataVacuum = input.coreDataMissing === true;
  return {
    phase: input.phase,
    diagnosticSuppressed: false,
    blocking: dataVacuum,
    dataVacuum,
    executionImpact: dataVacuum ? 'LIVE_ORDER_BLOCKED' : 'NONE',
    reasonCode: input.reasonCode ?? (dataVacuum ? 'CORE_DATA_VACUUM' : 'CORE_DATA_AVAILABLE'),
  };
}
