// @responsibility ADR-0490 ProgramTrading data line; diagnostic-only program net-buy normalization, no order path changes.

type ProgramTradingDataLineStatusAdr0490 = 'READY' | 'EMPTY' | 'DATA_UNAVAILABLE' | 'PROVIDER_ERROR' | 'UNKNOWN';
type ProgramTradingSignalAdr0490 = 'BULLISH' | 'BEARISH' | 'UNKNOWN';

interface ProgramTradingDataPointAdr0490 {
  symbol: string;
  provider: 'KIS' | 'KRX' | 'CACHE' | 'UNKNOWN';
  sourceDate: string | null;
  programNetBuy: number | null;
  arbitrageNetBuy: number | null;
  nonArbitrageNetBuy: number | null;
  signal: ProgramTradingSignalAdr0490;
  status: ProgramTradingDataLineStatusAdr0490;
  diagnostics: string[];
}

export interface ProgramTradingDataLineReportAdr0490 {
  generatedAt: string;
  status: ProgramTradingDataLineStatusAdr0490;
  rows: ProgramTradingDataPointAdr0490[];
  domains: ['PROGRAM'];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE';
  operatorApprovalRequired: true;
  rawPayloadPersistenceAllowed: false;
  diagnostics: string[];
}

export interface ProgramTradingDataLineInputAdr0490 {
  generatedAt?: string;
  rows?: readonly Partial<ProgramTradingDataPointAdr0490>[];
  providerIssue?: boolean;
  diagnostics?: readonly string[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function deriveSignal(row: Partial<ProgramTradingDataPointAdr0490>): ProgramTradingSignalAdr0490 {
  if (row.signal === 'BULLISH' || row.signal === 'BEARISH') return row.signal;
  const program = finite(row.programNetBuy);
  if (program === null) return 'UNKNOWN';
  if (program > 0) return 'BULLISH';
  if (program < 0) return 'BEARISH';
  return 'UNKNOWN';
}

export function buildProgramTradingDataLineReportAdr0490(
  input: ProgramTradingDataLineInputAdr0490 = {},
): ProgramTradingDataLineReportAdr0490 {
  const rows = (input.rows ?? []).map((row, index): ProgramTradingDataPointAdr0490 => {
    const signal = deriveSignal(row);
    return {
      symbol: row.symbol ?? `PROGRAM_${index + 1}`,
      provider: row.provider ?? 'UNKNOWN',
      sourceDate: row.sourceDate ?? null,
      programNetBuy: finite(row.programNetBuy),
      arbitrageNetBuy: finite(row.arbitrageNetBuy),
      nonArbitrageNetBuy: finite(row.nonArbitrageNetBuy),
      signal,
      status: row.status ?? (signal === 'UNKNOWN' ? 'DATA_UNAVAILABLE' : 'READY'),
      diagnostics: [...(row.diagnostics ?? [])],
    };
  });
  const status: ProgramTradingDataLineStatusAdr0490 = rows.some((row) => row.status === 'READY')
    ? 'READY'
    : input.providerIssue
      ? 'PROVIDER_ERROR'
      : rows.length > 0
        ? 'DATA_UNAVAILABLE'
        : 'EMPTY';
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status,
    rows,
    domains: ['PROGRAM'],
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'OBSERVE',
    operatorApprovalRequired: true,
    rawPayloadPersistenceAllowed: false,
    diagnostics: [...(input.diagnostics ?? [])],
  };
}

export function formatProgramTradingDataLineCompactAdr0490(report: ProgramTradingDataLineReportAdr0490): string {
  return `ADR-0490 ProgramTrading: ${report.status} | rows=${report.rows.length} | impact=${report.executionImpact}`;
}
