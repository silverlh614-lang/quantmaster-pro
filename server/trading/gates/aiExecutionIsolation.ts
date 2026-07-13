// @responsibility AI/LLM/search estimate isolation for execution scoring. Pure policy helpers only.

import {
  isAiEstimatedConfidence,
  isExecutionAllowedConfidence,
  type DataConfidence,
} from '../../data/dataConfidenceRouter.js';

export type { DataConfidence } from '../../data/dataConfidenceRouter.js';

export interface FeatureValue<T> {
  value: T | null;
  confidence: DataConfidence;
  source: string;
  asOf?: string;
  executionEligible: boolean;
}

interface ScoreFeatureInput {
  featureName: string;
  value: unknown;
  score: number;
  confidence: DataConfidence;
  source: string;
  asOf?: string;
}

export interface AiExcludedDiagnostic {
  snapshotId?: string;
  symbol?: string;
  featureName: string;
  value: unknown;
  confidence: DataConfidence;
  source: string;
  previousRole: 'EXECUTION_SCORE_OR_GATE';
  newRole: 'ADVISORY_OR_SHADOW_ONLY';
  reason: 'AI_ESTIMATED_EXCLUDED_FROM_EXECUTION';
  executionImpact: 'NONE';
  shadowOnly: true;
  learningLabel: 'AI_ESTIMATE_OBSERVED';
}

export interface ScoreBreakdown {
  executionScore: number;
  adjustmentScore: number;
  finalScore: number;
  advisoryScore: number;
  aiNarrativeScore: number;
  excludedAiScore: number;
  executionEligibleFeatureCount: number;
  aiEstimatedFeatureCount: number;
  diagnostics: AiExcludedDiagnostic[];
}

export interface SplitFeatureScoresInput {
  snapshotId?: string;
  symbol?: string;
  features: ScoreFeatureInput[];
  adjustmentScore?: number;
  aiNarrativeScore?: number;
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

export function makeFeatureValue<T>(input: {
  value: T | null;
  confidence: DataConfidence;
  source: string;
  asOf?: string;
}): FeatureValue<T> {
  return {
    ...input,
    executionEligible: isExecutionAllowedConfidence(input.confidence),
  };
}

function canUseFeatureForExecution(feature: Pick<FeatureValue<unknown>, 'confidence' | 'executionEligible'>): boolean {
  return feature.executionEligible === true && isExecutionAllowedConfidence(feature.confidence);
}

export function canUseFeatureForGatePass(feature: Pick<FeatureValue<unknown>, 'confidence' | 'executionEligible'>): boolean {
  return canUseFeatureForExecution(feature);
}

export function splitFeatureScores(input: SplitFeatureScoresInput): ScoreBreakdown {
  const adjustmentScore = finiteOrZero(input.adjustmentScore);
  let executionScore = 0;
  let advisoryScore = 0;
  let excludedAiScore = 0;
  let executionEligibleFeatureCount = 0;
  let aiEstimatedFeatureCount = 0;
  const diagnostics: AiExcludedDiagnostic[] = [];

  for (const feature of input.features) {
    const score = finiteOrZero(feature.score);
    if (isExecutionAllowedConfidence(feature.confidence)) {
      executionScore += score;
      executionEligibleFeatureCount += 1;
      continue;
    }

    advisoryScore += score;
    if (isAiEstimatedConfidence(feature.confidence)) {
      excludedAiScore += score;
      aiEstimatedFeatureCount += 1;
      diagnostics.push({
        snapshotId: input.snapshotId,
        symbol: input.symbol,
        featureName: feature.featureName,
        value: feature.value,
        confidence: feature.confidence,
        source: feature.source,
        previousRole: 'EXECUTION_SCORE_OR_GATE',
        newRole: 'ADVISORY_OR_SHADOW_ONLY',
        reason: 'AI_ESTIMATED_EXCLUDED_FROM_EXECUTION',
        executionImpact: 'NONE',
        shadowOnly: true,
        learningLabel: 'AI_ESTIMATE_OBSERVED',
      });
    }
  }

  const aiNarrativeScore = finiteOrZero(input.aiNarrativeScore);
  return {
    executionScore,
    adjustmentScore,
    finalScore: executionScore + adjustmentScore,
    advisoryScore,
    aiNarrativeScore,
    excludedAiScore,
    executionEligibleFeatureCount,
    aiEstimatedFeatureCount,
    diagnostics,
  };
}

export function formatAiEstimateExcludedFromExecutionLog(diagnostic: AiExcludedDiagnostic): string {
  return [
    '[AI_ESTIMATE_EXCLUDED_FROM_EXECUTION]',
    kv('snapshotId', diagnostic.snapshotId),
    kv('symbol', diagnostic.symbol),
    kv('featureName', diagnostic.featureName),
    kv('value', diagnostic.value),
    kv('confidence', diagnostic.confidence),
    kv('source', diagnostic.source),
    "previousRole='EXECUTION_SCORE_OR_GATE'",
    "newRole='ADVISORY_OR_SHADOW_ONLY'",
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatScoreConfidenceSplitLog(input: {
  snapshotId?: string;
  symbol?: string;
  breakdown: ScoreBreakdown;
}): string {
  const { breakdown } = input;
  return [
    '[SCORE_CONFIDENCE_SPLIT]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    kv('executionScore', breakdown.executionScore),
    kv('adjustmentScore', breakdown.adjustmentScore),
    kv('finalScore', breakdown.finalScore),
    kv('advisoryScore', breakdown.advisoryScore),
    kv('aiNarrativeScore', breakdown.aiNarrativeScore),
    kv('excludedAiScore', breakdown.excludedAiScore),
    kv('executionEligibleFeatureCount', breakdown.executionEligibleFeatureCount),
    kv('aiEstimatedFeatureCount', breakdown.aiEstimatedFeatureCount),
  ].join(' ');
}

export function formatAiConfidenceTelegramLine(breakdown: Pick<ScoreBreakdown, 'excludedAiScore' | 'aiEstimatedFeatureCount'>): string | null {
  if (breakdown.excludedAiScore === 0 && breakdown.aiEstimatedFeatureCount === 0) return null;
  return 'AI 추정값: 실행 제외';
}
