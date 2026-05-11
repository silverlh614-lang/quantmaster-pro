/** KIS investor-flow evidence adapter. */
import { fetchKisInvestorFlow } from '../clients/kisClient/investorFlowStrict.js';
import { fetchKisForeignInstitutionTotal, fetchKisInvestorTradeByStockDaily } from '../clients/kisClient/index.js';
import { makeInvestorFlowProviderHealth, resolveInvestorFlowSourceDateKst, type InvestorFlowProviderHealth } from './investorFlowProviderHealth.js';
import type { InvestorFlowSample } from './investorFlowRouter.js';

export interface KisSymbolInvestorFlowSample {
  stockCode: string;
  source: 'KIS_API';
  sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY' | 'FOREIGN_INSTITUTION_TOTAL' | 'INQUIRE_INVESTOR';
  foreignNetBuy?: number;
  institutionalNetBuy?: number;
  individualNetBuy?: number;
  sourceDate: string;
  confidence: 'VERIFIED' | 'DEGRADED' | 'ESTIMATED';
  hasRealFields: boolean;
  marketSignal: boolean;
  providerIssue: boolean;
  executionImpact: 'NONE';
  usableForShadow: boolean;
}

export interface KisInvestorFlowEvidenceResult {
  data: InvestorFlowSample | null;
  sample: KisSymbolInvestorFlowSample | null;
  health: InvestorFlowProviderHealth;
  diagnostic: string;
  promotionStage: KisInvestorFlowPromotionStage;
  selectableForRouter: boolean;
  officialSource: true;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export type KisInvestorFlowPromotionStage =
  | 'OBSERVE'
  | 'SHADOW_SCORE'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'GATED'
  | 'CORE';

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function hasRealInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy) && Number.isFinite(record.individualNetBuy);
}

function hasPartialSymbolInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy?: number; tradingDate?: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy);
}

function sampleFromInvestorFields(input: {
  safeCode: string;
  sourceDateKst: string;
  value: { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy?: number; tradingDate?: string };
}): InvestorFlowSample {
  return {
    stockCode: input.safeCode,
    foreignNetBuy: input.value.foreignNetBuy,
    institutionalNetBuy: input.value.institutionalNetBuy,
    ...(Number.isFinite(input.value.individualNetBuy) ? { individualNetBuy: input.value.individualNetBuy as number } : {}),
    provider: 'KIS_API',
    fetchedAt: new Date().toISOString(),
    tradingDate: input.value.tradingDate ?? input.sourceDateKst,
  };
}

export function getKisInvestorFlowPromotionStage(): KisInvestorFlowPromotionStage {
  const raw = process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;
  if (
    raw === 'OBSERVE'
    || raw === 'SHADOW_SCORE'
    || raw === 'ADVISORY'
    || raw === 'WEIGHTED'
    || raw === 'GATED'
    || raw === 'CORE'
  ) {
    return raw;
  }
  return 'WEIGHTED';
}

export function isKisSelectableForRouter(stage: KisInvestorFlowPromotionStage): boolean {
  return stage === 'WEIGHTED' || stage === 'GATED' || stage === 'CORE';
}

function evidenceResult(input: {
  data: InvestorFlowSample | null;
  sample?: KisSymbolInvestorFlowSample | null;
  health: InvestorFlowProviderHealth;
  diagnostic: string;
  promotionStage: KisInvestorFlowPromotionStage;
  selectableForRouter: boolean;
}): KisInvestorFlowEvidenceResult {
  return {
    ...input,
    sample: input.sample ?? null,
    officialSource: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
  };
}

export async function fetchKisInvestorFlowEvidence(code: string, now = new Date()): Promise<KisInvestorFlowEvidenceResult> {
  const safeCode = normalizeCode(code);
  const sourceDateKst = resolveInvestorFlowSourceDateKst(now);
  const promotionStage = getKisInvestorFlowPromotionStage();
  const selectableForRouter = isKisSelectableForRouter(promotionStage);

  try {
    const daily = await fetchKisInvestorTradeByStockDaily(safeCode, 'LOW');
    const foreignInstitution = hasPartialSymbolInvestorFields(daily)
      ? null
      : await fetchKisForeignInstitutionTotal('LOW');
    const kis = hasPartialSymbolInvestorFields(daily) || hasPartialSymbolInvestorFields(foreignInstitution)
      ? null
      : await fetchKisInvestorFlow(safeCode, 'LOW');
    const selected = hasPartialSymbolInvestorFields(daily)
      ? { value: daily, endpoint: 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY', sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY' as const, confidence: hasRealInvestorFields(daily) ? 'VERIFIED' as const : 'DEGRADED' as const, hasRealInvestorFields: hasRealInvestorFields(daily) }
      : hasPartialSymbolInvestorFields(foreignInstitution)
        ? { value: foreignInstitution, endpoint: 'KIS_FOREIGN_INSTITUTION_TOTAL', sourceKind: 'FOREIGN_INSTITUTION_TOTAL' as const, confidence: 'DEGRADED' as const, hasRealInvestorFields: false }
        : hasRealInvestorFields(kis)
          ? { value: kis, endpoint: 'KIS_INQUIRE_INVESTOR_STRICT', sourceKind: 'INQUIRE_INVESTOR' as const, confidence: 'VERIFIED' as const, hasRealInvestorFields: true }
          : null;

    if (selected) {
      const data = sampleFromInvestorFields({ safeCode, sourceDateKst, value: selected.value });
      const sample: KisSymbolInvestorFlowSample = {
        stockCode: safeCode,
        source: 'KIS_API',
        sourceKind: selected.sourceKind,
        ...(Number.isFinite(selected.value.foreignNetBuy) ? { foreignNetBuy: selected.value.foreignNetBuy } : {}),
        ...(Number.isFinite(selected.value.institutionalNetBuy) ? { institutionalNetBuy: selected.value.institutionalNetBuy } : {}),
        ...(Number.isFinite(selected.value.individualNetBuy) ? { individualNetBuy: selected.value.individualNetBuy as number } : {}),
        sourceDate: data.tradingDate ?? sourceDateKst,
        confidence: selected.confidence,
        hasRealFields: selected.hasRealInvestorFields,
        marketSignal: false,
        providerIssue: false,
        executionImpact: 'NONE',
        usableForShadow: selected.confidence === 'VERIFIED' || selected.confidence === 'DEGRADED',
      };
      const diagnostic = [
        `code=${safeCode}`,
        'stage=ADVISORY_CANDIDATE',
        'source=KIS_OFFICIAL_STANDARD_API',
        `endpoint=${selected.endpoint}`,
        `confidence=${selected.confidence}`,
        'safeOfficialSource=true',
        `promotionStage=${promotionStage}`,
        `selectableForRouter=${String(selectableForRouter)}`,
        `hasRealInvestorFields=${String(selected.hasRealInvestorFields)}`,
        `hasPartialInvestorFields=${String(!selected.hasRealInvestorFields)}`,
        `KIS=${selected.confidence === 'DEGRADED' ? 'PARTIAL' : 'OK'}`,
        `sourceDate=${sourceDateKst}`,
        'marketSignal=false',
        'liveExecutionAllowed=false',
        'executionImpact=NONE',
      ].join(';');
      return evidenceResult({
        data,
        sample,
        diagnostic,
        health: makeInvestorFlowProviderHealth({
          provider: 'KIS',
          status: 'OK',
          reason: diagnostic,
          now,
          sourceDateKst: data.tradingDate,
          endpoint: selected.endpoint,
          semantic: {
            foreignNetBuy: data.foreignNetBuy,
            institutionNetBuy: data.institutionalNetBuy,
            ...(Number.isFinite(data.individualNetBuy) ? { individualNetBuy: data.individualNetBuy } : {}),
          },
          retryable: false,
          cacheFallback: true,
        }),
        promotionStage,
        selectableForRouter,
      });
    }

    const diagnostic = [
      `code=${safeCode}`,
      'stage=ADVISORY_CANDIDATE',
      'source=KIS_OFFICIAL_STANDARD_API',
      'safeOfficialSource=true',
      `promotionStage=${promotionStage}`,
      `selectableForRouter=${String(selectableForRouter)}`,
      'hasRealInvestorFields=false',
      'KIS=DATA_UNAVAILABLE',
      'reason=strict investor fields missing',
      'providerIssue=true',
      'marketSignal=false',
      'liveExecutionAllowed=false',
      'executionImpact=NONE',
    ].join(';');
    return evidenceResult({
      data: null,
      diagnostic,
      health: makeInvestorFlowProviderHealth({
        provider: 'KIS',
        status: 'PROVIDER_UNAVAILABLE',
        reason: diagnostic,
        now,
        sourceDateKst,
        endpoint: 'KIS_INQUIRE_INVESTOR_STRICT',
        semanticAvailable: false,
        dataAvailable: false,
        retryable: true,
        cacheFallback: true,
      }),
      promotionStage,
      selectableForRouter,
    });
  } catch (err) {
    const diagnostic = [
      `code=${safeCode}`,
      'stage=ADVISORY_CANDIDATE',
      'source=KIS_OFFICIAL_STANDARD_API',
      'safeOfficialSource=true',
      `promotionStage=${promotionStage}`,
      `selectableForRouter=${String(selectableForRouter)}`,
      'hasRealInvestorFields=false',
      'KIS=ERROR',
      `reason=${err instanceof Error ? err.message : String(err)}`,
      'providerIssue=true',
      'marketSignal=false',
      'liveExecutionAllowed=false',
      'executionImpact=NONE',
    ].join(';');
    return evidenceResult({
      data: null,
      diagnostic,
      health: makeInvestorFlowProviderHealth({
        provider: 'KIS',
        status: 'UNKNOWN_ERROR',
        reason: diagnostic,
        now,
        sourceDateKst,
        endpoint: 'KIS_INQUIRE_INVESTOR_STRICT',
        semanticAvailable: false,
        dataAvailable: false,
        retryable: true,
        cacheFallback: true,
      }),
      promotionStage,
      selectableForRouter,
    });
  }
}
