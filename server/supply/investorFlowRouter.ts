/**
 * @responsibility 기관/외인 수급을 provider policy 순서대로 조회하는 안전 라우터.
 *
 * PR-584: KIS 를 기관/외인 수급 primary 에서 제외하고 KRX/Naver/cache 우선 라우터를 만든다.
 * PR-585: CACHE provider 를 실제 영속 cache 로 연결한다. KRX/Naver 는 아직 NOT_WIRED 이며,
 * KIS 는 diagnostic 으로만 호출한다. 실데이터 없이 fake-zero 를 만들지 않는다.
 * PR-592: 기존 KRX `fetchInvestorTrading` 공개 통계 client 를 KRX_INVESTOR_FLOW provider 로 연결한다.
 */

import { fetchKisInvestorFlow } from '../clients/kisClient/index.js';
import { fetchInvestorTrading } from '../clients/krxClient.js';
import {
  loadInvestorFlowCache as loadInvestorFlowCacheFromRepo,
  upsertInvestorFlowCache,
} from '../persistence/investorFlowCacheRepo.js';
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

const KRX_INVESTOR_FLOW_DAYS = 5;
const KRX_INVESTOR_FLOW_MIN_SAMPLE = 1;

function hasRealInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy) && Number.isFinite(record.individualNetBuy);
}

function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function previousBusinessDayYmd(now: Date, offset: number): string {
  const t = new Date(now.getTime());
  let consumed = 0;
  while (consumed <= offset) {
    if (consumed > 0) t.setUTCDate(t.getUTCDate() - 1);
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      if (consumed === offset) break;
      consumed += 1;
    } else {
      t.setUTCDate(t.getUTCDate() - 1);
    }
  }
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function ymdToDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

async function fetchKrxInvestorFlow(code: string): Promise<InvestorFlowSample | null> {
  const safeCode = normalizeCode(code);
  if (!/^\d{6}$/.test(safeCode)) return null;

  let foreignNetBuy = 0;
  let institutionalNetBuy = 0;
  let individualNetBuy = 0;
  let sampleSize = 0;
  let latestDate: string | null = null;
  const now = new Date();

  for (let i = 0; i < KRX_INVESTOR_FLOW_DAYS; i += 1) {
    const ymd = previousBusinessDayYmd(now, i);
    const rows = await fetchInvestorTrading(ymd);
    const row = rows.find((r) => r.code === safeCode);
    if (!row) continue;
    foreignNetBuy += Number(row.foreignNetBuy ?? 0);
    institutionalNetBuy += Number(row.institutionNetBuy ?? 0);
    individualNetBuy += Number(row.individualNetBuy ?? 0);
    sampleSize += 1;
    if (!latestDate) latestDate = ymdToDate(ymd);
  }

  if (sampleSize < KRX_INVESTOR_FLOW_MIN_SAMPLE || !latestDate) return null;

  const sample: InvestorFlowSample = {
    stockCode: safeCode,
    foreignNetBuy,
    institutionalNetBuy,
    individualNetBuy,
    provider: 'KRX_INVESTOR_FLOW',
    fetchedAt: new Date().toISOString(),
  };

  upsertInvestorFlowCache({
    stockCode: safeCode,
    date: latestDate,
    foreignNetBuy,
    institutionalNetBuy,
    individualNetBuy,
    provider: 'KRX_INVESTOR_FLOW',
    fetchedAt: sample.fetchedAt,
  });

  return sample;
}

async function fetchNaverInvestorTrend(_code: string): Promise<InvestorFlowSample | null> {
  // NAVER_FOREIGNER_RATIO 는 보유율 추세 provider 이며 순매수 semantic field 가 없다.
  // fake-zero 방지를 위해 외인/기관/개인 순매수 필드가 검증되는 endpoint 전에는 NOT_WIRED 유지.
  return null;
}

async function loadInvestorFlowCache(code: string): Promise<InvestorFlowSample | null> {
  return loadInvestorFlowCacheFromRepo(code);
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
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'NO_OUTPUT', 'KRX investor trading row not available');
  } catch (err) {
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'ERROR', err instanceof Error ? err.message : String(err));
  }

  try {
    const naver = await fetchNaverInvestorTrend(code);
    if (naver && hasRealInvestorFields(naver)) {
      pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'OK');
      return { stockCode: code, data: naver, attempts, status: 'OK', source: 'NAVER_INVESTOR_TREND' };
    }
    pushAttempt(attempts, 'NAVER_INVESTOR_TREND', 'NOT_WIRED', 'semantic net-buy collector not implemented');
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
