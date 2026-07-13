// @responsibility Test fixture helpers for ADR-0524 dynamic weight feedback.

import { resolveFinalExecutionDecision, type FinalDecisionResolverRuntimeInput } from '../trading/gates/finalDecisionResolver.js';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
  buildOutcomeSeed,
  closeOutcomeLabel,
  type OutcomeSeed,
} from './outcomeClosure.js';

export type FixtureKind =
  | 'WIN'
  | 'LOSS'
  | 'FALSE_POSITIVE'
  | 'MISSED_WIN'
  | 'AVOIDED_LOSS'
  | 'TRUE_NEGATIVE';

function runtimeInput(overrides: Partial<FinalDecisionResolverRuntimeInput> = {}): FinalDecisionResolverRuntimeInput {
  return {
    sourceSnapshotId: 'wf:0524',
    symbol: '204320',
    asOf: '2026-05-24T09:00:00.000Z',
    gate1Status: 'PASS',
    gate2Status: 'GATE2_PASS_STRONG',
    gate3Readiness: 'EXECUTION_READY',
    entryTimingSignal: 'ENTRY_READY',
    engineMode: 'NORMAL',
    marketSession: 'REGULAR',
    effectiveRegime: 'GREEN',
    riskOverride: 'NONE',
    providerHealth: { quote: 'VERIFIED', supply: 'VERIFIED', dart: 'VERIFIED', macro: 'VERIFIED' },
    dataConfidenceCeiling: 'HIGH',
    marketSignal: false,
    providerIssue: false,
    shadowMode: 'NORMAL',
    requestedSide: 'BUY',
    currentPositionState: 'NONE',
    isDiagnosticOnly: false,
    ...overrides,
  };
}

export function sampleSeed(kind: FixtureKind, overrides: {
  symbol?: string;
  gate2AxisScores?: Record<string, number | null>;
  gate3ComponentScores?: Record<string, number | null>;
  engineMode?: FinalDecisionResolverRuntimeInput['engineMode'];
  providerIssue?: boolean;
  dataConfidenceCeiling?: FinalDecisionResolverRuntimeInput['dataConfidenceCeiling'];
  gate3Readiness?: string;
  entryTimingSignal?: FinalDecisionResolverRuntimeInput['entryTimingSignal'];
  priceDataHealth?: 'VERIFIED' | 'STALE' | 'MISSING' | 'DEGRADED';
  pending?: boolean;
} = {}): OutcomeSeed {
  const blocked = kind === 'MISSED_WIN' || kind === 'AVOIDED_LOSS' || kind === 'TRUE_NEGATIVE';
  const input = runtimeInput({
    symbol: overrides.symbol ?? `S${kind}`,
    engineMode: overrides.engineMode ?? (blocked ? 'SELL_ONLY' : 'NORMAL'),
    providerIssue: overrides.providerIssue ?? false,
    dataConfidenceCeiling: overrides.dataConfidenceCeiling ?? 'HIGH',
    gate3Readiness: overrides.gate3Readiness ?? 'EXECUTION_READY',
    entryTimingSignal: overrides.entryTimingSignal ?? 'ENTRY_READY',
  });
  const decision = resolveFinalExecutionDecision(input);
  const raw = buildOutcomeSeed({
    decision,
    runtimeInput: input,
    entryPrice: 10_000,
    stopLossPrice: 9_300,
    targetPrice: 11_500,
    rrrValue: 2.14,
    gate1Score: 80,
    gate2Score: 82,
    gate3CompletionScore: 91,
    gate2AxisScores: overrides.gate2AxisScores ?? { SUPPLY_CONFLUENCE: 90, TECHNICAL_TREND: 70 },
    gate3ComponentScores: overrides.gate3ComponentScores ?? { rrrProfile: 90, lastTrigger: 90, priceConfirmation: 90, volumeConfirmation: 90, falseBreakoutGuard: 80 },
  });
  if (overrides.pending) return raw;
  const price = priceFor(kind);
  return closeOutcomeLabel(attachForwardReturn(raw, buildForwardReturnSnapshot({
    seed: raw,
    horizon: '10D',
    asOf: '2026-06-03',
    closePrice: price.close,
    highPrice: price.high,
    lowPrice: price.low,
    priceDataHealth: overrides.priceDataHealth ?? 'VERIFIED',
    ...(price.targetHitAt ? { targetHitAt: price.targetHitAt } : {}),
    ...(price.stopHitAt ? { stopHitAt: price.stopHitAt } : {}),
  })));
}

function priceFor(kind: FixtureKind): {
  close: number;
  high: number;
  low: number;
  targetHitAt?: string;
  stopHitAt?: string;
} {
  if (kind === 'WIN') return { close: 10_800, high: 11_600, low: 9_900, targetHitAt: '2026-05-27T06:00:00.000Z' };
  if (kind === 'LOSS') return { close: 9_100, high: 10_100, low: 9_200, stopHitAt: '2026-05-27T06:00:00.000Z' };
  if (kind === 'FALSE_POSITIVE') return { close: 9_800, high: 10_100, low: 9_600 };
  if (kind === 'MISSED_WIN') return { close: 10_800, high: 11_000, low: 9_900 };
  if (kind === 'AVOIDED_LOSS') return { close: 9_200, high: 10_100, low: 9_100, stopHitAt: '2026-05-27T06:00:00.000Z' };
  return { close: 10_000, high: 10_200, low: 9_800 };
}

export function repeatSamples(kind: FixtureKind, count: number, overrides: Parameters<typeof sampleSeed>[1] = {}): OutcomeSeed[] {
  return Array.from({ length: count }, (_, index) =>
    sampleSeed(kind, {
      ...overrides,
      symbol: `${overrides.symbol ?? kind}${String(index).padStart(3, '0')}`,
    }),
  );
}
