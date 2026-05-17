// @responsibility KIS official evidence pack assembly.
import {
  fetchCurrentPrice,
  fetchKisMarketProgramTrade,
  fetchKisMarketSupply,
  fetchKisPrevClose,
  fetchKisStockProgramTrade,
  fetchStockName,
  fetchKisInvestorTradeByStockDaily,
  type KisMarketProgramTrade,
  type KisStockProgramTrade,
  type PrevClose,
} from '../clients/kisClient/index.js';
import type { KisInvestorFlow, KisInvestorTradeByStockDaily } from '../clients/kisClient/types.js';

export type KisEvidenceFreshness = 'FRESH' | 'STALE' | 'MISSING';
export type KisEvidenceConfidence = 'VERIFIED' | 'DEGRADED' | 'MISSING';

export interface KisOfficialEvidencePack {
  stockCode: string;
  officialSource: true;
  provider: 'KIS_API';
  fetchedAt: string;
  stockName?: string;
  price?: {
    currentPrice?: number;
    prevClose?: number;
    tradingDate?: string;
    freshness: KisEvidenceFreshness;
  };
  investorFlow?: {
    foreignNetBuy?: number;
    institutionalNetBuy?: number;
    individualNetBuy?: number;
    hasRealFields: boolean;
  };
  stockProgram?: {
    programNetBuyQty?: number;
    programNetBuyAmount?: number;
    programBuyRatio?: number | null;
  };
  marketProgram?: {
    programNetBuyQty?: number | null;
    programNetBuyAmount?: number | null;
    programArbitrageNetBuy?: number | null;
    programNonArbitrageNetBuy?: number | null;
    programSellAmount?: number | null;
    programBuyAmount?: number | null;
  };
  marketSupply?: {
    foreignNetBuy?: number;
    institutionNetBuy?: number;
    individualNetBuy?: number;
  };
  confidence: KisEvidenceConfidence;
  providerIssue: boolean;
  marketSignal: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  diagnostics: {
    priceProvider: 'KIS_PRICE';
    priceFreshness: KisEvidenceFreshness;
    priceProviderTried: string[];
    priceAsOf?: string;
    priceStaleReason?: string;
    investorFlowStatus: 'OK' | 'DATA_UNAVAILABLE';
    stockProgramStatus: 'OK' | 'DATA_UNAVAILABLE';
    marketProgramStatus: 'OK' | 'DATA_UNAVAILABLE';
    marketSupplyStatus: 'OK' | 'DATA_UNAVAILABLE';
    officialSource: true;
    executionImpact: 'NONE';
  };
}

export interface KisOfficialEvidencePackFetchers {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchPrevClose?: (code: string) => Promise<PrevClose | null>;
  fetchStockName?: (code: string) => Promise<string | null>;
  fetchInvestorFlow?: (code: string) => Promise<(KisInvestorFlow | KisInvestorTradeByStockDaily) | null>;
  fetchStockProgramTrade?: (code: string) => Promise<KisStockProgramTrade | null>;
  fetchMarketProgramTrade?: () => Promise<KisMarketProgramTrade | null>;
  fetchMarketSupply?: () => Promise<{
    foreignNetBuy: number;
    institutionNetBuy: number;
    individualNetBuy: number;
  } | null>;
}

const DEFAULT_FETCHERS: Required<KisOfficialEvidencePackFetchers> = {
  fetchCurrentPrice,
  fetchPrevClose: fetchKisPrevClose,
  fetchStockName,
  fetchInvestorFlow: (code) => fetchKisInvestorTradeByStockDaily(code, 'LOW'),
  fetchStockProgramTrade: fetchKisStockProgramTrade,
  fetchMarketProgramTrade: fetchKisMarketProgramTrade,
  fetchMarketSupply: fetchKisMarketSupply,
};

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasRealInvestorFields(value: KisInvestorFlow | KisInvestorTradeByStockDaily | null): value is KisInvestorFlow | KisInvestorTradeByStockDaily {
  return !!value
    && finite(value.foreignNetBuy)
    && finite(value.institutionalNetBuy)
    && finite(value.individualNetBuy);
}

function hasNonEmptyProgramFields(value: KisStockProgramTrade | KisMarketProgramTrade | null): boolean {
  if (!value) return false;
  const record = value as unknown as Record<string, unknown>;
  const numericValues = [
    record.programNetBuyQty,
    record.programNetBuyAmount,
    record.programBuyRatio,
    record.programArbitrageNetBuy,
    record.programNonArbitrageNetBuy,
    record.programSellAmount,
    record.programBuyAmount,
  ].filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return numericValues.some((item) => item !== 0);
}

function hasNonEmptySupplyFields(value: {
  foreignNetBuy: number;
  institutionNetBuy: number;
  individualNetBuy: number;
} | null): boolean {
  if (!value) return false;
  return [value.foreignNetBuy, value.institutionNetBuy, value.individualNetBuy]
    .some((item) => Number.isFinite(item) && item !== 0);
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function fetchKisOfficialEvidencePack(
  code: string,
  now = new Date(),
  fetchers: KisOfficialEvidencePackFetchers = {},
): Promise<KisOfficialEvidencePack> {
  const safeCode = normalizeCode(code);
  const usedFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const fetchedAt = now.toISOString();

  const [
    currentPrice,
    prevClose,
    stockName,
    investorFlow,
    stockProgram,
    marketProgram,
    marketSupply,
  ] = await Promise.all([
    safeCall(() => usedFetchers.fetchCurrentPrice(safeCode)),
    safeCall(() => usedFetchers.fetchPrevClose(safeCode)),
    safeCall(() => usedFetchers.fetchStockName(safeCode)),
    safeCall(() => usedFetchers.fetchInvestorFlow(safeCode)),
    safeCall(() => usedFetchers.fetchStockProgramTrade(safeCode)),
    safeCall(() => usedFetchers.fetchMarketProgramTrade()),
    safeCall(() => usedFetchers.fetchMarketSupply()),
  ]);

  const hasFreshPrice = finitePositive(currentPrice);
  const hasPrevClose = !!prevClose && finitePositive(prevClose.prevClose);
  const priceFreshness: KisEvidenceFreshness = hasFreshPrice ? 'FRESH' : hasPrevClose ? 'STALE' : 'MISSING';
  const realInvestorFlow = hasRealInvestorFields(investorFlow);
  const usableStockProgram = hasNonEmptyProgramFields(stockProgram);
  const usableMarketProgram = hasNonEmptyProgramFields(marketProgram);
  const usableMarketSupply = hasNonEmptySupplyFields(marketSupply);
  const hasAnyEvidence = hasFreshPrice || hasPrevClose || realInvestorFlow || usableStockProgram || usableMarketProgram || usableMarketSupply || !!stockName;
  const confidence: KisEvidenceConfidence = hasFreshPrice || realInvestorFlow
    ? 'VERIFIED'
    : hasAnyEvidence ? 'DEGRADED' : 'MISSING';

  const pack: KisOfficialEvidencePack = {
    stockCode: safeCode,
    officialSource: true,
    provider: 'KIS_API',
    fetchedAt,
    ...(stockName ? { stockName } : {}),
    price: {
      ...(hasFreshPrice ? { currentPrice } : {}),
      ...(hasPrevClose ? { prevClose: prevClose.prevClose, tradingDate: prevClose.tradingDate } : {}),
      freshness: priceFreshness,
    },
    investorFlow: realInvestorFlow
      ? {
          foreignNetBuy: investorFlow.foreignNetBuy,
          institutionalNetBuy: investorFlow.institutionalNetBuy,
          individualNetBuy: investorFlow.individualNetBuy,
          hasRealFields: true,
        }
      : { hasRealFields: false },
    ...(usableStockProgram && stockProgram ? {
      stockProgram: {
        programNetBuyQty: stockProgram.programNetBuyQty,
        programNetBuyAmount: stockProgram.programNetBuyAmount,
        programBuyRatio: stockProgram.programBuyRatio,
      },
    } : {}),
    ...(usableMarketProgram && marketProgram ? {
      marketProgram: {
        programNetBuyQty: marketProgram.programNetBuyQty,
        programNetBuyAmount: marketProgram.programNetBuyAmount,
        programArbitrageNetBuy: marketProgram.programArbitrageNetBuy,
        programNonArbitrageNetBuy: marketProgram.programNonArbitrageNetBuy,
        programSellAmount: marketProgram.programSellAmount,
        programBuyAmount: marketProgram.programBuyAmount,
      },
    } : {}),
    ...(usableMarketSupply && marketSupply ? {
      marketSupply: {
        foreignNetBuy: marketSupply.foreignNetBuy,
        institutionNetBuy: marketSupply.institutionNetBuy,
        individualNetBuy: marketSupply.individualNetBuy,
      },
    } : {}),
    confidence,
    providerIssue: !hasAnyEvidence,
    marketSignal: false,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    diagnostics: {
      priceProvider: 'KIS_PRICE',
      priceFreshness,
      priceProviderTried: ['KIS_PRICE'],
      ...(hasFreshPrice || hasPrevClose ? { priceAsOf: hasPrevClose ? prevClose.fetchedAt : fetchedAt } : {}),
      ...(!hasFreshPrice && hasPrevClose ? { priceStaleReason: 'KIS_CURRENT_PRICE_MISSING_PREV_CLOSE_AVAILABLE' } : {}),
      ...(!hasFreshPrice && !hasPrevClose ? { priceStaleReason: 'KIS_PRICE_MISSING' } : {}),
      investorFlowStatus: realInvestorFlow ? 'OK' : 'DATA_UNAVAILABLE',
      stockProgramStatus: usableStockProgram ? 'OK' : 'DATA_UNAVAILABLE',
      marketProgramStatus: usableMarketProgram ? 'OK' : 'DATA_UNAVAILABLE',
      marketSupplyStatus: usableMarketSupply ? 'OK' : 'DATA_UNAVAILABLE',
      officialSource: true,
      executionImpact: 'NONE',
    },
  };

  return pack;
}
