/**
 * @responsibility 기관/외인 수급을 provider policy 순서대로 조회하는 안전 라우터.
 *
 * PR-584: KIS 를 기관/외인 수급 primary 에서 제외하고 KRX/Naver/cache 우선 라우터를 만든다.
 * 현재 PR 은 skeleton 단계다. KRX/Naver/cache 실제 수집기가 연결되기 전까지는 NOT_WIRED/CACHE_EMPTY 로
 * 안전 반환하고, KIS 는 diagnostic 으로만 호출한다. 실데이터 없이 fake-zero 를 만들지 않는다.
 */

import { fetchKisInvestorFlow } from '../clients/kisClient/index.js';
import type { SupplyProvider } from './supplyProviderPolicy.js';

export interface InvestorFlowSample {
  stockCode: string;
  foreignNetBuy: number;
  institutionalNetBuy: number;
  individualNetBuy: number;
  provider: Extract<SupplyProvider, 'KRX_INVESTOR_FLOW' | 'NAVER_INVESTOR_TREND' | 'CACHE'>;
  fetchedAt: string;
}

export type InvestorFlowAttemptStatus =
  | 'OK'
  | 'NOT_WIRED'
  | 'CACHE_EMPTY'
  | 'PROVIDER_MISMATCH'
  | 'NO_OUTPUT'
  | 'ERROR';

export interface InvestorFlowAttempt {
  provider: SupplyProvider;
  status: InvestorFlowAttemptStatus;
  reason?: string;
}

export interface InvestorFlowRouteResult {
  stockCode: string;
  data: InvestorFlowSample | null;
  attempts: InvestorFlowAttempt[];
  status: 'OK' | 'PROVIDER_MISMATCH' | 'PROVIDER_UNAVAILABLE' | 'CACHE_EMPTY';
  source: SupplyProvider | null;
}

function hasRealInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy) && Number.isFinite(record.individualNetBuy);
}

async function fetchKrxInvestorFlow(_code: string): Promise<InvestorFlowSample | null> {
  // TODO(PR-585): wire KRX investor-by-stock/provider endpoint or CSV/OTP collector.
  return null;
}

async function fetchNaverInvestorTrend(_code: string): Promise<InvestorFlowSample | null> {
  // TODO(PR-586): wire Naver investor trend parser with semantic field validation.
  return null;
}

async function loadInvestorFlowCache(_code: string): Promise<InvestorFlowSample | null> {
  // TODO(PR-587): read same-day/previous-valid investor-flow cache with confidence decay.
  return null;
}

function pushAttempt(attempts: InvestorFlowAttempt[], provider: SupplyProvider, status: InvestorFlowAttemptStatus, reason?: string): void {
  attempts.push({ provider, status, ...(reason ? { reason } : {}) });
}

export function summarizeInvestorFlowAttempts(attempts: InvestorFlowAttempt[]): string {
  return attempts.map((a) => `${a.provider}:${a.status}`).join(' / ');
}

export async function fetchInvestorFlowWithPolicy(code: string): Promise<InvestorFlowRouteResult> {
  const attempts: InvestorFlowAttempt[] = [];

  try {
    const krx = await fetchKrxInvestorFlow(code);
    if (krx && hasRealInvestorFields(krx)) {
      pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'OK');
      return { stockCode: code, data: krx, attempts, status: 'OK', source: 'KRX_INVESTOR_FLOW' };
    }
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'NOT_WIRED', 'collector not implemented');
  } catch (err) {
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const naver = await fetchNaverInvestorTrend(code);
    if (naver && hasRealInvestorFields(naver)) {
      pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'OK');
      return { stockCode: code, data: naver, attempts, status: 'OK', source: 'NAVER_INVESTOR_TREND' };
    }
    pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'NOT_WIRED', 'collector not implemented');
  } catch (err) {
    pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const cached = await loadInvestorFlowCache(code);
    if (cached && hasRealInvestorFields(cached)) {
      pushAttempt(attempts, 'CACHE', 'OK');
      return { stockCode: code, data: cached, attempts, status: 'OK', source: 'CACHE' };
    }
    pushAttempt(attempts, 'CACHE', 'CACHE_EMPTY', 'no usable investor-flow cache');
  } catch (err) {
    pushAttempt(attempts, 'CACHE', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const kisDiagnostic = await fetchKisInvestorFlow(code, 'LOW');
    if (kisDiagnostic && hasRealInvestorFields(kisDiagnostic)) {
      pushAttempt(attempts, 'KIS_API', 'PROVIDER_MISMATCH', 'KIS is diagnostic-only for investor flow policy');
    } else {
      pushAttempt(attempts, 'KIS_API', 'PROVIDER_MISMATCH', 'missing investor net-buy semantic fields');
    }
  } catch (err) {
    pushAttempt(attempts, 'KIS_API', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  const hasHardProviderError = attempts.some((a) => a.provider !== 'KIS_API' && a.status === 'ERROR');
  return {
    stockCode: code,
    data: null,
    attempts,
    status: hasHardProviderError ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_MISMATCH',
    source: null,
  };
}
