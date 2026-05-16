// @responsibility Gate evaluation result contracts + final decision resolver. No order/broker imports.

import type { DataConfidence } from '../../data/dataConfidenceRouter.js';
import type { EngineRuntimePolicy } from '../../runtime/engineRuntimePolicy.js';

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
}

export type FinalDecision = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'BLOCK' | 'SELL_ONLY_ALLOWED';

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
}

function getGate(input: FinalDecisionResolverInput, gateName: string): GateResult | undefined {
  return input.gateResults.find((gate) => gate.gateName === gateName);
}

function collect<T>(items: T[][]): T[] {
  return items.flat();
}

export const Gate0MacroEvaluator = Object.freeze({
  fromResult(result: GateResult): GateResult { return { ...result, gateName: 'Gate0Macro' }; },
});

export const Gate1SurvivalEvaluator = Object.freeze({
  fromResult(result: GateResult): GateResult { return { ...result, gateName: 'Gate1Survival' }; },
});

export const Gate2GrowthEvaluator = Object.freeze({
  fromResult(result: GateResult): GateResult { return { ...result, gateName: 'Gate2Growth' }; },
});

export const Gate3TimingEvaluator = Object.freeze({
  fromResult(result: GateResult): GateResult { return { ...result, gateName: 'Gate3Timing' }; },
});

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

    if (input.runtimePolicy.engineMode === 'SELL_ONLY') {
      return {
        decision: 'SELL_ONLY_ALLOWED',
        liveBuyAllowed: false,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: input.requestedDecision !== 'HOLD',
        blockers,
        warnings,
        reasonCodes,
      };
    }

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
      };
    }

    if (gate1 && !gate1.passed) {
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
      };
    }

    if (input.requestedDecision === 'STRONG_BUY' && (input.enemyWarningCount ?? 0) >= 2) {
      return {
        decision: 'BUY',
        liveBuyAllowed: true,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: true,
        blockers,
        warnings: [...warnings, 'ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE'],
        reasonCodes: [...new Set([...reasonCodes, 'ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE'])],
      };
    }

    return {
      decision: input.requestedDecision,
      liveBuyAllowed: input.requestedDecision !== 'HOLD',
      liveSellAllowed: input.runtimePolicy.liveSellAllowed,
      shadowAllowed: input.runtimePolicy.shadowAllowed,
      learningAllowed: input.runtimePolicy.learningAllowed,
      downgraded: false,
      blockers,
      warnings,
      reasonCodes,
    };
  },
});

export function resolveFinalDecision(input: FinalDecisionResolverInput): FinalDecisionResolverOutput {
  return FinalDecisionResolver.resolve(input);
}
