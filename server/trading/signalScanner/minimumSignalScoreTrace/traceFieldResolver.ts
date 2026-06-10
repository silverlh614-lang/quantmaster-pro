// @responsibility CandidateEntryTrace 중첩 경로 수치/문자열 해석과 breakout 신호 상태 판독 순수 유틸 (advisory-only).

import type { CandidateEntryTrace } from "../entryFilterDecomposition.js";
import {
  conditionTraceValue,
  extractGateLayerBreakoutSignals,
} from "../gatePositiveFeatureMaterializer.js";
import { finite, toFiniteNumber } from "./scoring.js";

export function numericTraceValue(
  trace: CandidateEntryTrace,
  keys: readonly string[],
): number | undefined {
  const record = trace as unknown as Record<string, unknown>;
  const symbolFeatures =
    record.symbolFeatures && typeof record.symbolFeatures === "object"
      ? (record.symbolFeatures as Record<string, unknown>)
      : undefined;
  for (const key of keys) {
    const direct = record[key];
    if (finite(direct)) return direct;
    const feature = symbolFeatures?.[key];
    if (finite(feature)) return feature;
  }
  return undefined;
}

export function nestedNumericTraceValue(
  trace: CandidateEntryTrace,
  paths: readonly string[],
): number | undefined {
  return resolveNumericTracePath(trace, paths).value;
}

export function tracePathExists(
  trace: CandidateEntryTrace,
  paths: readonly string[],
): boolean {
  const root = trace as unknown as Record<string, unknown>;
  return paths.some((path) => {
    const value = path.split(".").reduce<unknown>((current, part) => {
      if (current && typeof current === "object")
        return (current as Record<string, unknown>)[part];
      return undefined;
    }, root);
    return value !== undefined;
  });
}

export function resolveNumericTracePath(
  trace: CandidateEntryTrace,
  paths: readonly string[],
): { value: number | undefined; sourcePath?: string } {
  const root = trace as unknown as Record<string, unknown>;
  const expandedPaths = paths.flatMap((path) =>
    path.includes(".") ? [path] : [`symbolFeatures.${path}`, path],
  );
  for (const path of expandedPaths) {
    const value = path.split(".").reduce<unknown>((current, part) => {
      if (current && typeof current === "object")
        return (current as Record<string, unknown>)[part];
      return undefined;
    }, root);
    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) return { value: numeric, sourcePath: path };
  }
  return { value: undefined };
}

export function stringArrayTraceValue(
  trace: CandidateEntryTrace,
  key: string,
): string[] | undefined {
  const value = (trace as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export function positiveReasonProxy(reasons: readonly string[] | undefined): boolean {
  return (reasons ?? []).some((reason) =>
    /momentum|leader|leading|relative|rs|강세|주도주/i.test(reason),
  );
}

export const BREAKOUT_SOURCE_KEYS = [
  "breakout_momentum",
  "turtle_high",
  "volume_breakout",
  "volume_surge",
  "vcp",
  "trend_acceleration",
] as const;

export function breakoutSignalState(trace: CandidateEntryTrace, key: string): unknown {
  const record = trace as unknown as Record<string, unknown>;
  const direct = record[key];
  if (direct !== undefined) return direct;
  const symbolFeatures = record.symbolFeatures;
  if (symbolFeatures && typeof symbolFeatures === "object") {
    const value = (symbolFeatures as Record<string, unknown>)[key];
    if (value !== undefined) return value;
  }
  const signals = record.breakoutSignals;
  if (signals && typeof signals === "object")
    return (signals as Record<string, unknown>)[key];
  const breakoutTrace = record.breakoutTrace;
  if (breakoutTrace && typeof breakoutTrace === "object") {
    const value = (breakoutTrace as Record<string, unknown>)[key];
    if (value !== undefined) return value;
  }
  const featurePack = record.featurePack;
  const breakout =
    featurePack && typeof featurePack === "object"
      ? (featurePack as Record<string, unknown>).breakout
      : undefined;
  if (breakout && typeof breakout === "object") {
    const value = (breakout as Record<string, unknown>)[key];
    if (value !== undefined) return value;
  }
  const conditionResults = record.conditionResults;
  if (conditionResults && typeof conditionResults === "object")
    return (conditionResults as Record<string, unknown>)[key];
  const conditionTrace = conditionTraceValue(trace, key);
  if (conditionTrace !== undefined) return conditionTrace;
  const gateLayerSignals = extractGateLayerBreakoutSignals(trace);
  if (gateLayerSignals[key] !== undefined) return gateLayerSignals[key];
  const conditionKeys = record.conditionKeys;
  if (
    Array.isArray(conditionKeys) &&
    conditionKeys.some(
      (item) =>
        typeof item === "string" && item.toLowerCase() === key.toLowerCase(),
    )
  )
    return true;
  return undefined;
}

export function isBreakoutFired(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string")
    return /^(FIRED|PASS|PASSED|TRUE)$/i.test(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      record.fired === true ||
      record.passed === true ||
      isBreakoutFired(record.status) ||
      isBreakoutFired(record.result)
    );
  }
  return false;
}

export function isBreakoutUnavailable(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string")
    return /^(UNAVAILABLE|ERROR|MISSING|UNKNOWN)$/i.test(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      isBreakoutUnavailable(record.status) ||
      isBreakoutUnavailable(record.result) ||
      record.error === true
    );
  }
  return false;
}

export function breakoutProjectionBreakPoint(trace: CandidateEntryTrace): string | undefined {
  if (!trace.symbol) return "SYMBOL_NOT_IN_GATE_INPUT";
  if (tracePathExists(trace, ["featurePack"]) && !tracePathExists(trace, ["featurePack.breakout"]))
    return "FEATURE_PACK_MISSING";
  if (tracePathExists(trace, ["conditionResults", "conditionResultsTrace"]))
    return "CONDITION_RESULT_NOT_PROJECTED";
  if (tracePathExists(trace, ["breakoutTrace", "breakoutSignals"]))
    return "SCORE_COMPONENT_MISSING";
  if (tracePathExists(trace, [
    "gateLayerSummary.gate3",
    "gate3ExternalDataCoverage",
  ]))
    return "SCORE_COMPONENT_MISSING";
  if (tracePathExists(trace, ["stageReached"]))
    return "TRACE_ONLY_CANDIDATE";
  return undefined;
}
