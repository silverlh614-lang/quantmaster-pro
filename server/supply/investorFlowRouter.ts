/**
 * @responsibility 기관/외인 수급을 provider policy 순서대로 조회하는 안전 라우터.
 *
 * PR-584: KIS 를 기관/외인 수급 primary 에서 제외하고 KRX/Naver/cache 우선 라우터를 만든다.
 * PR-585: CACHE provider 를 실제 영속 cache 로 연결한다.
 * PR-592: 기존 KRX `fetchInvestorTrading` 공개 통계 client 를 KRX_INVESTOR_FLOW provider 로 연결한다.
 * PR-593: KRX no-output 원인을 date/rowCount/sampleCodes 진단 문자열로 노출한다.
 * PR-594: providerTried 요약에 reason 을 포함해 Telegram /sh 에서 진단 문자열이 실제로 보이게 한다.
 * PR-595: KRX 공개 bld 가 전일자 전체 empty rows 를 반환하면 단순 종목 미매칭이 아니라
 * provider upstream unavailable 로 분류한다.
 * PR-596: 장외/주말에는 KRX public investor provider 를 호출하지 않고 OFF_HOURS 로 스킵한다.
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
  | 'OFF_HOURS'
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

interface KrxLookupResult {
  data: InvestorFlowSample | null;
  diagnostic: string;
  unavailable: boolean;
  offHours: boolean;
}

const KRX_INVESTOR_FLOW_DAYS = 5;
const KRX_INVESTOR_FLOW_MIN_SAMPLE = 1;
const ATTEMPT_REASON_MAX_LEN = 220;
const KRX_INVESTOR_CALL_START_MIN = 9 * 60;
const KRX_INVESTOR_CALL_END_MIN = 15 * 60 + 30;

function hasRealInvestorFields(value: unknown): value is { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.foreignNetBuy) && Number.isFinite(record.institutionalNetBuy) && Number.isFinite(record.individualNetBuy);
}

function normalizeCode(code: string): string {
  const digits = code.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

function nowKstParts(now = new Date()): { dow: number; minutes: number; label: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const dow = kst.getUTCDay();
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  return { dow, minutes: hh * 60 + mm, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} KST` };
}

function isKrxInvestorCallWindow(now = new Date()): boolean {
  const kst = nowKstParts(now);
  if (kst.dow === 0 || kst.dow === 6) return false;
  return kst.minutes >= KRX_INVESTOR_CALL_START_MIN && kst.minutes <= KRX_INVESTOR_CALL_END_MIN;
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

function sampleCodes(codes: string[]): string {
  return codes.length > 0 ? codes.slice(0, 6).join(',') : 'NONE';
}

async function fetchKrxInvestorFlow(code: string): Promise<KrxLookupResult> {
  const safeCode = normalizeCode(code);
  if (!/^\d{6}$/.test(safeCode)) return { data: null, diagnostic: `invalid_code:${code}`, unavailable: false, offHours: false };

  if (!isKrxInvestorCallWindow()) {
    const kst = nowKstParts();
    return {
      data: null,
      diagnostic: `code=${safeCode};window=09:00-15:30 KST;now=${kst.label};reason=KRX_PUBLIC_CALL_SKIPPED_OFF_HOURS`,
      unavailable: false,
      offHours: true,
    };
  }

  let foreignNetBuy = 0;
  let institutionalNetBuy = 0;
  let individualNetBuy = 0;
  let sampleSize = 0;
  let latestDate: string | null = null;
  let totalRows = 0;
  const datesTried: string[] = [];
  const sampleCodeSet = new Set<string>();
  const emptyDates: string[] = [];
  const now = new Date();

  for (let i = 0; i < KRX_INVESTOR_FLOW_DAYS; i += 1) {
    const ymd = previousBusinessDayYmd(now, i);
    datesTried.push(ymd);
    const rows = await fetchInvestorTrading(ymd);
    totalRows += rows.length;
    if (rows.length === 0) {
      emptyDates.push(ymd);
      continue;
    }
    for (const r of rows.slice(0, 10)) sampleCodeSet.add(normalizeCode(String(r.code ?? '')));
    const row = rows.find((r) => normalizeCode(String(r.code ?? '')) === safeCode);
    if (!row) continue;
    foreignNetBuy += Number(row.foreignNetBuy ?? 0);
    institutionalNetBuy += Number(row.institutionNetBuy ?? 0);
    individualNetBuy += Number(row.individualNetBuy ?? 0);
    sampleSize += 1;
    if (!latestDate) latestDate = ymdToDate(ymd);
  }

  const allDatesEmpty = datesTried.length > 0 && totalRows === 0 && emptyDates.length === datesTried.length;
  const upstream = allDatesEmpty ? 'KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400' : 'OK';
  const diagnostic = [
    `code=${safeCode}`,
    `sample=${sampleSize}`,
    `dates=${datesTried.join(',')}`,
    `rows=${totalRows}`,
    `empty=${emptyDates.length > 0 ? emptyDates.join(',') : 'NONE'}`,
    `sampleCodes=${sampleCodes([...sampleCodeSet])}`,
    `upstream=${upstream}`,
  ].join(';');

  if (sampleSize < KRX_INVESTOR_FLOW_MIN_SAMPLE || !latestDate) return { data: null, diagnostic, unavailable: allDatesEmpty, offHours: false };

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

  return { data: sample, diagnostic, unavailable: false, offHours: false };
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

function compactReason(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  return oneLine.length > ATTEMPT_REASON_MAX_LEN ? `${oneLine.slice(0, ATTEMPT_REASON_MAX_LEN)}…` : oneLine;
}

export function summarizeInvestorFlowAttempts(attempts: InvestorFlowAttempt[]): string {
  return attempts
    .map((a) => `${a.provider}:${a.status}${a.reason ? `(${compactReason(a.reason)})` : ''}`)
    .join(' / ');
}

export async function fetchInvestorFlowWithPolicy(code: string): Promise<InvestorFlowRouteResult> {
  const attempts: InvestorFlowAttempt[] = [];

  try {
    const krx = await fetchKrxInvestorFlow(code);
    if (krx.data && hasRealInvestorFields(krx.data)) {
      pushAttempt(attempts, 'KRX_INVESTOR_FLOW', 'OK', krx.diagnostic);
      return { stockCode: code, data: krx.data, attempts, status: 'OK', source: 'KRX_INVESTOR_FLOW' };
    }
    pushAttempt(attempts, 'KRX_INVESTOR_FLOW', krx.offHours ? 'OFF_HOURS' : krx.unavailable ? 'ERROR' : 'NO_OUTPUT', krx.diagnostic);
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
