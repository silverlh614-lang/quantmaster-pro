// @responsibility ADR-0466 신호점수 정규화 + 상대강도(RS) 스코어링 순수 계산 (advisory-only diagnostic).

import type { SignalScoreComponentConfidence } from "./types.js";

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSignalScoreTo100(
  score: number | null | undefined,
): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score >= 0 && score <= 10) return score * 10;
  if (score > 10 && score <= 27) return (score / 27) * 100;
  if (score > 27 && score <= 100) return score;
  if (score > 100) return 100;
  return 0;
}

export function weightedFromNormalized(
  normalizedScore: number,
  maxScore: number,
): number {
  return round1((clamp(normalizedScore, 0, 100) / 100) * maxScore);
}

export function normalizeRelativeReturn20dTo100(value: number): number {
  const percentValue = Math.abs(value) <= 1 ? value * 100 : value;
  return clamp(((percentValue + 10) / 20) * 100, 0, 100);
}

export function normalizeAbsoluteReturn20dTo100(value: number): number {
  const percentValue = Math.abs(value) <= 1 ? value * 100 : value;
  return clamp(((percentValue + 10) / 30) * 100, 0, 100);
}

export function percentReturn(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function scoreRelativeStrength(input: {
  return20d?: number;
  return5d?: number;
  kospi20dReturn?: number;
  explicitRelativeStrength?: number;
  marketRelativeReturn?: number;
}): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  maxScore: 10;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  message: string;
} {
  if (finite(input.explicitRelativeStrength)) {
    const normalizedScore = normalizeSignalScoreTo100(
      input.explicitRelativeStrength,
    );
    return {
      rawValue: input.explicitRelativeStrength,
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component imported from explicit candidate ranking/source.",
    };
  }

  if (finite(input.marketRelativeReturn)) {
    const relativeReturn20d = percentReturn(input.marketRelativeReturn);
    const normalizedScore = normalizeRelativeReturn20dTo100(relativeReturn20d);
    return {
      rawValue: { relativeReturn20d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component computed from explicit market-relative return.",
    };
  }

  if (finite(input.return20d)) {
    const return20d = percentReturn(input.return20d);
    const kospi20dReturn = finite(input.kospi20dReturn)
      ? percentReturn(input.kospi20dReturn)
      : undefined;
    const relativeReturn20d =
      kospi20dReturn === undefined ? return20d : return20d - kospi20dReturn;
    const normalizedScore =
      kospi20dReturn === undefined
        ? normalizeAbsoluteReturn20dTo100(return20d)
        : normalizeRelativeReturn20dTo100(relativeReturn20d);
    return {
      rawValue: { return20d, kospi20dReturn, relativeReturn20d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        kospi20dReturn === undefined
          ? "Relative strength component computed from candidate 20-day return because KOSPI 20-day return is unavailable."
          : "Relative strength component computed from candidate 20-day return minus KOSPI 20-day return.",
    };
  }

  if (finite(input.return5d)) {
    const return5d = percentReturn(input.return5d);
    const normalizedScore = clamp(((return5d + 5) / 15) * 100, 0, 100);
    return {
      rawValue: { return5d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "DEGRADED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component computed from short-horizon 5-day return fallback.",
    };
  }

  return {
    normalizedScore: 0,
    weightedScore: 0,
    maxScore: 10,
    confidence: "MISSING",
    providerIssue: false,
    marketSignal: false,
    message:
      "Relative strength source missing; contribution is 0 and is not treated as provider or bearish penalty.",
  };
}
