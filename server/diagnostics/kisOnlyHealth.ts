// @responsibility KIS-only rebuild mode diagnostic: KIS raw → normalized → domain sample visibility without legacy providers.

import {
  fetchCurrentPrice,
  fetchKisDailyCreditBalance,
  fetchKisDailyLoanTransaction,
  fetchKisDailyShortSale,
  fetchKisForeignInstitutionTotal,
  fetchKisInvestorFlow,
  fetchKisInvestorTradeByStockDaily,
  fetchKisMarketProgramTrade,
  fetchKisMarketSupply,
  fetchKisPrevClose,
  fetchKisStockProgramTrade,
  type KisDailyCreditBalance,
  type KisDailyLoanTransaction,
  type KisDailyShortSale,
  type KisForeignInstitutionTotal,
  type KisInvestorFlow,
  type KisInvestorTradeByStockDaily,
  type KisMarketProgramTrade,
  type KisStockProgramTrade,
  type PrevClose,
} from '../clients/kisClient/index.js';
import {
  diagnoseKisInvestorFlowRaw,
  diagnoseKisInvestorEndpointTraces,
  diagnoseKisMarketProgramRaw,
  diagnoseKisShortSaleDateTraces,
  diagnoseKisStockProgramRaw,
  type KisEndpointBlockedReason,
  type KisEndpointTrace,
  type KisRawSupplyDiagnostic,
  type KisShortDateTrace,
} from '../clients/kisClient/supplyDiagnostics.js';
import { classifyInvestorFlowMarketSession, previousInvestorFlowTradingDate } from '../supply/investorFlowProviderHealth.js';
import { buildKisSectorEnergyInputsWithMeta } from '../clients/kisSectorEnergyProvider.js';
import { fetchKisDailyCandles, type KisChartCandle } from '../screener/kisChartDataFetcher.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';

export type KisOnlyMode = 'KIS_ONLY_REBUILD';
export type KisParserDiagnosticStatus =
  | 'HTTP_OK_BUT_EMPTY'
  | 'HTTP_OK_FIELD_MISMATCH'
  | 'HTTP_OK_MATERIALIZED'
  | 'HTTP_ERROR'
  | 'SESSION_UNAVAILABLE'
  | 'PARAM_ERROR';

export interface KisOnlyHealthReport {
  mode: KisOnlyMode;
  generatedAt: string;
  targetCodes: string[];
  price: {
    status: 'OK' | 'PARTIAL' | 'MISSING' | 'ERROR';
    currentPriceCount: number;
    prevCloseCount: number;
    dailyChartCount: number;
    failedCodes: string[];
  };
  investorFlow: {
    status: 'OK' | 'PARTIAL' | 'MISSING' | 'FIELD_MISMATCH' | 'ERROR';
    sourceTried: Array<
      'INQUIRE_INVESTOR' |
      'INVESTOR_TRADE_BY_STOCK_DAILY' |
      'FOREIGN_INSTITUTION_TOTAL' |
      'INVESTOR_TREND_ESTIMATE'
    >;
    materializedCount: number;
    fieldMismatchCount: number;
    missingCount: number;
    parserStatuses: KisParserDiagnosticStatus[];
    reasonSummary?: Record<string, Record<KisEndpointBlockedReason, number>>;
    endpointTraces?: KisEndpointTrace[];
    sampleRows: Array<{
      stockCode: string;
      sourceKind: string;
      foreignNetBuy?: number;
      institutionalNetBuy?: number;
      individualNetBuy?: number;
      confidence: 'VERIFIED' | 'DEGRADED' | 'ESTIMATED';
      blockedReason?: string;
    }>;
  };
  program: {
    stockProgram: {
      status: 'OK' | 'PARTIAL' | 'EMPTY' | 'FIELD_MISMATCH' | 'ERROR' | 'SESSION_UNAVAILABLE' | 'EXPECTED_EMPTY_OFF_SESSION';
      currentSession?: string;
      nextValidSession?: 'REGULAR';
      providerIssue?: boolean;
      materializedCount: number;
      emptyCount: number;
      fieldMismatchCount: number;
      parserStatuses: KisParserDiagnosticStatus[];
    };
    marketProgram: {
      status: 'OK' | 'EMPTY' | 'FIELD_MISMATCH' | 'ERROR' | 'EXPECTED_EMPTY_OFF_SESSION';
      programNetBuyAmount?: number;
      programArbitrageNetBuy?: number;
      programNonArbitrageNetBuy?: number;
      blockedReason?: string;
      parserStatus: KisParserDiagnosticStatus;
      parserSource?: 'programMaterializer';
    };
  };
  shortCredit: {
    short: 'OK' | 'MISSING' | 'ERROR' | 'MISSING_CONFIRMED';
    shortTrace?: { triedDates: string[]; traces: KisShortDateTrace[] };
    loan: 'OK' | 'FLAT' | 'MISSING' | 'ERROR';
    credit: 'OK' | 'FLAT' | 'MISSING' | 'ERROR';
  };
  sectorBasket: {
    status: 'OK' | 'PARTIAL' | 'MISSING';
    basketRows: number;
    validPriceCount: number;
  };
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export interface KisOnlyHealthFetchers {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchPrevClose?: (code: string) => Promise<PrevClose | null>;
  fetchDailyChart?: (code: string) => Promise<KisChartCandle[]>;
  fetchMarketSupply?: () => Promise<{ foreignNetBuy: number; institutionNetBuy: number; individualNetBuy: number } | null>;
  fetchInvestorFlow?: (code: string) => Promise<KisInvestorFlow | null>;
  fetchInvestorFlowDaily?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  fetchForeignInstitutionTotal?: () => Promise<KisForeignInstitutionTotal | null>;
  fetchStockProgramTrade?: (code: string) => Promise<KisStockProgramTrade | null>;
  fetchMarketProgramTrade?: () => Promise<KisMarketProgramTrade | null>;
  fetchShortSelling?: (code: string) => Promise<KisDailyShortSale | null>;
  fetchLoanTransaction?: (code: string) => Promise<KisDailyLoanTransaction | null>;
  fetchCreditBalance?: (code: string) => Promise<KisDailyCreditBalance | null>;
  diagnoseInvestorFlowRaw?: (code: string) => Promise<KisRawSupplyDiagnostic>;
  diagnoseStockProgramRaw?: (code: string) => Promise<KisRawSupplyDiagnostic>;
  diagnoseMarketProgramRaw?: () => Promise<KisRawSupplyDiagnostic>;
  diagnoseInvestorEndpointTraces?: (code: string) => Promise<KisEndpointTrace[]>;
  diagnoseShortDateTraces?: (code: string, tradingDates: string[]) => Promise<KisShortDateTrace[]>;
  buildSectorBasket?: () => Promise<{ basketRows: number; validPriceCount: number }>;
}

const DEFAULT_TARGET_LIMIT = 10;
const FALLBACK_TARGET = '005930';

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}


function isKisOnlyTraceEnabled(): boolean {
  return process.env.KIS_ONLY_TRACE === 'true';
}

function addReason(summary: Record<string, Record<KisEndpointBlockedReason, number>>, trace: KisEndpointTrace): void {
  const source = summary[trace.sourceKind] ?? {};
  source[trace.blockedReason] = (source[trace.blockedReason] ?? 0) + 1;
  summary[trace.sourceKind] = source;
}

function previousTradingDates(now: Date, count: number): string[] {
  const dates: string[] = [];
  let cursor = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  while (dates.length < count) {
    cursor = previousInvestorFlowTradingDate(cursor);
    dates.push(cursor);
  }
  return dates;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasAnyFinite(...values: unknown[]): boolean {
  return values.some(finite);
}

function isFlat(...values: unknown[]): boolean {
  const nums = values.filter(finite);
  return nums.length > 0 && nums.every((value) => value === 0);
}

function sortedWatchlistTargets(limit: number): string[] {
  const rows = [...loadWatchlist()]
    .sort((a: WatchlistEntry, b: WatchlistEntry) => Number((b as any).stage2Score ?? 0) - Number((a as any).stage2Score ?? 0))
    .map((row) => normalizeCode(row.code))
    .filter(Boolean);
  return [...new Set(rows)].slice(0, limit);
}

export function isKisOnlyRebuildMode(): boolean {
  return process.env.KIS_ONLY_REBUILD_MODE === 'true';
}

export function resolveKisOnlyTargets(input?: { targetCodes?: string[]; limit?: number }): string[] {
  const explicit = (input?.targetCodes ?? []).map(normalizeCode).filter(Boolean);
  const targets = explicit.length > 0 ? explicit : sortedWatchlistTargets(input?.limit ?? DEFAULT_TARGET_LIMIT);
  return targets.length > 0 ? targets : [FALLBACK_TARGET];
}

export function classifyKisRawParserStatus(diag: KisRawSupplyDiagnostic | null | undefined): KisParserDiagnosticStatus {
  if (!diag) return 'HTTP_ERROR';
  if (diag.zeroReason === 'SESSION_UNAVAILABLE') return 'SESSION_UNAVAILABLE';
  if (diag.zeroReason === 'PARAM_ERROR') return 'PARAM_ERROR';
  if (!diag.ok || diag.zeroReason === 'FETCH_FAIL' || diag.zeroReason === 'PROVIDER_ERROR') return 'HTTP_ERROR';
  if (diag.zeroReason === 'FIELD_MISSING') return 'HTTP_OK_FIELD_MISMATCH';
  if (diag.zeroReason === 'NO_OUTPUT' || diag.zeroReason === 'OUTPUT_EMPTY' || diag.zeroReason === 'ACCEPTED_EMPTY') return 'HTTP_OK_BUT_EMPTY';
  if (Object.values(diag.parsed).some(finite)) return 'HTTP_OK_MATERIALIZED';
  return 'HTTP_OK_FIELD_MISMATCH';
}

function hasInvestorFields(value: KisInvestorFlow | KisInvestorTradeByStockDaily | null): boolean {
  return !!value && hasAnyFinite(value.foreignNetBuy, value.institutionalNetBuy, value.individualNetBuy);
}

function hasVerifiedInvestorFields(value: KisInvestorFlow | KisInvestorTradeByStockDaily | null): boolean {
  return !!value && finite(value.foreignNetBuy) && finite(value.institutionalNetBuy);
}

function stockProgramMaterialized(value: KisStockProgramTrade | null): boolean {
  return !!value && hasAnyFinite(value.programNetBuyAmount, value.programNetBuyQty, value.programBuyRatio);
}

function marketProgramMaterialized(value: KisMarketProgramTrade | null): boolean {
  return !!value && hasAnyFinite(
    value.programNetBuyAmount,
    value.programArbitrageNetBuy,
    value.programNonArbitrageNetBuy,
    value.programBuyAmount,
    value.programSellAmount,
  );
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function defaultSectorBasket(): Promise<{ basketRows: number; validPriceCount: number }> {
  const result = await buildKisSectorEnergyInputsWithMeta({ fetchInvestorFlow: undefined });
  const basketRows = Number(result.diagnostics.find((line) => line.startsWith('basketRows='))?.split('=')[1] ?? result.validSectorCount ?? 0);
  const validPriceCount = result.inputs.reduce((sum, input) => sum + Number((input as any).constituentCount ?? 0), 0);
  return { basketRows, validPriceCount };
}

function usedFetchers(fetchers: KisOnlyHealthFetchers): Required<KisOnlyHealthFetchers> {
  return {
    fetchCurrentPrice,
    fetchPrevClose: fetchKisPrevClose,
    fetchDailyChart: (code) => fetchKisDailyCandles(code, 40),
    fetchMarketSupply: fetchKisMarketSupply,
    fetchInvestorFlow: (code) => fetchKisInvestorFlow(code, 'LOW'),
    fetchInvestorFlowDaily: fetchKisInvestorTradeByStockDaily,
    fetchForeignInstitutionTotal: fetchKisForeignInstitutionTotal,
    fetchStockProgramTrade: fetchKisStockProgramTrade,
    fetchMarketProgramTrade: fetchKisMarketProgramTrade,
    fetchShortSelling: fetchKisDailyShortSale,
    fetchLoanTransaction: fetchKisDailyLoanTransaction,
    fetchCreditBalance: fetchKisDailyCreditBalance,
    diagnoseInvestorFlowRaw: (code) => diagnoseKisInvestorFlowRaw(code, 'LOW'),
    diagnoseStockProgramRaw: (code) => diagnoseKisStockProgramRaw(code, 'LOW'),
    diagnoseMarketProgramRaw: () => diagnoseKisMarketProgramRaw('LOW'),
    diagnoseInvestorEndpointTraces: (code) => diagnoseKisInvestorEndpointTraces(code, 'LOW'),
    diagnoseShortDateTraces: (code, tradingDates) => diagnoseKisShortSaleDateTraces(code, tradingDates, 'LOW'),
    buildSectorBasket: defaultSectorBasket,
    ...fetchers,
  };
}

export async function buildKisOnlyHealthReport(input: {
  targetCodes?: string[];
  limit?: number;
  now?: Date;
  fetchers?: KisOnlyHealthFetchers;
} = {}): Promise<KisOnlyHealthReport> {
  const now = input.now ?? new Date();
  const targetCodes = resolveKisOnlyTargets(input);
  const f = usedFetchers(input.fetchers ?? {});
  const traceEnabled = isKisOnlyTraceEnabled();
  const currentSession = classifyInvestorFlowMarketSession(now);
  const investorReasonSummary: Record<string, Record<KisEndpointBlockedReason, number>> = {};
  const investorEndpointTraces: KisEndpointTrace[] = [];
  const shortTriedDates = previousTradingDates(now, 3);
  const shortDateTraces: KisShortDateTrace[] = [];

  let currentPriceCount = 0;
  let prevCloseCount = 0;
  let dailyChartCount = 0;
  const failedCodes = new Set<string>();
  let priceErrors = 0;

  let investorMaterialized = 0;
  let investorFieldMismatch = 0;
  let investorMissing = 0;
  let investorErrors = 0;
  const investorParserStatuses: KisParserDiagnosticStatus[] = [];
  const sampleRows: KisOnlyHealthReport['investorFlow']['sampleRows'] = [];

  let stockProgramMaterializedCount = 0;
  let stockProgramEmptyCount = 0;
  let stockProgramFieldMismatchCount = 0;
  let stockProgramErrors = 0;
  const stockProgramParserStatuses: KisParserDiagnosticStatus[] = [];

  let shortStatus: KisOnlyHealthReport['shortCredit']['short'] = 'MISSING';
  let loanStatus: KisOnlyHealthReport['shortCredit']['loan'] = 'MISSING';
  let creditStatus: KisOnlyHealthReport['shortCredit']['credit'] = 'MISSING';

  const foreignInstitution = await safe(() => f.fetchForeignInstitutionTotal());
  const marketSupply = await safe(() => f.fetchMarketSupply());
  const foreignInstitutionOk = foreignInstitution.ok && !!foreignInstitution.value && hasAnyFinite(foreignInstitution.value.foreignNetBuy, foreignInstitution.value.institutionalNetBuy);
  const marketSupplyOk = marketSupply.ok && !!marketSupply.value && hasAnyFinite(marketSupply.value.foreignNetBuy, marketSupply.value.institutionNetBuy, marketSupply.value.individualNetBuy);

  await Promise.all(targetCodes.map(async (code) => {
    const [price, prevClose, dailyChart, strictFlow, dailyFlow, investorRaw, investorTraces, stockProgram, stockProgramRaw, short, loan, credit] = await Promise.all([
      safe(() => f.fetchCurrentPrice(code)),
      safe(() => f.fetchPrevClose(code)),
      safe(() => f.fetchDailyChart(code)),
      safe(() => f.fetchInvestorFlow(code)),
      safe(() => f.fetchInvestorFlowDaily(code)),
      safe(() => f.diagnoseInvestorFlowRaw(code)),
      traceEnabled ? safe(() => f.diagnoseInvestorEndpointTraces(code)) : Promise.resolve({ ok: true as const, value: [] as KisEndpointTrace[] }),
      safe(() => f.fetchStockProgramTrade(code)),
      safe(() => f.diagnoseStockProgramRaw(code)),
      safe(() => f.fetchShortSelling(code)),
      safe(() => f.fetchLoanTransaction(code)),
      safe(() => f.fetchCreditBalance(code)),
    ]);

    if (price.ok && finite(price.value) && price.value > 0) currentPriceCount++; else { failedCodes.add(code); if (!price.ok) priceErrors++; }
    if (prevClose.ok && prevClose.value && finite(prevClose.value.prevClose) && prevClose.value.prevClose > 0) prevCloseCount++;
    if (dailyChart.ok && Array.isArray(dailyChart.value) && dailyChart.value.length > 0) dailyChartCount++; else if (!dailyChart.ok) priceErrors++;

    if (investorRaw.ok) investorParserStatuses.push(classifyKisRawParserStatus(investorRaw.value)); else investorErrors++;
    if (investorTraces.ok) {
      investorEndpointTraces.push(...investorTraces.value);
      for (const trace of investorTraces.value) addReason(investorReasonSummary, trace);
    }
    const selectedFlow = hasInvestorFields(dailyFlow.ok ? dailyFlow.value : null)
      ? { value: dailyFlow.ok ? dailyFlow.value : null, sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY' }
      : { value: strictFlow.ok ? strictFlow.value : null, sourceKind: 'INQUIRE_INVESTOR' };
    if (hasInvestorFields(selectedFlow.value)) {
      investorMaterialized++;
      sampleRows.push({
        stockCode: code,
        sourceKind: selectedFlow.sourceKind,
        ...(finite(selectedFlow.value?.foreignNetBuy) ? { foreignNetBuy: selectedFlow.value.foreignNetBuy } : {}),
        ...(finite(selectedFlow.value?.institutionalNetBuy) ? { institutionalNetBuy: selectedFlow.value.institutionalNetBuy } : {}),
        ...(finite(selectedFlow.value?.individualNetBuy) ? { individualNetBuy: selectedFlow.value.individualNetBuy } : {}),
        confidence: hasVerifiedInvestorFields(selectedFlow.value) ? 'VERIFIED' : 'DEGRADED',
      });
    } else if (investorRaw.ok && classifyKisRawParserStatus(investorRaw.value) === 'HTTP_OK_FIELD_MISMATCH') {
      investorFieldMismatch++;
      sampleRows.push({ stockCode: code, sourceKind: 'INQUIRE_INVESTOR', confidence: 'DEGRADED', blockedReason: 'HTTP_OK_FIELD_MISMATCH' });
    } else if (!strictFlow.ok || !dailyFlow.ok || !investorRaw.ok) {
      investorErrors++;
    } else {
      investorMissing++;
    }

    if (stockProgramRaw.ok) stockProgramParserStatuses.push(classifyKisRawParserStatus(stockProgramRaw.value)); else stockProgramErrors++;
    if (stockProgram.ok && stockProgramMaterialized(stockProgram.value)) stockProgramMaterializedCount++;
    else if (stockProgramRaw.ok && classifyKisRawParserStatus(stockProgramRaw.value) === 'HTTP_OK_FIELD_MISMATCH') stockProgramFieldMismatchCount++;
    else if (stockProgram.ok) stockProgramEmptyCount++;
    else stockProgramErrors++;

    if (traceEnabled) {
      const traces = await safe(() => f.diagnoseShortDateTraces(code, shortTriedDates));
      if (traces.ok) shortDateTraces.push(...traces.value);
    }
    if (short.ok && short.value && hasAnyFinite(short.value.shortSaleQty, short.value.shortSaleAmount, short.value.shortSaleRatio)) shortStatus = 'OK';
    else if (!short.ok) shortStatus = 'ERROR';
    if (loan.ok && loan.value && hasAnyFinite(loan.value.loanBalanceQty, loan.value.loanBalanceAmount, loan.value.loanIncreaseRate)) loanStatus = isFlat(loan.value.loanBalanceQty, loan.value.loanBalanceAmount, loan.value.loanIncreaseRate) ? 'FLAT' : 'OK';
    else if (!loan.ok) loanStatus = 'ERROR';
    if (credit.ok && credit.value && hasAnyFinite(credit.value.creditBalanceQty, credit.value.creditBalanceAmount, credit.value.creditIncreaseRate)) creditStatus = isFlat(credit.value.creditBalanceQty, credit.value.creditBalanceAmount, credit.value.creditIncreaseRate) ? 'FLAT' : 'OK';
    else if (!credit.ok) creditStatus = 'ERROR';
  }));

  if (investorMaterialized === 0 && marketSupplyOk) {
    sampleRows.push({
      stockCode: 'MARKET',
      sourceKind: 'KIS_MARKET_SUPPLY_DIAGNOSTIC_ONLY',
      ...(marketSupply.ok && finite(marketSupply.value?.foreignNetBuy) ? { foreignNetBuy: marketSupply.value.foreignNetBuy } : {}),
      ...(marketSupply.ok && finite(marketSupply.value?.institutionNetBuy) ? { institutionalNetBuy: marketSupply.value.institutionNetBuy } : {}),
      ...(marketSupply.ok && finite(marketSupply.value?.individualNetBuy) ? { individualNetBuy: marketSupply.value.individualNetBuy } : {}),
      confidence: 'DEGRADED',
      blockedReason: 'marketSupply cannot become symbol investorFlow',
    });
  }

  const marketProgramRaw = await safe(() => f.diagnoseMarketProgramRaw());
  const marketProgram = await safe(() => f.fetchMarketProgramTrade());
  const marketProgramParserStatus = marketProgramRaw.ok ? classifyKisRawParserStatus(marketProgramRaw.value) : 'HTTP_ERROR';
  const sectorBasket = await safe(() => f.buildSectorBasket());

  const priceStatus: KisOnlyHealthReport['price']['status'] = priceErrors > 0 && currentPriceCount === 0 && dailyChartCount === 0
    ? 'ERROR'
    : currentPriceCount === targetCodes.length && dailyChartCount === targetCodes.length
      ? 'OK'
      : currentPriceCount > 0 || dailyChartCount > 0 || prevCloseCount > 0
        ? 'PARTIAL'
        : 'MISSING';
  const investorStatus: KisOnlyHealthReport['investorFlow']['status'] = investorErrors > 0 && investorMaterialized === 0
    ? 'ERROR'
    : investorMaterialized === targetCodes.length
      ? 'OK'
      : investorMaterialized > 0
        ? 'PARTIAL'
        : investorFieldMismatch > 0
          ? 'FIELD_MISMATCH'
          : (foreignInstitutionOk ? 'PARTIAL' : 'MISSING');
  let stockProgramStatus: KisOnlyHealthReport['program']['stockProgram']['status'] = stockProgramErrors > 0 && stockProgramMaterializedCount === 0
    ? 'ERROR'
    : stockProgramMaterializedCount === targetCodes.length
      ? 'OK'
      : stockProgramMaterializedCount > 0
        ? 'PARTIAL'
        : stockProgramFieldMismatchCount > 0
          ? 'FIELD_MISMATCH'
          : 'EMPTY';
  if (currentSession !== 'REGULAR' && stockProgramMaterializedCount === 0) {
    stockProgramStatus = stockProgramErrors > 0 ? 'SESSION_UNAVAILABLE' : 'EXPECTED_EMPTY_OFF_SESSION';
  }
  let marketProgramStatus: KisOnlyHealthReport['program']['marketProgram']['status'] = !marketProgram.ok || !marketProgramRaw.ok
    ? 'ERROR'
    : marketProgramMaterialized(marketProgram.value)
      ? 'OK'
      : marketProgramParserStatus === 'HTTP_OK_FIELD_MISMATCH'
        ? 'FIELD_MISMATCH'
        : 'EMPTY';
  if (currentSession !== 'REGULAR' && marketProgramStatus === 'EMPTY') {
    marketProgramStatus = 'EXPECTED_EMPTY_OFF_SESSION';
  }
  if (traceEnabled && shortStatus === 'MISSING' && shortDateTraces.length > 0 && shortDateTraces.every((trace) => !trace.materialized)) {
    shortStatus = 'MISSING_CONFIRMED';
  }
  const providerIssue = priceStatus === 'ERROR'
    || investorStatus === 'ERROR'
    || stockProgramStatus === 'ERROR'
    || marketProgramStatus === 'ERROR';

  return {
    mode: 'KIS_ONLY_REBUILD',
    generatedAt: now.toISOString(),
    targetCodes,
    price: {
      status: priceStatus,
      currentPriceCount,
      prevCloseCount,
      dailyChartCount,
      failedCodes: [...failedCodes],
    },
    investorFlow: {
      status: investorStatus,
      sourceTried: ['INQUIRE_INVESTOR', 'INVESTOR_TRADE_BY_STOCK_DAILY', 'FOREIGN_INSTITUTION_TOTAL', 'INVESTOR_TREND_ESTIMATE'],
      materializedCount: investorMaterialized,
      fieldMismatchCount: investorFieldMismatch,
      missingCount: investorMissing,
      parserStatuses: investorParserStatuses,
      ...(traceEnabled ? { reasonSummary: investorReasonSummary, endpointTraces: investorEndpointTraces } : {}),
      sampleRows: sampleRows.slice(0, 5),
    },
    program: {
      stockProgram: {
        status: stockProgramStatus,
        ...(traceEnabled ? { currentSession, nextValidSession: 'REGULAR' as const, providerIssue: false } : {}),
        materializedCount: stockProgramMaterializedCount,
        emptyCount: stockProgramEmptyCount,
        fieldMismatchCount: stockProgramFieldMismatchCount,
        parserStatuses: stockProgramParserStatuses,
      },
      marketProgram: {
        status: marketProgramStatus,
        ...(marketProgram.ok && finite(marketProgram.value?.programNetBuyAmount) ? { programNetBuyAmount: marketProgram.value.programNetBuyAmount } : {}),
        ...(marketProgram.ok && finite(marketProgram.value?.programArbitrageNetBuy) ? { programArbitrageNetBuy: marketProgram.value.programArbitrageNetBuy } : {}),
        ...(marketProgram.ok && finite(marketProgram.value?.programNonArbitrageNetBuy) ? { programNonArbitrageNetBuy: marketProgram.value.programNonArbitrageNetBuy } : {}),
        ...(marketProgramStatus !== 'OK' ? { blockedReason: marketProgramParserStatus } : {}),
        parserStatus: marketProgramParserStatus,
        parserSource: 'programMaterializer',
      },
    },
    shortCredit: { short: shortStatus, ...(traceEnabled ? { shortTrace: { triedDates: shortTriedDates, traces: shortDateTraces } } : {}), loan: loanStatus, credit: creditStatus },
    sectorBasket: sectorBasket.ok
      ? {
          status: sectorBasket.value.basketRows > 0 && sectorBasket.value.validPriceCount > 0 ? 'OK' : sectorBasket.value.basketRows > 0 ? 'PARTIAL' : 'MISSING',
          basketRows: sectorBasket.value.basketRows,
          validPriceCount: sectorBasket.value.validPriceCount,
        }
      : { status: 'MISSING', basketRows: 0, validPriceCount: 0 },
    providerIssue,
    marketSignal: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
  };
}


function formatReasonCounts(counts: Record<string, number> | undefined, denominator: number): string {
  const entries = Object.entries(counts ?? {});
  return entries.length > 0
    ? entries.map(([reason, count]) => `${reason} ${count}/${denominator}`).join(', ')
    : `UNKNOWN 0/${denominator}`;
}

function formatInvestorFlowDetail(report: KisOnlyHealthReport): string[] {
  if (!report.investorFlow.reasonSummary) return [];
  const lines = ['INVESTOR_FLOW_DETAIL:'];
  for (const source of report.investorFlow.sourceTried) {
    lines.push(`  ${source}: ${formatReasonCounts(report.investorFlow.reasonSummary[source], report.targetCodes.length)}`);
  }

  const traces = report.investorFlow.endpointTraces ?? [];
  const exampleStockCodes = [...new Set(traces.map((trace) => trace.stockCode))].slice(0, 3);
  const examples = exampleStockCodes.flatMap((stockCode) => {
    const byCode = traces.filter((trace) => trace.stockCode === stockCode);
    const preferred = byCode.filter((trace) => !trace.materialized).slice(0, 2);
    return (preferred.length > 0 ? preferred : byCode.slice(0, 2));
  }).slice(0, 6);

  if (examples.length > 0) {
    lines.push('  examples:');
    for (const trace of examples) lines.push(...formatEndpointTraceExample(trace, '    '));
  }
  return lines;
}

function formatEndpointTraceExample(trace: KisEndpointTrace, indent = '  '): string[] {
  const outputKeys = (trace.outputKeys ?? []).slice(0, 12);
  return [
    `${indent}- ${trace.stockCode} / ${trace.sourceKind}:`,
    `${indent}    trId=${trace.trId}`,
    `${indent}    path=${trace.apiPath}`,
    `${indent}    params=${JSON.stringify(trace.params)}`,
    `${indent}    rt_cd=${trace.rtCd ?? 'n/a'} msg_cd=${trace.msgCd ?? 'n/a'}`,
    `${indent}    outputPath=${trace.outputPath ?? 'n/a'} rowCount=${trace.rowCount}`,
    `${indent}    targetFound=${trace.targetFound ?? 'n/a'}`,
    `${indent}    outputKeys=${outputKeys.join(',') || 'NONE'}`,
    `${indent}    parsedFields=${trace.parsedFields.join(',') || 'NONE'}`,
    `${indent}    materialized=${trace.materialized} blockedReason=${trace.blockedReason}`,
  ];
}

function formatShortDetail(report: KisOnlyHealthReport): string[] {
  const shortTrace = report.shortCredit.shortTrace;
  if (!shortTrace) return [];
  const lines = [
    'SHORT_DETAIL:',
    '  datePolicy=PREVIOUS_TRADING_DAY_THEN_T_MINUS_2_T_MINUS_3',
    `  triedDates=${shortTrace.triedDates.join(',')}`,
    '  results:',
  ];
  for (const date of shortTrace.triedDates) {
    const traces = shortTrace.traces.filter((trace) => trace.tradingDate === date);
    const reasonCounts: Record<string, number> = {};
    let rowCount = 0;
    let targetFound = 0;
    for (const trace of traces) {
      reasonCounts[trace.blockedReason] = (reasonCounts[trace.blockedReason] ?? 0) + 1;
      rowCount += trace.rowCount;
      if (trace.targetFound) targetFound++;
    }
    lines.push(`    ${date}: ${formatReasonCounts(reasonCounts, Math.max(traces.length, 1))} rowCount=${rowCount} targetFound=${targetFound}/${traces.length}`);
  }
  lines.push(`  finalStatus=${report.shortCredit.short}`);
  lines.push(`  providerIssue=${report.providerIssue}`);
  lines.push(`  marketSignal=${report.marketSignal}`);

  const examples = shortTrace.traces.filter((trace) => !trace.materialized).slice(0, 3);
  if (examples.length > 0) {
    lines.push('  examples:');
    for (const trace of examples) {
      lines.push(`    - ${trace.stockCode} / ${trace.tradingDate}: trId=${trace.trId} rowCount=${trace.rowCount} targetFound=${trace.targetFound ?? 'n/a'} blockedReason=${trace.blockedReason}`);
    }
  }
  return lines;
}

export function formatKisOnlyHealthReport(report: KisOnlyHealthReport): string {
  const tried = report.investorFlow.sourceTried.join(',');
  const stockTotal = report.targetCodes.length;
  const marketProgram = report.program.marketProgram;
  const marketProgramValue = finite(marketProgram.programNetBuyAmount)
    ? ` netBuyAmount=${marketProgram.programNetBuyAmount}`
    : marketProgram.blockedReason
      ? ` blockedReason=${marketProgram.blockedReason}`
      : '';
  const sample = report.investorFlow.sampleRows.length > 0
    ? report.investorFlow.sampleRows.map((row) => `${row.stockCode}:${row.sourceKind}:${row.confidence}${row.blockedReason ? `(${row.blockedReason})` : ''}`).join(' | ')
    : 'NONE';
  const investorDetailLines = formatInvestorFlowDetail(report);
  const stockProgram = report.program.stockProgram;
  const stockSession = stockProgram.currentSession ? ` currentSession=${stockProgram.currentSession} nextValidSession=${stockProgram.nextValidSession} providerIssue=${stockProgram.providerIssue}` : '';
  const shortTrace = report.shortCredit.shortTrace ? ` triedDates=${report.shortCredit.shortTrace.triedDates.join(',')}` : '';
  const shortDetailLines = formatShortDetail(report);
  return [
    'KIS Only Health',
    `Current Data Mode: ${report.mode}`,
    'Active Sources: KIS only',
    'Legacy Providers: disabled for current decision',
    `targets=${report.targetCodes.join(',')}`,
    `PRICE: ${report.price.status} current=${report.price.currentPriceCount}/${stockTotal} prevClose=${report.price.prevCloseCount}/${stockTotal} chart=${report.price.dailyChartCount}/${stockTotal}`,
    `INVESTOR_FLOW: ${report.investorFlow.status} materialized=${report.investorFlow.materializedCount} missing=${report.investorFlow.missingCount} fieldMismatch=${report.investorFlow.fieldMismatchCount} tried=${tried}`,
    ...(investorDetailLines.length > 0 ? investorDetailLines : []),
    `INVESTOR_FLOW_SAMPLE: ${sample}`,
    `PROGRAM_STOCK: ${stockProgram.status}${stockSession} ${stockProgram.materializedCount}/${stockTotal} empty=${stockProgram.emptyCount} fieldMismatch=${stockProgram.fieldMismatchCount}`,
    `PROGRAM_MARKET: ${marketProgram.status}${marketProgramValue} parserSource=${marketProgram.parserSource ?? 'unknown'}`,
    `SHORT: ${report.shortCredit.short}${shortTrace}`,
    ...(shortDetailLines.length > 0 ? shortDetailLines : []),
    `LOAN: ${report.shortCredit.loan}`,
    `CREDIT: ${report.shortCredit.credit}`,
    `SECTOR_BASKET: ${report.sectorBasket.status} rows=${report.sectorBasket.basketRows} validPrice=${report.sectorBasket.validPriceCount}`,
    `providerIssue=${report.providerIssue}`,
    `marketSignal=${report.marketSignal}`,
    `executionImpact=${report.executionImpact}`,
    `liveExecutionAllowed=${report.liveExecutionAllowed}`,
  ].join('\n');
}
