// @responsibility User-facing entry policy semantics for macro regime, execution mode, market session, and gate revalidation.

export type MacroRegime =
  | 'R1_RISK_ON'
  | 'R2_NEUTRAL'
  | 'R3_CAUTION'
  | 'R4_RISK_OFF'
  | 'R5_CRISIS'
  | 'R6_DEFENSE';

export type ExecutionMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type MarketSessionState =
  | 'OPEN'
  | 'PRE_MARKET'
  | 'AFTER_HOURS'
  | 'CLOSED'
  | 'NON_TRADING_DAY';

export type EntryBlockReason =
  | 'NONE'
  | 'R6_DEFENSE'
  | 'POSITION_FULL'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | 'KRX_NON_TRADING_DAY'
  | 'MARKET_CLOSED'
  | 'PROVIDER_BLOCKING'
  | 'DATA_CONFIDENCE_LOW'
  | 'RISK_LIMIT';

export const INTERNAL_BLOCK_SENTINEL = 999;

const MACRO_REGIME_PRIORITY: MacroRegime[] = [
  'R6_DEFENSE',
  'R5_CRISIS',
  'R4_RISK_OFF',
  'R3_CAUTION',
  'R2_NEUTRAL',
  'R1_RISK_ON',
];

export function resolveMacroRegime(candidates: readonly MacroRegime[]): MacroRegime {
  return MACRO_REGIME_PRIORITY.find((regime) => candidates.includes(regime)) ?? 'R2_NEUTRAL';
}

export function normalizeMacroRegime(value: unknown): MacroRegime {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'R6_DEFENSE') return 'R6_DEFENSE';
  if (raw === 'R5_CRISIS' || raw === 'R5_CAUTION') return 'R5_CRISIS';
  if (raw === 'R4_RISK_OFF' || raw === 'R4_NEUTRAL') return 'R4_RISK_OFF';
  if (raw === 'R3_CAUTION' || raw === 'R3_EARLY') return 'R3_CAUTION';
  if (raw === 'R1_RISK_ON' || raw === 'R1_TURBO' || raw === 'R2_BULL') return 'R1_RISK_ON';
  return 'R2_NEUTRAL';
}

export function formatRequiredScore(requiredScore: number | null | undefined, blockedByPolicy: boolean): string {
  if (
    blockedByPolicy ||
    requiredScore === null ||
    requiredScore === undefined ||
    requiredScore >= INTERNAL_BLOCK_SENTINEL
  ) {
    return 'N/A';
  }
  return Number.isInteger(requiredScore) ? String(requiredScore) : requiredScore.toFixed(1);
}

export function formatEntryBlockReasons(reasons: readonly EntryBlockReason[] | undefined): string {
  const filtered = (reasons ?? []).filter((reason) => reason !== 'NONE');
  return `[${filtered.length > 0 ? filtered.join(', ') : 'NONE'}]`;
}

export function resolveMarketSessionState(input: {
  marketSessionState?: MarketSessionState;
  skipReason?: string | null;
  isKrxTradingDay?: boolean;
  volumeClockAllowsEntry?: boolean;
  fallback?: MarketSessionState;
} = {}): MarketSessionState {
  if (input.marketSessionState) return input.marketSessionState;
  if (input.skipReason === 'KRX_NON_TRADING_DAY' || input.isKrxTradingDay === false) return 'NON_TRADING_DAY';
  if (input.volumeClockAllowsEntry === false) return 'CLOSED';
  return input.fallback ?? 'OPEN';
}

export function formatEntryRevalidationSkippedLog(input: {
  symbol?: string;
  actualGateScore?: number;
  requiredGateScore: number | null;
  macroRegime: MacroRegime;
  executionMode: ExecutionMode;
  marketSessionState: MarketSessionState;
  liveEntryAllowed: false;
  shadowLearningAllowed: boolean;
  diagnosticOnly: true;
  blockReasons: readonly EntryBlockReason[];
  executionImpact: 'NONE';
}): string {
  return [
    '[ENTRY_REVALIDATION_SKIPPED]',
    `symbol=${input.symbol ?? 'UNKNOWN'}`,
    `actualGateScore=${typeof input.actualGateScore === 'number' ? input.actualGateScore.toFixed(1) : 'N/A'}`,
    `requiredGateScore=${formatRequiredScore(input.requiredGateScore, true)}`,
    `macroRegime=${input.macroRegime}`,
    `executionMode=${input.executionMode}`,
    `marketSessionState=${input.marketSessionState}`,
    `liveEntryAllowed=${input.liveEntryAllowed}`,
    `shadowLearningAllowed=${input.shadowLearningAllowed}`,
    `diagnosticOnly=${input.diagnosticOnly}`,
    `blockReasons=${formatEntryBlockReasons(input.blockReasons)}`,
    `executionImpact=${input.executionImpact}`,
  ].join(' ');
}

export function formatPreScanSkippedLog(input: {
  macroRegime: MacroRegime;
  executionMode: ExecutionMode;
  marketSessionState: MarketSessionState;
  reason: EntryBlockReason | string;
  liveEntryAllowed: false;
  shadowLearningAllowed: boolean;
  executionImpact: 'NONE';
}): string {
  return [
    '[PRE_SCAN_SKIPPED]',
    `macroRegime=${input.macroRegime}`,
    `executionMode=${input.executionMode}`,
    `marketSessionState=${input.marketSessionState}`,
    `reason=${input.reason}`,
    `liveEntryAllowed=${input.liveEntryAllowed}`,
    `shadowLearningAllowed=${input.shadowLearningAllowed}`,
    `executionImpact=${input.executionImpact}`,
  ].join(' ');
}
