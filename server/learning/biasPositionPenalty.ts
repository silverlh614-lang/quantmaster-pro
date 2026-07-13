// @responsibility read-only bias heatmap to position-size multiplier
import { loadBiasHeatmap } from '../persistence/reflectionRepo.js';
import type { BiasType } from './reflectionTypes.js';
import { freshnessWeightFromMeta } from './learningFreshnessGuard.js';

export interface BiasPositionPenalty {
  generatedAt: string;
  multiplier: number;
  reasons: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

const BIAS_POSITION_PENALTY_CONSTANTS = {
  SCORE_THRESHOLD: 0.70,
  TWO_DAY_MULTIPLIER: 0.70,
  THREE_DAY_MULTIPLIER: 0.50,
  FLOOR: 0.25,
  CAP: 1.0,
} as const;

function clampMultiplier(value: number): number {
  return Math.max(
    BIAS_POSITION_PENALTY_CONSTANTS.FLOOR,
    Math.min(BIAS_POSITION_PENALTY_CONSTANTS.CAP, value),
  );
}

export function computeBiasPositionPenalty(now: Date = new Date()): BiasPositionPenalty {
  if (process.env.LEARNING_BIAS_POSITION_PENALTY_DISABLED === 'true') {
    return {
      generatedAt: now.toISOString(),
      multiplier: 1.0,
      reasons: ['disabled by LEARNING_BIAS_POSITION_PENALTY_DISABLED'],
      confidence: 'LOW',
    };
  }

  const entries = loadBiasHeatmap()
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      scores: (entry.scores ?? [])
        .map((score) => ({
          ...score,
          score: score.score * freshnessWeightFromMeta({ date: entry.date }, undefined, now),
        }))
        .filter((score) => score.score > 0),
    }))
    .filter((entry) => (entry.scores ?? []).length > 0)
    .slice(-7);

  if (entries.length < 3) {
    return {
      generatedAt: now.toISOString(),
      multiplier: 1.0,
      reasons: ['biasHeatmap data below 3 days'],
      confidence: 'LOW',
    };
  }

  const recent3 = entries.slice(-3);
  const recent2 = entries.slice(-2);
  const biases = new Set<BiasType>();
  for (const entry of recent3) {
    for (const score of entry.scores ?? []) biases.add(score.bias);
  }

  let multiplier = 1.0;
  const reasons: string[] = [];
  for (const bias of biases) {
    const last3Hot = recent3.every((entry) =>
      (entry.scores ?? []).some(
        (score) => score.bias === bias && score.score >= BIAS_POSITION_PENALTY_CONSTANTS.SCORE_THRESHOLD,
      ),
    );
    if (last3Hot) {
      multiplier = Math.min(multiplier, BIAS_POSITION_PENALTY_CONSTANTS.THREE_DAY_MULTIPLIER);
      reasons.push(`${bias} >= 0.70 for 3 consecutive days`);
      continue;
    }
    const last2Hot = recent2.every((entry) =>
      (entry.scores ?? []).some(
        (score) => score.bias === bias && score.score >= BIAS_POSITION_PENALTY_CONSTANTS.SCORE_THRESHOLD,
      ),
    );
    if (last2Hot) {
      multiplier = Math.min(multiplier, BIAS_POSITION_PENALTY_CONSTANTS.TWO_DAY_MULTIPLIER);
      reasons.push(`${bias} >= 0.70 for 2 consecutive days`);
    }
  }

  return {
    generatedAt: now.toISOString(),
    multiplier: clampMultiplier(multiplier),
    reasons: reasons.length > 0 ? reasons : ['no sustained high-bias cluster'],
    confidence: entries.length >= 7 ? 'HIGH' : 'MEDIUM',
  };
}
