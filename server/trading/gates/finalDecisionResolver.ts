// @responsibility Gate evaluation result contracts + final decision resolver. No order/broker imports.

import type { DataConfidence } from '../../data/dataConfidenceRouter.js';
import type { EngineRuntimePolicy } from '../../runtime/engineRuntimePolicy.js';
import type { ConvictionLabel } from './simpleDecision.js';

export interface EvidenceItem {
  key: string;
  value: unknown;
  source?: string;
}

export interface GateResult {
  gateName: string;
  passed: boolean;
  score: number;
  maxScore: number;
  confidence: DataConfidence;
  blockers: string[];
  warnings: string[];
  evidence: EvidenceItem[];
  hardFail?: boolean;
  executionImpact?: 'NONE' | 'DATA_REQUIRED_MISSING' | 'ORDER_WAIT';
}

export type FinalDecision = 'BUY' | 'HOLD' | 'BLOCK' | 'SELL_ONLY_ALLOWED';

export interface FinalDecisionResolverInput {
  runtimePolicy: EngineRuntimePolicy;
  gateResults: GateResult[];
  requestedDecision: 'STRONG_BUY' | 'BUY' | 'HOLD';
  enemyWarningCount?: number;
}

export interface FinalDecisionResolverOutput {
  decision: FinalDecision;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowAllowed: boolean;
  learningAllowed: boolean;
  downgraded: boolean;
  blockers: string[];
  warnings: string[];
  reasonCodes: string[];
  convictionLabel: ConvictionLabel;
  strongBuyAsLabelOnly: true;
  ignoredLegacyStrongBuyBlockers: string[];
}

function getGate(input: FinalDecisionResolverInput, gateName: string): GateResult | undefined {
  return input.gateResults.find((gate) => gate.gateName === gateName);
}

function collect<T>(items: T[][]): T[] {
  return items.flat();
}

const ALLOWED_GATE_HARD_FAIL_REASONS = new Set([
  'PRICE_MISSING',
  'CURRENT_PRICE_MISSING',
  'PRICE_SNAPSHOT_MISSING',
  'TRADABLE_FALSE',
  'HALTED',
  'SUSPENDED',
  'MANAGEMENT_ISSUE',
  'ORDER_UNAVAILABLE',
  'VOLUME_MISSING',
  'LIQUIDITY_FAIL_NO_RELIABLE_QUOTE',
  'TRADE_PLAN_INVALID',
  'ENTRY_PRICE_INVALID',
  'STOP_LOSS_INVALID',
  'TARGET_INVALID',
  'RR_UNCALCULABLE',
  'SLOT_FULL',
]);

function isAllowedHardFailGate(gate: GateResult | undefined): boolean {
  if (!gate) return false;
  if (gate.hardFail === true) return true;
  return gate.blockers.some((blocker) => ALLOWED_GATE_HARD_FAIL_REASONS.has(blocker));
}

export type GateName =
  | 'Gate0Macro'
  | 'Gate1Survival'
  | 'Gate2Growth'
  | 'Gate3Timing'
  | 'EnemyChecklist';

export function asGateResult(gateName: GateName, result: GateResult): GateResult {
  return { ...result, gateName };
}

export const EnemyChecklistEvaluator = Object.freeze({
  warningCount(result: GateResult): number { return result.warnings.length; },
});

export const ConfluenceEvaluator = Object.freeze({
  passed(results: GateResult[]): boolean { return results.every((result) => result.passed); },
});

export const FinalDecisionResolver = Object.freeze({
  resolve(input: FinalDecisionResolverInput): FinalDecisionResolverOutput {
    const blockers = collect(input.gateResults.map((gate) => gate.blockers));
    const warnings = collect(input.gateResults.map((gate) => gate.warnings));
    const reasonCodes = [...new Set([...input.runtimePolicy.reasonCodes, ...blockers])];
    const gate1 = getGate(input, 'Gate1Survival');
    const requestedBuyDecision = input.requestedDecision === 'HOLD' ? 'HOLD' : 'BUY';
    const convictionLabel: ConvictionLabel =
      input.requestedDecision === 'STRONG_BUY' ? 'HIGH_CONVICTION'
      : input.requestedDecision === 'BUY' ? 'BUY'
      : 'WATCH';
    const ignoredLegacyStrongBuyBlockers =
      input.requestedDecision === 'STRONG_BUY' && (input.enemyWarningCount ?? 0) >= 2
        ? ['ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE']
        : [];

    if (!input.runtimePolicy.liveBuyAllowed) {
      return {
        decision: 'BLOCK',
        liveBuyAllowed: false,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: input.requestedDecision !== 'HOLD',
        blockers,
        warnings,
        reasonCodes,
        convictionLabel,
        strongBuyAsLabelOnly: true,
        ignoredLegacyStrongBuyBlockers,
      };
    }

    if (gate1 && !gate1.passed && isAllowedHardFailGate(gate1)) {
      return {
        decision: 'HOLD',
        liveBuyAllowed: false,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: input.requestedDecision === 'BUY' || input.requestedDecision === 'STRONG_BUY',
        blockers: [...blockers, 'GATE1_SURVIVAL_FAILED'],
        warnings,
        reasonCodes: [...new Set([...reasonCodes, 'GATE1_SURVIVAL_FAILED'])],
        convictionLabel,
        strongBuyAsLabelOnly: true,
        ignoredLegacyStrongBuyBlockers,
      };
    }

    return {
      decision: requestedBuyDecision,
      liveBuyAllowed: input.requestedDecision !== 'HOLD',
      liveSellAllowed: input.runtimePolicy.liveSellAllowed,
      shadowAllowed: input.runtimePolicy.shadowAllowed,
      learningAllowed: input.runtimePolicy.learningAllowed,
      downgraded: false,
      blockers,
      warnings,
      reasonCodes,
      convictionLabel,
      strongBuyAsLabelOnly: true,
      ignoredLegacyStrongBuyBlockers,
    };
  },
});

export function resolveFinalDecision(input: FinalDecisionResolverInput): FinalDecisionResolverOutput {
  return FinalDecisionResolver.resolve(input);
}
