// @responsibility Materialize Gate2/Gate3 runtime diagnostics into Gate1 positive feature inputs.

export type GatePositiveQuoteFeatures = Record<string, number>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export function finitePositiveFeature(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    const record = asRecord(current);
    return record ? record[part] : undefined;
  }, source);
}

function pickFiniteFeature(...values: unknown[]): number | undefined {
  for (const value of values) {
    const finite = finitePositiveFeature(value);
    if (finite !== undefined) return finite;
  }
  return undefined;
}

function firstRecordByPath(source: unknown, paths: readonly string[]): Record<string, unknown> | undefined {
  for (const path of paths) {
    const record = asRecord(readPath(source, path));
    if (record) return record;
  }
  return undefined;
}

function normalizeStatusForGate(value: unknown): "PASS" | "FAIL" | "MISSING" | "UNKNOWN" | undefined {
  const record = asRecord(value);
  const status = typeof record?.status === "string"
    ? record.status
    : typeof value === "string"
      ? value
      : undefined;
  if (!status) return undefined;
  if (/^(PASS|FIRED|CONFIRMED|VERIFIED|TRUE)$/i.test(status)) return "PASS";
  if (/^(FAIL|FAILED|THRESHOLD_NOT_MET|BELOW_THRESHOLD|FALSE)$/i.test(status)) return "FAIL";
  if (/^(MISSING|DATA_UNAVAILABLE|UNAVAILABLE|ERROR)$/i.test(status)) return "MISSING";
  return "UNKNOWN";
}

function gateStatusObject(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const status = normalizeStatusForGate(value);
  if (!status) return record;
  return {
    ...(record ?? {}),
    status,
    passed: status === "PASS",
    fired: status === "PASS",
  };
}

export function extractGateLayerQuoteFeatureValues(source: unknown): GatePositiveQuoteFeatures {
  const root = asRecord(source) ?? {};
  const gateLayer = asRecord(root.gateLayerSummary) ?? root;
  const gate2External =
    firstRecordByPath(root, [
      "gate2ExternalDataCoverage",
      "gateLayerSummary.gate2.externalDataCoverage",
      "gate2.externalDataCoverage",
      "externalDataCoverage.gate2",
    ]) ??
    firstRecordByPath(gateLayer, ["gate2.externalDataCoverage"]);
  const gate3External =
    firstRecordByPath(root, [
      "gate3ExternalDataCoverage",
      "gateLayerSummary.gate3.externalDataCoverage",
      "gate3.externalDataCoverage",
      "externalDataCoverage.gate3",
    ]) ??
    firstRecordByPath(gateLayer, ["gate3.externalDataCoverage"]);

  const benchmarkValues = asRecord(readPath(gate2External, "benchmark.values"));
  const priceValues = asRecord(readPath(gate3External, "priceStructure.values"));
  const momentumValues = asRecord(readPath(gate3External, "momentumIndicators.values"));
  const volumeValues = asRecord(readPath(gate3External, "volumeTiming.values"));
  const pullbackValues = asRecord(readPath(gate3External, "pullbackSupport.values"));
  const falseBreakoutValues = asRecord(readPath(gate3External, "falseBreakout.values"));

  const stockReturn20d = finitePositiveFeature(benchmarkValues?.stockReturn20d);
  const benchmarkReturn20d = finitePositiveFeature(benchmarkValues?.benchmarkReturn20d);
  const relativeReturn20d = pickFiniteFeature(benchmarkValues?.relativeReturn20d);
  const high60d = pickFiniteFeature(priceValues?.high60d, pullbackValues?.high60d);
  const currentPrice = pickFiniteFeature(priceValues?.currentPrice, falseBreakoutValues?.currentPrice);
  const out: GatePositiveQuoteFeatures = {};

  const pairs: Array<[string, unknown]> = [
    ["price", currentPrice],
    ["currentPrice", currentPrice],
    ["return5d", momentumValues?.return5d],
    ["return20d", stockReturn20d ?? momentumValues?.return20d],
    ["relativeReturn20d", relativeReturn20d],
    ["marketRelativeReturn", relativeReturn20d],
    ["kospiRelativeReturn", relativeReturn20d],
    ["kospi20dReturn", benchmarkReturn20d],
    ["benchmarkReturn20d", benchmarkReturn20d],
    ["high5d", priceValues?.high5d],
    ["high20d", priceValues?.high20d],
    ["high20", priceValues?.high20d],
    ["high55d", high60d],
    ["high60", high60d],
    ["high60d", high60d],
    ["low20d", priceValues?.low20d],
    ["low60d", priceValues?.low60d],
    ["volume", volumeValues?.volume],
    ["avgVolume", pickFiniteFeature(volumeValues?.avgVolume20d, volumeValues?.avgVolume)],
    ["avgVolume20d", volumeValues?.avgVolume20d],
    ["volumeRatio", volumeValues?.volumeRatio],
    ["ma20", pickFiniteFeature(pullbackValues?.ma20, falseBreakoutValues?.ma20)],
    ["ma60", pullbackValues?.ma60],
    ["rsi14", momentumValues?.rsi14],
    ["macdHistogram", momentumValues?.macdHistogram],
    ["bbWidthCurrent", volumeValues?.bbWidth],
    ["atr", volumeValues?.atr14],
    ["atr20avg", volumeValues?.atr14],
  ];

  for (const [key, value] of pairs) {
    const finite = finitePositiveFeature(value);
    if (finite !== undefined) out[key] = finite;
  }
  return out;
}

export function extractGateLayerBreakoutSignals(source: unknown): Record<string, unknown> {
  const root = asRecord(source) ?? {};
  const gateLayer = asRecord(root.gateLayerSummary) ?? root;
  const gate3External =
    firstRecordByPath(root, [
      "gate3ExternalDataCoverage",
      "gateLayerSummary.gate3.externalDataCoverage",
      "gate3.externalDataCoverage",
      "externalDataCoverage.gate3",
    ]) ??
    firstRecordByPath(gateLayer, ["gate3.externalDataCoverage"]);
  const out: Record<string, unknown> = {};

  const turtle = gateStatusObject(readPath(gate3External, "priceStructure.turtle"));
  if (turtle) out.turtle_high = turtle;

  const priceBreakout = gateStatusObject(readPath(gate3External, "priceStructure.breakout"));
  if (priceBreakout) out.near_20d_high = priceBreakout;

  const volumeBreakout = gateStatusObject(readPath(gate3External, "volumeTiming.breakoutVolume"));
  if (volumeBreakout) out.volume_breakout = volumeBreakout;

  const vcp = gateStatusObject(readPath(gate3External, "volumeTiming.vcp"));
  if (vcp) out.vcp = vcp;

  const shortMomentum = gateStatusObject(readPath(gate3External, "momentumIndicators.shortMomentum"));
  if (shortMomentum) {
    out.breakout_momentum = shortMomentum;
    out.trend_acceleration = shortMomentum;
  }

  return out;
}

export function conditionTraceValue(source: unknown, key: string): unknown {
  const rows = readPath(source, "conditionResultsTrace");
  if (!Array.isArray(rows)) return undefined;
  const found = rows.find((row) => {
    const record = asRecord(row);
    return typeof record?.key === "string" && record.key.toLowerCase() === key.toLowerCase();
  });
  return found;
}
