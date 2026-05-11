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
  diagnoseKisMarketProgramRaw,
  diagnoseKisStockProgramRaw,
  type KisRawSupplyDiagnostic,
} from '../clients/kisClient/supplyDiagnostics.js';
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
      status: 'OK' | 'PARTIAL' | 'EMPTY' | 'FIELD_MISMATCH' | 'ERROR';
      materializedCount: number;
      emptyCount: number;
      fieldMismatchCount: number;
      parserStatuses: KisParserDiagnosticStatus[];
    };
    marketProgram: {
      status: 'OK' | 'EMPTY' | 'FIELD_MISMATCH' | 'ERROR';
      programNetBuyAmount?: number;
      programArbitrageNetBuy?: number;
      programNonArbitrageNetBuy?: number;
      blockedReason?: string;
      parserStatus: KisParserDiagnosticStatus;
    };
  };
  shortCredit: {
    short: 'OK' | 'MISSING' | 'ERROR';
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
  buildSectorBasket?: () => Promise<{ basketRows: number; validPriceCount: number }>;
}

const DEFAULT_TARGET_LIMIT = 10;
const FALLBACK_TARGET = '005930';

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
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
    const [price, prevClose, dailyChart, strictFlow, dailyFlow, investorRaw, stockProgram, stockProgramRaw, short, loan, credit] = await Promise.all([
      safe(() => f.fetchCurrentPrice(code)),
      safe(() => f.fetchPrevClose(code)),
      safe(() => f.fetchDailyChart(code)),
      safe(() => f.fetchInvestorFlow(code)),
      safe(() => f.fetchInvestorFlowDaily(code)),
      safe(() => f.diagnoseInvestorFlowRaw(code)),
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
  const stockProgramStatus: KisOnlyHealthReport['program']['stockProgram']['status'] = stockProgramErrors > 0 && stockProgramMaterializedCount === 0
    ? 'ERROR'
    : stockProgramMaterializedCount === targetCodes.length
      ? 'OK'
      : stockProgramMaterializedCount > 0
        ? 'PARTIAL'
        : stockProgramFieldMismatchCount > 0
          ? 'FIELD_MISMATCH'
          : 'EMPTY';
  const marketProgramStatus: KisOnlyHealthReport['program']['marketProgram']['status'] = !marketProgram.ok || !marketProgramRaw.ok
    ? 'ERROR'
    : marketProgramMaterialized(marketProgram.value)
      ? 'OK'
      : marketProgramParserStatus === 'HTTP_OK_FIELD_MISMATCH'
        ? 'FIELD_MISMATCH'
        : 'EMPTY';
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
      sampleRows: sampleRows.slice(0, 5),
    },
    program: {
      stockProgram: {
        status: stockProgramStatus,
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
      },
    },
    shortCredit: { short: shortStatus, loan: loanStatus, credit: creditStatus },
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
  return [
    'KIS Only Health',
    `Current Data Mode: ${report.mode}`,
    'Active Sources: KIS only',
    'Legacy Providers: disabled for current decision',
    `targets=${report.targetCodes.join(',')}`,
    `PRICE: ${report.price.status} current=${report.price.currentPriceCount}/${stockTotal} prevClose=${report.price.prevCloseCount}/${stockTotal} chart=${report.price.dailyChartCount}/${stockTotal}`,
    `INVESTOR_FLOW: ${report.investorFlow.status} materialized=${report.investorFlow.materializedCount} missing=${report.investorFlow.missingCount} fieldMismatch=${report.investorFlow.fieldMismatchCount} tried=${tried}`,
    `INVESTOR_FLOW_SAMPLE: ${sample}`,
    `PROGRAM_STOCK: ${report.program.stockProgram.status} ${report.program.stockProgram.materializedCount}/${stockTotal} empty=${report.program.stockProgram.emptyCount} fieldMismatch=${report.program.stockProgram.fieldMismatchCount}`,
    `PROGRAM_MARKET: ${marketProgram.status}${marketProgramValue}`,
    `SHORT: ${report.shortCredit.short}`,
    `LOAN: ${report.shortCredit.loan}`,
    `CREDIT: ${report.shortCredit.credit}`,
    `SECTOR_BASKET: ${report.sectorBasket.status} rows=${report.sectorBasket.basketRows} validPrice=${report.sectorBasket.validPriceCount}`,
    `providerIssue=${report.providerIssue}`,
    `marketSignal=${report.marketSignal}`,
    `executionImpact=${report.executionImpact}`,
    `liveExecutionAllowed=${report.liveExecutionAllowed}`,
  ].join('\n');
}
