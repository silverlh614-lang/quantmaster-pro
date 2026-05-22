// @responsibility Policy-aware Kelly display/calculation guard for live-entry blocked states.
import { applyKellyClamp, KELLY_FLOOR } from '../sizing/kellyClamp.js';
import type { EntryBlockReason, ExecutionMode, MacroRegime, MarketSessionState } from '../entryPolicySemantics.js';
import { formatEntryBlockReasons } from '../entryPolicySemantics.js';

export interface EffectiveKellyInput {
  baseKelly: number;
  regimeMultiplier?: number;
  vixMultiplier: number;
  ipsMultiplier: number;
  accountMultiplier: number;
  exceptionKellyFactor?: number;
  biasMultiplier?: number;
  safetyGateMultiplier?: number;
  kellyFloor?: number;
  liveEntryAllowed: boolean;
  macroRegime: MacroRegime;
  executionMode: ExecutionMode;
  marketSessionState: MarketSessionState;
  hardBlock?: boolean;
  positionFull?: boolean;
  riskLimitReached?: boolean;
  blockReasons?: readonly EntryBlockReason[];
  executionImpact?: 'NONE' | string;
}

export interface EffectiveKellyResult {
  rawKelly: number;
  floorApplied: boolean;
  effectiveKelly: number;
  blockedByPolicy: boolean;
  blockReasons: EntryBlockReason[];
  executionImpact: 'NONE' | string;
}

export function computeEffectiveKelly(input: EffectiveKellyInput): EffectiveKellyResult {
  const blockReasons = normalizeKellyBlockReasons(input);
  const policyBlocked =
    !input.liveEntryAllowed ||
    input.hardBlock === true ||
    input.executionMode === 'SHADOW_ONLY' ||
    input.executionMode === 'OBSERVE_ONLY' ||
    input.marketSessionState === 'NON_TRADING_DAY' ||
    input.marketSessionState === 'CLOSED' ||
    input.positionFull === true ||
    input.riskLimitReached === true;

  if (policyBlocked) {
    return {
      rawKelly: 0,
      floorApplied: false,
      effectiveKelly: 0,
      blockedByPolicy: true,
      blockReasons: blockReasons.length > 0 ? blockReasons : ['RISK_LIMIT'],
      executionImpact: 'NONE',
    };
  }

  const rawKelly =
    input.baseKelly *
    (input.regimeMultiplier ?? 1) *
    input.vixMultiplier *
    input.ipsMultiplier *
    (input.exceptionKellyFactor ?? 1) *
    input.accountMultiplier *
    (input.biasMultiplier ?? 1) *
    (input.safetyGateMultiplier ?? 1);
  const effectiveKelly = applyKellyClamp(rawKelly);
  return {
    rawKelly,
    floorApplied: rawKelly < (input.kellyFloor ?? KELLY_FLOOR),
    effectiveKelly,
    blockedByPolicy: false,
    blockReasons: [],
    executionImpact: input.executionImpact ?? 'NONE',
  };
}

export function formatKellyPolicyBlockedLog(input: {
  macroRegime: MacroRegime;
  executionMode: ExecutionMode;
  marketSessionState: MarketSessionState;
  liveEntryAllowed: false;
  shadowLearningAllowed: boolean;
  result: EffectiveKellyResult;
}): string {
  return [
    '[KELLY_POLICY_BLOCKED]',
    `macroRegime=${input.macroRegime}`,
    `executionMode=${input.executionMode}`,
    `marketSessionState=${input.marketSessionState}`,
    `blockReasons=${formatEntryBlockReasons(input.result.blockReasons)}`,
    `rawKelly=${input.result.rawKelly}`,
    `floorApplied=${input.result.floorApplied}`,
    `effectiveKelly=${input.result.effectiveKelly}`,
    `liveEntryAllowed=${input.liveEntryAllowed}`,
    `shadowLearningAllowed=${input.shadowLearningAllowed}`,
    `executionImpact=${input.result.executionImpact}`,
  ].join(' ');
}

function normalizeKellyBlockReasons(input: EffectiveKellyInput): EntryBlockReason[] {
  const reasons = new Set<EntryBlockReason>();
  for (const reason of input.blockReasons ?? []) {
    if (reason !== 'NONE') reasons.add(reason);
  }
  if (input.executionMode === 'SHADOW_ONLY') reasons.add('SHADOW_ONLY');
  if (input.executionMode === 'OBSERVE_ONLY') reasons.add('OBSERVE_ONLY');
  if (input.marketSessionState === 'NON_TRADING_DAY') reasons.add('KRX_NON_TRADING_DAY');
  if (input.marketSessionState === 'CLOSED') reasons.add('MARKET_CLOSED');
  if (input.positionFull) reasons.add('POSITION_FULL');
  if (input.riskLimitReached) reasons.add('RISK_LIMIT');
  return [...reasons];
}
