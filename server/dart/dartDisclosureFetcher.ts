// @responsibility DART 공시목록 안전 조회
import { getDartApiKey, type DartPreNewsConfig } from './dartPreNewsConfig.js';
import type { DartDisclosureRecord, DartFetchResult } from './dartPreNewsTypes.js';

interface OpenDartListRow {
  corp_code?: string;
  corp_name?: string;
  stock_code?: string;
  corp_cls?: string;
  report_nm?: string;
  rcept_no?: string;
  flr_nm?: string;
  rcept_dt?: string;
  rm?: string;
}

interface OpenDartListResponse {
  status?: string;
  message?: string;
  list?: OpenDartListRow[];
}

function yyyymmdd(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function receivedAtFromDartDate(date?: string): string {
  if (!date || !/^\d{8}$/.test(date)) return new Date().toISOString();
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`;
}

function marketFromCorpCls(corpCls?: string): DartDisclosureRecord['market'] {
  if (corpCls === 'Y') return 'KOSPI';
  if (corpCls === 'K') return 'KOSDAQ';
  if (corpCls === 'N') return 'KONEX';
  return 'UNKNOWN';
}

function toRecord(row: OpenDartListRow): DartDisclosureRecord | null {
  if (!row.rcept_no || !row.corp_name || !row.report_nm) return null;
  return {
    corpCode: row.corp_code,
    stockCode: row.stock_code && row.stock_code.trim() ? row.stock_code : undefined,
    corpName: row.corp_name,
    market: marketFromCorpCls(row.corp_cls),
    disclosureId: row.rcept_no,
    disclosureTitle: row.report_nm,
    disclosureType: row.report_nm,
    receivedAt: receivedAtFromDartDate(row.rcept_dt),
    reportUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(row.rcept_no)}`,
  };
}

export async function fetchDartDisclosures(config: DartPreNewsConfig, apiKey = getDartApiKey()): Promise<DartFetchResult> {
  if (!apiKey) {
    return {
      disclosures: [],
      providerIssue: true,
      dataHealth: 'MISSING',
      reasons: ['PROVIDER_DART_API_KEY_MISSING'],
      missingData: ['DART_API_KEY'],
      executionImpact: 'NONE',
    };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - config.lookbackDays);
  const url = new URL('https://opendart.fss.or.kr/api/list.json');
  url.searchParams.set('crtfc_key', apiKey);
  url.searchParams.set('bgn_de', yyyymmdd(start));
  url.searchParams.set('end_de', yyyymmdd(end));
  url.searchParams.set('page_count', String(Math.min(config.maxDisclosuresPerRun, 100)));
  url.searchParams.set('page_no', '1');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status === 429) {
      return { disclosures: [], providerIssue: true, dataHealth: 'DEGRADED', reasons: ['PROVIDER_DART_RATE_LIMIT'], missingData: [], executionImpact: 'NONE' };
    }
    if (!res.ok) {
      return { disclosures: [], providerIssue: true, dataHealth: 'DEGRADED', reasons: ['PROVIDER_DART_EMPTY_RESPONSE'], missingData: [], executionImpact: 'NONE' };
    }
    const json = await res.json() as OpenDartListResponse;
    if (json.status && json.status !== '000') {
      const reason = json.status === '013' ? 'PROVIDER_DART_EMPTY_RESPONSE' : 'PROVIDER_DART_BODY_FETCH_FAILED';
      return { disclosures: [], providerIssue: true, dataHealth: 'DEGRADED', reasons: [reason], missingData: [], executionImpact: 'NONE' };
    }
    const disclosures = (json.list ?? []).map(toRecord).filter((r): r is DartDisclosureRecord => r !== null).slice(0, config.maxDisclosuresPerRun);
    if (disclosures.length === 0) {
      return { disclosures: [], providerIssue: true, dataHealth: 'MISSING', reasons: ['PROVIDER_DART_EMPTY_RESPONSE'], missingData: ['list'], executionImpact: 'NONE' };
    }
    return { disclosures, providerIssue: false, dataHealth: 'VERIFIED', reasons: [], missingData: [], executionImpact: 'NONE' };
  } catch {
    return { disclosures: [], providerIssue: true, dataHealth: 'DEGRADED', reasons: ['PROVIDER_DART_EMPTY_RESPONSE'], missingData: [], executionImpact: 'NONE' };
  }
}
