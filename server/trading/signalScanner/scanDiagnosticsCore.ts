/**
 * @responsibility Legacy scan diagnostics facade re-exporting split ADR-0001 modules.
 */

export { formatGateEligibilitySplitSection } from './gateEligibilitySection.js';
export * from './scanDiagnostics/investorFlowAdapters.js';
export * from './scanDiagnostics/scanBlockersFormatter.js';
export * from './scanDiagnostics/adrDiagnosticLogger.js';
export * from './scanDiagnostics/investorFlowRouterEmitter.js';
export * from './scanDiagnostics/persistScanResults.js';
export * from './scanDiagnostics/sectionFormatters.js';
