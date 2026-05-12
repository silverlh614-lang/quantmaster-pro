import {
  fetchCurrentPrice,
  fetchKisDailyCreditBalance,
  fetchKisDailyLoanTransaction,
  fetchKisDailyShortSale,
  fetchKisForeignInstitutionTotal,
  fetchKisInvestorDailyByMarket,
  fetchKisInvestorFlow,
  fetchKisInvestorTimeByMarket,
  fetchKisInvestorTradeByStockDaily,
  fetchKisInvestorTrendEstimate,
  fetchKisMarketProgramTrade,
  fetchKisMarketSupply,
  fetchKisPrevClose,
  fetchKisStockProgramTrade,
  fetchStockName,
  type KisDailyCreditBalance,
  type KisDailyLoanTransaction,
  type KisDailyShortSale,
  type KisForeignInstitutionTotal,
  type KisInvestorDailyByMarket,
  type KisInvestorFlow,
  type KisInvestorTimeByMarket,
  type KisInvestorTradeByStockDaily,
  type KisInvestorTrendEstimate,
  type KisMarketProgramTrade,
  type KisStockProgramTrade,
  type PrevClose,
} from '../clients/kisClient/index.js';

export type KisDataConfidence = 'VERIFIED' | 'ESTIMATED' | 'DEGRADED' | 'STALE' | 'MISSING';
export type KisSupplyUseScope =
  | 'CORE_CANDIDATE'
  | 'GATED_CANDIDATE'
  | 'WEIGHTED'
  | 'ADVISORY'
  | 'SHADOW_ONLY'
  | 'DIAGNOSTIC_ONLY';

type Trend = 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN';

export interface KisOfficialSupplyPack {
  stockCode: string;
  provider: 'KIS_API';
  officialSource: true;
  fetchedAt: string;
  stockName?: string;
  price?: {
    currentPrice?: number;
    prevClose?: number;
    tradingDate?: string;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  investorFlowDaily?: {
    foreignNetBuy?: number;
    institutionalNetBuy?: number;
    individualNetBuy?: number;
    hasRealFields: boolean;
    confidence: KisDataConfidence;
    sourceKind?: 'INVESTOR_TRADE_BY_STOCK_DAILY';
    provider?: 'KIS_API';
    usableForSignal?: boolean;
    usableForExecution?: boolean;
    executionImpact?: 'NONE';
    useScope: KisSupplyUseScope;
  };
  investorFlowEstimate?: {
    foreignNetBuyEstimate?: number;
    institutionalNetBuyEstimate?: number;
    individualNetBuyEstimate?: number;
    confidence: 'ESTIMATED' | 'MISSING';
    useScope: 'ADVISORY' | 'SHADOW_ONLY' | 'DIAGNOSTIC_ONLY';
  };
  foreignInstitutionTotal?: {
    foreignNetBuy?: number;
    institutionalNetBuy?: number;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  shortSelling?: {
    shortSaleQty?: number;
    shortSaleAmount?: number;
    shortSaleRatio?: number;
    shortSaleIncreaseRate?: number;
    trend?: Trend;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  loanTransaction?: {
    loanBalanceQty?: number;
    loanBalanceAmount?: number;
    loanIncreaseRate?: number;
    trend?: Trend;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  creditBalance?: {
    creditBalanceQty?: number;
    creditBalanceAmount?: number;
    creditIncreaseRate?: number;
    trend?: Trend;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  stockProgram?: {
    programNetBuyQty?: number;
    programNetBuyAmount?: number;
    programBuyRatio?: number | null;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  marketProgram?: {
    programNetBuyQty?: number | null;
    programNetBuyAmount?: number | null;
    programArbitrageNetBuy?: number | null;
    programNonArbitrageNetBuy?: number | null;
    programSellAmount?: number | null;
    programBuyAmount?: number | null;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  marketSupply?: {
    foreignNetBuy?: number;
    institutionNetBuy?: number;
    individualNetBuy?: number;
    confidence: KisDataConfidence;
    useScope: KisSupplyUseScope;
  };
  providerIssue: boolean;
  marketSignal: boolean;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  diagnostics: string[];
  learningTags: string[];
}

export interface KisOfficialSupplyPackFetchers {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchPrevClose?: (code: string) => Promise<PrevClose | null>;
  fetchStockName?: (code: string) => Promise<string | null>;
  fetchInvestorFlow?: (code: string) => Promise<KisInvestorFlow | null>;
  fetchInvestorFlowDaily?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  fetchInvestorFlowEstimate?: (code: string) => Promise<KisInvestorTrendEstimate | null>;
  fetchForeignInstitutionTotal?: () => Promise<KisForeignInstitutionTotal | null>;
  fetchShortSelling?: (code: string) => Promise<KisDailyShortSale | null>;
  fetchLoanTransaction?: (code: string) => Promise<KisDailyLoanTransaction | null>;
  fetchCreditBalance?: (code: string) => Promise<KisDailyCreditBalance | null>;
  fetchStockProgramTrade?: (code: string) => Promise<KisStockProgramTrade | null>;
  fetchMarketProgramTrade?: () => Promise<KisMarketProgramTrade | null>;
  fetchMarketSupply?: () => Promise<{ foreignNetBuy: number; institutionNetBuy: number; individualNetBuy: number } | null>;
  fetchInvestorDailyByMarket?: () => Promise<KisInvestorDailyByMarket | null>;
  fetchInvestorTimeByMarket?: () => Promise<KisInvestorTimeByMarket | null>;
}

export interface KisSupplyEnemyChecklistDecision {
  warningCount: number;
  warnings: string[];
  strongBuyAllowed: boolean;
  newBuyAllowed: boolean;
  shadowOnly: boolean;
  advisoryBoost: boolean;
  reason: string;
  learningTags: string[];
}

const DEFAULT_FETCHERS: Required<KisOfficialSupplyPackFetchers> = {
  fetchCurrentPrice,
  fetchPrevClose: fetchKisPrevClose,
  fetchStockName,
  fetchInvestorFlow: (code) => fetchKisInvestorFlow(code, 'LOW'),
  fetchInvestorFlowDaily: fetchKisInvestorTradeByStockDaily,
  fetchInvestorFlowEstimate: fetchKisInvestorTrendEstimate,
  fetchForeignInstitutionTotal: fetchKisForeignInstitutionTotal,
  fetchShortSelling: fetchKisDailyShortSale,
  fetchLoanTransaction: fetchKisDailyLoanTransaction,
  fetchCreditBalance: fetchKisDailyCreditBalance,
  fetchStockProgramTrade: fetchKisStockProgramTrade,
  fetchMarketProgramTrade: fetchKisMarketProgramTrade,
  fetchMarketSupply: fetchKisMarketSupply,
  fetchInvestorDailyByMarket: fetchKisInvestorDailyByMarket,
  fetchInvestorTimeByMarket: fetchKisInvestorTimeByMarket,
};

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function hasAnyFinite(...values: unknown[]): boolean {
  return values.some(finite);
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function realInvestorFlow(value: KisInvestorFlow | KisInvestorTradeByStockDaily | null): boolean {
  return !!value
    && finite(value.foreignNetBuy)
    && finite(value.institutionalNetBuy)
    && finite(value.individualNetBuy);
}

function partialInvestorFlow(value: KisInvestorFlow | KisInvestorTradeByStockDaily | null): boolean {
  return !!value
    && finite(value.foreignNetBuy)
    && finite(value.institutionalNetBuy);
}

function nonEmptyProgram(value: KisStockProgramTrade | KisMarketProgramTrade | null): boolean {
  if (!value) return false;
  const record = value as unknown as Record<string, unknown>;
  return [record.programNetBuyQty, record.programNetBuyAmount, record.programBuyRatio, record.programArbitrageNetBuy, record.programNonArbitrageNetBuy, record.programSellAmount, record.programBuyAmount]
    .some((item) => finite(item));
}

function nonEmptyMarketSupply(value: { foreignNetBuy: number; institutionNetBuy: number; individualNetBuy: number } | null): boolean {
  return !!value && [value.foreignNetBuy, value.institutionNetBuy, value.individualNetBuy]
    .some((item) => finite(item) && item !== 0);
}

function confidenceForDaily(hasValue: boolean): KisDataConfidence {
  return hasValue ? 'VERIFIED' : 'MISSING';
}

function tagIf(condition: boolean, tag: string, tags: string[]): void {
  if (condition) tags.push(tag);
}

export function evaluateKisSupplyEnemyChecklist(pack: KisOfficialSupplyPack): KisSupplyEnemyChecklistDecision {
  const warnings: string[] = [];
  const tags: string[] = [];
  const shortRisk = (pack.shortSelling?.shortSaleIncreaseRate ?? 0) >= 30
    || pack.shortSelling?.trend === 'INCREASING';
  const loanRisk = (pack.loanTransaction?.loanIncreaseRate ?? 0) >= 30
    || pack.loanTransaction?.trend === 'INCREASING';
  const creditRisk = (pack.creditBalance?.creditIncreaseRate ?? 0) >= 30
    || pack.creditBalance?.trend === 'INCREASING';

  if (shortRisk) {
    warnings.push('KIS_SHORT_SELLING_RISK');
    tags.push('CASE_KIS_SHORT_SELLING_RISK');
  }
  if (loanRisk) {
    warnings.push('KIS_LOAN_BALANCE_RISK');
    tags.push('CASE_KIS_LOAN_BALANCE_RISK');
  }
  if (creditRisk) {
    warnings.push('KIS_CREDIT_BALANCE_RISK');
    tags.push('CASE_KIS_CREDIT_BALANCE_RISK');
  }

  const warningCount = warnings.length;
  const shadowOnly = warningCount >= 3;
  const strongBuyAllowed = warningCount < 2;
  const newBuyAllowed = !shadowOnly;
  const advisoryBoost = pack.shortSelling?.trend === 'DECREASING'
    && (pack.stockProgram?.programNetBuyAmount ?? 0) > 0
    && (pack.price?.currentPrice ?? 0) > (pack.price?.prevClose ?? Number.POSITIVE_INFINITY);

  if (advisoryBoost) tags.push('CASE_KIS_SHORT_COVERING_ADVISORY');

  return {
    warningCount,
    warnings,
    strongBuyAllowed,
    newBuyAllowed,
    shadowOnly,
    advisoryBoost,
    reason: warnings.join(' / '),
    learningTags: tags,
  };
}

export async function fetchKisOfficialSupplyPack(
  code: string,
  now = new Date(),
  fetchers: KisOfficialSupplyPackFetchers = {},
): Promise<KisOfficialSupplyPack> {
  const safeCode = normalizeCode(code);
  const usedFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const fetchedAt = now.toISOString();
  const diagnostics: string[] = [
    'officialSource=true',
    'provider=KIS_API',
    'rawPayloadPersistenceAllowed=false',
    'executionImpact=NONE',
    'liveExecutionAllowed=false',
  ];
  const learningTags: string[] = [];

  const [
    currentPrice,
    prevClose,
    stockName,
    strictInvestorFlow,
    dailyInvestorFlow,
    investorEstimate,
    foreignInstitutionTotal,
    shortSelling,
    loanTransaction,
    creditBalance,
    stockProgram,
    marketProgram,
    marketSupply,
    investorDailyByMarket,
    investorTimeByMarket,
  ] = await Promise.all([
    safeCall(() => usedFetchers.fetchCurrentPrice(safeCode)),
    safeCall(() => usedFetchers.fetchPrevClose(safeCode)),
    safeCall(() => usedFetchers.fetchStockName(safeCode)),
    Promise.resolve(null), // INQUIRE_INVESTOR quote-like endpoint is diagnostic-only; never semantic net-buy.
    safeCall(() => usedFetchers.fetchInvestorFlowDaily(safeCode)),
    safeCall(() => usedFetchers.fetchInvestorFlowEstimate(safeCode)),
    safeCall(() => usedFetchers.fetchForeignInstitutionTotal()),
    safeCall(() => usedFetchers.fetchShortSelling(safeCode)),
    safeCall(() => usedFetchers.fetchLoanTransaction(safeCode)),
    safeCall(() => usedFetchers.fetchCreditBalance(safeCode)),
    safeCall(() => usedFetchers.fetchStockProgramTrade(safeCode)),
    safeCall(() => usedFetchers.fetchMarketProgramTrade()),
    safeCall(() => usedFetchers.fetchMarketSupply()),
    safeCall(() => usedFetchers.fetchInvestorDailyByMarket()),
    safeCall(() => usedFetchers.fetchInvestorTimeByMarket()),
  ]);

  const hasCurrentPrice = positive(currentPrice);
  const hasPrevClose = !!prevClose && positive(prevClose.prevClose);
  tagIf(hasCurrentPrice, 'CASE_KIS_PRICE_PRIMARY', learningTags);

  void strictInvestorFlow;
  const investorFlowSource = partialInvestorFlow(dailyInvestorFlow) ? dailyInvestorFlow : null;
  const hasDailyInvestorFlow = partialInvestorFlow(investorFlowSource);
  const hasFullDailyInvestorFlow = realInvestorFlow(investorFlowSource);
  tagIf(hasDailyInvestorFlow, 'CASE_KIS_INVESTOR_FLOW_VERIFIED', learningTags);
  tagIf(!hasDailyInvestorFlow, 'CASE_KIS_INVESTOR_FLOW_MISSING_FIELDS', learningTags);

  const hasEstimate = !!investorEstimate && hasAnyFinite(
    investorEstimate.foreignNetBuyEstimate,
    investorEstimate.institutionalNetBuyEstimate,
    investorEstimate.individualNetBuyEstimate,
  );
  const hasForeignInstitutionTotal = !!foreignInstitutionTotal
    && hasAnyFinite(foreignInstitutionTotal.foreignNetBuy, foreignInstitutionTotal.institutionalNetBuy);
  const hasShort = !!shortSelling && hasAnyFinite(shortSelling.shortSaleQty, shortSelling.shortSaleAmount, shortSelling.shortSaleRatio);
  const hasLoan = !!loanTransaction && hasAnyFinite(loanTransaction.loanBalanceQty, loanTransaction.loanBalanceAmount, loanTransaction.loanIncreaseRate);
  const hasCredit = !!creditBalance && hasAnyFinite(creditBalance.creditBalanceQty, creditBalance.creditBalanceAmount, creditBalance.creditIncreaseRate);
  const hasStockProgram = nonEmptyProgram(stockProgram);
  const hasMarketProgram = nonEmptyProgram(marketProgram);
  const hasMarketSupply = nonEmptyMarketSupply(marketSupply)
    || (!!investorDailyByMarket && hasAnyFinite(investorDailyByMarket.foreignNetBuy, investorDailyByMarket.institutionNetBuy, investorDailyByMarket.individualNetBuy))
    || (!!investorTimeByMarket && hasAnyFinite(investorTimeByMarket.foreignNetBuy, investorTimeByMarket.institutionNetBuy, investorTimeByMarket.individualNetBuy));

  tagIf(hasStockProgram || hasMarketProgram, 'CASE_KIS_PROGRAM_NET_BUY', learningTags);
  tagIf(hasShort, 'CASE_KIS_SHORT_SELLING_RISK', learningTags);
  tagIf(hasLoan, 'CASE_KIS_LOAN_BALANCE_RISK', learningTags);
  tagIf(hasCredit, 'CASE_KIS_CREDIT_BALANCE_RISK', learningTags);

  const pack: KisOfficialSupplyPack = {
    stockCode: safeCode,
    provider: 'KIS_API',
    officialSource: true,
    fetchedAt,
    ...(stockName ? { stockName } : {}),
    price: {
      ...(hasCurrentPrice ? { currentPrice: currentPrice! } : {}),
      ...(hasPrevClose ? { prevClose: prevClose!.prevClose, tradingDate: prevClose!.tradingDate } : {}),
      confidence: hasCurrentPrice ? 'VERIFIED' : hasPrevClose ? 'STALE' : 'MISSING',
      useScope: hasCurrentPrice ? 'WEIGHTED' : 'DIAGNOSTIC_ONLY',
    },
    investorFlowDaily: hasDailyInvestorFlow
      ? {
          foreignNetBuy: investorFlowSource!.foreignNetBuy,
          institutionalNetBuy: investorFlowSource!.institutionalNetBuy,
          ...(finite(investorFlowSource!.individualNetBuy) ? { individualNetBuy: investorFlowSource!.individualNetBuy } : {}),
          hasRealFields: hasFullDailyInvestorFlow,
          confidence: hasFullDailyInvestorFlow ? 'VERIFIED' : 'DEGRADED',
          sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY',
          provider: 'KIS_API',
          usableForSignal: true,
          usableForExecution: false,
          executionImpact: 'NONE',
          useScope: 'WEIGHTED',
        }
      : { hasRealFields: false, confidence: 'MISSING', useScope: 'DIAGNOSTIC_ONLY' },
    investorFlowEstimate: hasEstimate
      ? {
          ...(investorEstimate!.foreignNetBuyEstimate !== undefined ? { foreignNetBuyEstimate: investorEstimate!.foreignNetBuyEstimate } : {}),
          ...(investorEstimate!.institutionalNetBuyEstimate !== undefined ? { institutionalNetBuyEstimate: investorEstimate!.institutionalNetBuyEstimate } : {}),
          ...(investorEstimate!.individualNetBuyEstimate !== undefined ? { individualNetBuyEstimate: investorEstimate!.individualNetBuyEstimate } : {}),
          confidence: 'ESTIMATED',
          useScope: 'ADVISORY',
        }
      : { confidence: 'MISSING', useScope: 'DIAGNOSTIC_ONLY' },
    ...(hasForeignInstitutionTotal ? {
      foreignInstitutionTotal: {
        ...(foreignInstitutionTotal!.foreignNetBuy !== undefined ? { foreignNetBuy: foreignInstitutionTotal!.foreignNetBuy } : {}),
        ...(foreignInstitutionTotal!.institutionalNetBuy !== undefined ? { institutionalNetBuy: foreignInstitutionTotal!.institutionalNetBuy } : {}),
        confidence: 'ESTIMATED',
        useScope: 'ADVISORY',
      },
    } : {}),
    ...(hasShort ? {
      shortSelling: {
        ...(shortSelling!.shortSaleQty !== undefined ? { shortSaleQty: shortSelling!.shortSaleQty } : {}),
        ...(shortSelling!.shortSaleAmount !== undefined ? { shortSaleAmount: shortSelling!.shortSaleAmount } : {}),
        ...(shortSelling!.shortSaleRatio !== undefined ? { shortSaleRatio: shortSelling!.shortSaleRatio } : {}),
        ...(shortSelling!.shortSaleIncreaseRate !== undefined ? { shortSaleIncreaseRate: shortSelling!.shortSaleIncreaseRate } : {}),
        trend: shortSelling!.trend ?? 'UNKNOWN',
        confidence: confidenceForDaily(true),
        useScope: 'ADVISORY',
      },
    } : {}),
    ...(hasLoan ? {
      loanTransaction: {
        ...(loanTransaction!.loanBalanceQty !== undefined ? { loanBalanceQty: loanTransaction!.loanBalanceQty } : {}),
        ...(loanTransaction!.loanBalanceAmount !== undefined ? { loanBalanceAmount: loanTransaction!.loanBalanceAmount } : {}),
        ...(loanTransaction!.loanIncreaseRate !== undefined ? { loanIncreaseRate: loanTransaction!.loanIncreaseRate } : {}),
        trend: loanTransaction!.trend ?? 'UNKNOWN',
        confidence: confidenceForDaily(true),
        useScope: 'ADVISORY',
      },
    } : {}),
    ...(hasCredit ? {
      creditBalance: {
        ...(creditBalance!.creditBalanceQty !== undefined ? { creditBalanceQty: creditBalance!.creditBalanceQty } : {}),
        ...(creditBalance!.creditBalanceAmount !== undefined ? { creditBalanceAmount: creditBalance!.creditBalanceAmount } : {}),
        ...(creditBalance!.creditIncreaseRate !== undefined ? { creditIncreaseRate: creditBalance!.creditIncreaseRate } : {}),
        trend: creditBalance!.trend ?? 'UNKNOWN',
        confidence: confidenceForDaily(true),
        useScope: 'ADVISORY',
      },
    } : {}),
    ...(hasStockProgram ? {
      stockProgram: {
        programNetBuyQty: stockProgram!.programNetBuyQty,
        programNetBuyAmount: stockProgram!.programNetBuyAmount,
        programBuyRatio: stockProgram!.programBuyRatio,
        confidence: 'VERIFIED',
        useScope: 'WEIGHTED',
      },
    } : {}),
    ...(hasMarketProgram ? {
      marketProgram: {
        ...(marketProgram!.programNetBuyQty !== undefined ? { programNetBuyQty: marketProgram!.programNetBuyQty } : {}),
        ...(marketProgram!.programNetBuyAmount !== undefined ? { programNetBuyAmount: marketProgram!.programNetBuyAmount } : {}),
        ...(marketProgram!.programArbitrageNetBuy !== undefined ? { programArbitrageNetBuy: marketProgram!.programArbitrageNetBuy } : {}),
        ...(marketProgram!.programNonArbitrageNetBuy !== undefined ? { programNonArbitrageNetBuy: marketProgram!.programNonArbitrageNetBuy } : {}),
        ...(marketProgram!.programSellAmount !== undefined ? { programSellAmount: marketProgram!.programSellAmount } : {}),
        ...(marketProgram!.programBuyAmount !== undefined ? { programBuyAmount: marketProgram!.programBuyAmount } : {}),
        confidence: 'VERIFIED',
        useScope: 'WEIGHTED',
      },
    } : {}),
    ...(hasMarketSupply ? {
      marketSupply: {
        ...(marketSupply?.foreignNetBuy !== undefined ? { foreignNetBuy: marketSupply.foreignNetBuy } : investorDailyByMarket?.foreignNetBuy !== undefined ? { foreignNetBuy: investorDailyByMarket.foreignNetBuy } : {}),
        ...(marketSupply?.institutionNetBuy !== undefined ? { institutionNetBuy: marketSupply.institutionNetBuy } : investorDailyByMarket?.institutionNetBuy !== undefined ? { institutionNetBuy: investorDailyByMarket.institutionNetBuy } : {}),
        ...(marketSupply?.individualNetBuy !== undefined ? { individualNetBuy: marketSupply.individualNetBuy } : investorDailyByMarket?.individualNetBuy !== undefined ? { individualNetBuy: investorDailyByMarket.individualNetBuy } : {}),
        confidence: marketSupply || investorDailyByMarket ? 'VERIFIED' : 'ESTIMATED',
        useScope: marketSupply || investorDailyByMarket ? 'WEIGHTED' : 'ADVISORY',
      },
    } : {}),
    providerIssue: !(hasCurrentPrice || hasPrevClose || hasDailyInvestorFlow || hasEstimate || hasForeignInstitutionTotal || hasShort || hasLoan || hasCredit || hasStockProgram || hasMarketProgram || hasMarketSupply),
    marketSignal: false,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    diagnostics,
    learningTags,
  };

  const enemy = evaluateKisSupplyEnemyChecklist(pack);
  pack.diagnostics.push(
    `price=${hasCurrentPrice ? 'OK' : hasPrevClose ? 'STALE' : 'MISSING'}`,
    `investorFlowDaily=${hasDailyInvestorFlow ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `investorFlowEstimate=${hasEstimate ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `shortSelling=${hasShort ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `loanTransaction=${hasLoan ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `creditBalance=${hasCredit ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `stockProgram=${hasStockProgram ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `marketProgram=${hasMarketProgram ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `marketSupply=${hasMarketSupply ? 'OK' : 'DATA_UNAVAILABLE'}`,
    `enemyWarnings=${enemy.warningCount}`,
    `strongBuyAllowed=${String(enemy.strongBuyAllowed)}`,
    `newBuyAllowed=${String(enemy.newBuyAllowed)}`,
  );
  pack.learningTags = Array.from(new Set([...pack.learningTags, ...enemy.learningTags]));
  if (pack.providerIssue) pack.learningTags.push('CASE_KIS_PROVIDER_ERROR');

  return pack;
}
