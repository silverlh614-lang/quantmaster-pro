/** KIS investor-flow evidence adapter. */
import { fetchKisInvestorFlow } from '../clients/kisClient/investorFlowStrict.js';
import { makeInvestorFlowProviderHealth, resolveInvestorFlowSourceDateKst, type InvestorFlowProviderHealth } from './investorFlowProviderHealth.js';
import type { InvestorFlowSample } from './investorFlowRouter.js';

export interface KisInvestorFlowEvidenceResult {
  data: InvestorFlowSample | null;
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
  return 'SHADOW_SCORE';
}

export function isKisSelectableForRouter(stage: KisInvestorFlowPromotionStage): boolean {
  return stage === 'WEIGHTED' || stage === 'GATED' || stage === 'CORE';
}

function evidenceResult(input: {
  data: InvestorFlowSample | null;
  health: InvestorFlowProviderHealth;
  diagnostic: string;
  promotionStage: KisInvestorFlowPromotionStage;
  selectableForRouter: boolean;
}): KisInvestorFlowEvidenceResult {
  return {
    ...input,
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
    const kis = await fetchKisInvestorFlow(safeCode, 'LOW');
    if (hasRealInvestorFields(kis)) {
      const data: InvestorFlowSample = {
        stockCode: safeCode,
        foreignNetBuy: kis.foreignNetBuy,
        institutionalNetBuy: kis.institutionalNetBuy,
        individualNetBuy: kis.individualNetBuy,
        provider: 'KIS_API',
        fetchedAt: new Date().toISOString(),
        tradingDate: sourceDateKst,
      };
      const diagnostic = [
        `code=${safeCode}`,
        'stage=ADVISORY_CANDIDATE',
        'source=KIS_OFFICIAL_STANDARD_API',
        'safeOfficialSource=true',
        `promotionStage=${promotionStage}`,
        `selectableForRouter=${String(selectableForRouter)}`,
        'hasRealInvestorFields=true',
        'KIS=OK',
        `sourceDate=${sourceDateKst}`,
        'liveExecutionAllowed=false',
        'executionImpact=NONE',
      ].join(';');
      return evidenceResult({
        data,
        diagnostic,
        health: makeInvestorFlowProviderHealth({
          provider: 'KIS',
          status: 'OK',
          reason: diagnostic,
          now,
          sourceDateKst,
          endpoint: 'KIS_INQUIRE_INVESTOR_STRICT',
          semantic: {
            foreignNetBuy: data.foreignNetBuy,
            institutionNetBuy: data.institutionalNetBuy,
            individualNetBuy: data.individualNetBuy,
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
