// @responsibility Pure formatters for normal supply preview diagnostics.
import type {
  ActivePassiveConfluence,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowSignal,
} from "../normalSupplyPreview.js";

function escapeHtmlText(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activeDirection(
  foreign?: number,
  institution?: number,
): "BUY" | "SELL" | "NEUTRAL" {
  if (
    foreign !== undefined &&
    institution !== undefined &&
    foreign > 0 &&
    institution > 0
  )
    return "BUY";
  if (
    foreign !== undefined &&
    institution !== undefined &&
    foreign < 0 &&
    institution < 0
  )
    return "SELL";
  return "NEUTRAL";
}

export function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function formatReasonDistribution(
  distribution: Record<string, number>,
): string {
  const entries = Object.entries(distribution).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return entries.length > 0
    ? entries.map(([reason, count]) => `${reason}=${count}`).join(", ")
    : "none";
}

export function formatSampleList(samples: string[]): string {
  return samples.length > 0
    ? samples
        .map((sample, index) => `${index + 1}. "${escapeHtmlText(sample)}"`)
        .join("\n  ")
    : "none";
}

export function formatStockProgramFieldKeysTop(
  keys: string[],
  counts: Record<string, number>,
): string {
  if (keys.length === 0) return "none";
  return keys
    .slice(0, 8)
    .map((key) => `${key}=${counts[key] ?? 0}`)
    .join(", ");
}

export function formatAvailabilityLine(
  label: string,
  value: number,
  total: number,
): string {
  return `  ${label}: ${value}/${total}`;
}

export function formatAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  return Math.trunc(value).toLocaleString("en-US");
}

export function nextActionForProgramReason(
  reason: string,
): ProgramFlowDiagnosticsSummary["nextAction"] {
  if (reason === "PROGRAM_FLOW_CONTEXT_NOT_FOUND")
    return "WIRE_PROGRAM_FLOW_CONTEXT_TO_PREVIEW";
  if (reason === "PROGRAM_FLOW_WIRED_BUT_NO_FIELDS")
    return "WIRE_UPSTREAM_PROGRAM_NUMERIC_FIELDS_TO_CONTEXT";
  if (reason === "PROGRAM_FLOW_WIRED_BUT_ALL_NA")
    return "MAP_PROGRAM_NUMERIC_FIELD_ALIASES";
  if (reason === "PROGRAM_UPSTREAM_SNAPSHOT_CACHE_MISSING")
    return "INSTALL_INTRADAY_PROGRAM_FLOW_SNAPSHOT_CAPTURE";
  if (reason === "PROGRAM_UPSTREAM_VALUE_MISSING")
    return "CAPTURE_INTRADAY_PROGRAM_FLOW_VALUES";
  if (reason === "PROGRAM_SNAPSHOT_VALUE_NULL")
    return "STORE_PROGRAM_NETBUY_NUMERIC_IN_INTRADAY_SNAPSHOT";
  if (reason === "PROGRAM_CACHE_VALUE_NOT_CARRIED")
    return "WIRE_PROGRAM_CACHE_TO_NORMAL_SUPPLY_PREVIEW";
  if (reason === "PROGRAM_TRADING_VALUE_NOT_CARRIED")
    return "WIRE_PROGRAM_TRADING_CONTEXT_TO_PREVIEW";
  if (reason === "MARKET_PROGRAM_AVAILABLE_STOCK_PROGRAM_MISSING")
    return "OBSERVE_MARKET_PROGRAM_PROXY_AND_CAPTURE_STOCK_PROGRAM";
  if (reason === "PROGRAM_VALUE_PLACEHOLDER_ONLY")
    return "CAPTURE_INTRADAY_PROGRAM_FLOW_VALUES";
  if (reason === "PROGRAM_VALUE_UNIT_NORMALIZATION_REQUIRED")
    return "ADD_PROGRAM_VALUE_UNIT_PARSER_OR_STORE_NUMERIC_VALUE";
  if (reason === "PROGRAM_VALUE_UNSUPPORTED_FORMAT")
    return "STORE_PROGRAM_NETBUY_AS_NUMERIC_FIELD";
  if (reason === "PROGRAM_VALUE_NORMALIZATION_REQUIRED")
    return "STORE_PROGRAM_NETBUY_AS_NUMERIC_FIELD";
  if (reason === "PROGRAM_CONTEXT_HAS_STATUS_ONLY")
    return "WIRE_MARKET_PROGRAM_NUMERIC_NETBUY_FIELDS";
  if (reason === "PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY")
    return "CAPTURE_INTRADAY_PROGRAM_FLOW_VALUES";
  if (reason === "PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY")
    return "OBSERVE_PROGRAM_FLOW_PROXY";
  return "WIRE_STOCK_AND_MARKET_PROGRAM_FLOW_FIELDS";
}

export function classifyActivePassiveConfluence(input: {
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  passiveProxySignal: ProgramFlowSignal;
}): ActivePassiveConfluence {
  const active = activeDirection(input.foreignNetBuy, input.institutionNetBuy);
  const passive =
    input.passiveProxySignal === "BULLISH"
      ? "BUY"
      : input.passiveProxySignal === "BEARISH"
        ? "SELL"
        : input.passiveProxySignal === "NEUTRAL"
          ? "NEUTRAL"
          : "UNAVAILABLE";
  if (active === "BUY" && passive === "BUY")
    return "ACTIVE_PASSIVE_CONFIRMED_BUY";
  if (active === "SELL" && passive === "SELL")
    return "ACTIVE_PASSIVE_CONFIRMED_SELL";
  if (active === "BUY" && passive === "UNAVAILABLE")
    return "ACTIVE_BUYING_ONLY";
  if (active === "SELL" && passive === "UNAVAILABLE")
    return "ACTIVE_SELLING_ONLY";
  if (active === "NEUTRAL" && passive === "BUY") return "PASSIVE_BUYING_ONLY";
  if (active === "NEUTRAL" && passive === "SELL") return "PASSIVE_SELLING_ONLY";
  if (
    (active === "BUY" && passive === "SELL") ||
    (active === "SELL" && passive === "BUY")
  )
    return "MIXED_FLOW";
  if (passive === "UNAVAILABLE") return "PROGRAM_FLOW_UNAVAILABLE";
  return "NEUTRAL_FLOW";
}

export function describeActiveFlow(
  foreign?: number,
  institution?: number,
): string {
  const active = activeDirection(foreign, institution);
  if (active === "BUY") return "외인+기관 동반 순매수";
  if (active === "SELL") return "외인+기관 동반 순매도";
  if ((foreign ?? 0) > 0) return "외인 순매수 우위";
  if ((institution ?? 0) > 0) return "기관 순매수 우위";
  return "NEUTRAL_FLOW";
}

export function describeProgramSignal(signal: ProgramFlowSignal): string {
  if (signal === "BULLISH") return "PROGRAM_PASSIVE_PROXY_BUY";
  if (signal === "BEARISH") return "PROGRAM_PASSIVE_PROXY_SELL";
  if (signal === "NEUTRAL") return "PROGRAM_PASSIVE_PROXY_NEUTRAL";
  if (signal === "UNKNOWN") return "PROGRAM_FLOW_UNKNOWN";
  return "PROGRAM_FLOW_UNAVAILABLE";
}
