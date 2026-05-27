/**
 * @responsibility last_trigger 조건 평가기 — Gate3 최종 진입 타이밍 트리거를 가중치 점수로 환산한다.
 */

import type { ConditionEvaluator } from './types.js';
import { evaluateGate3LastTrigger } from '../gate3LastTrigger.js';

const W_MIN = 0.1;
const W_MAX = 2.0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weightFor(weights: Record<string, number>, key: string): number {
  const raw = weights[key];
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1.0;
  return clamp(raw, W_MIN, W_MAX);
}

export const lastTriggerEvaluator: ConditionEvaluator = {
  key: 'last_trigger',
  description: 'Gate3 final entry timing trigger: fresh price, breakout/volume/VCP, RSI/MACD, RRR, false-breakout guard',
  inputs: [
    'quote.price',
    'quote.high5d',
    'quote.high20d',
    'quote.volume',
    'quote.avgVolume',
    'quote.rsi14',
    'quote.macdHistogram',
  ],
  evaluate({ quote, weights }) {
    const result = evaluateGate3LastTrigger({ quote: quote as unknown as Record<string, unknown> });
    const w = weightFor(weights, 'last_trigger');
    return {
      score: result.fired ? w : 0,
      conditionKey: 'last_trigger',
      detail: result.detail,
      status: result.status,
    };
  },
};
