/**
 * @responsibility KRX OpenAPI 인증 종목 마스터 페치 — KOSPI/KOSDAQ 종목기본정보 단일 통로 (Tier 0)
 *
 * `data.krx.co.kr/comm/fileDn` 비인증 다운로드가 4/27 이후 'LOGOUT' 응답으로 영구 실패하던
 * 결함의 영구 해결책. KRX 가 발급한 AUTH_KEY 로 `openapi.krx.co.kr` (또는 data-dbg) 에 접근.
 *
 * 호출자: `multiSourceStockMaster.refreshMultiSourceMaster()` 의 Tier 0.
 * 비인증 다운로드(`fetchKrxMasterEntries`) 는 fallback (Tier 1) 으로 보존.
 */

import {
  fetchKospiBaseInfo,
  fetchKosdaqBaseInfo,
  isKrxOpenApiHealthy,
  getKrxOpenApiStatus,
  recentBusinessDaysKst,
  getKrxOpenApiEndpointPath,
  type KrxIsuBaseInfoRow,
} from './krxOpenApi.js';
import { formatRawProbeSummary, probeKrxOpenApiBases } from './krxOpenApiRawProbe.js';
import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';

/** OpenAPI 페치 결과 사유 — orchestrator 가 attempts[].reason 에 그대로 노출. */
export type KrxOpenApiFetchReason =
  | 'DISABLED'        // AUTH_KEY 미설정 또는 KRX_OPENAPI_DISABLED=true 또는 서킷 OPEN
  | 'KOSPI_EMPTY'     // KOSDAQ 만 받음
  | 'KOSDAQ_EMPTY'    // KOSPI 만 받음
  | 'EMPTY_PARSE'     // 양쪽 모두 0건 (응답 정상이지만 매핑 실패)
  | 'EXCEPTION';      // 예외 throw

export interface KrxOpenApiFetchResult {
  ok: boolean;
  entries: StockMasterEntry[];
  kospiCount: number;
  kosdaqCount: number;
  reason?: KrxOpenApiFetchReason;
  detail?: string;
}

export interface KrxOpenApiMasterDiagnostics {
  parserBranch: 'KOSPI_BASE_INFO+KOSDAQ_BASE_INFO';
  base: string;
  circuitState: string;
  failures: number;
  authKeyConfigured: boolean;
  enabled: boolean;
  cacheKeys: string[];
  basDd?: string;
  dateAttempts?: string[];
  kospiRows: number;
  kosdaqRows: number;
  kospiMapped: number;
  kosdaqMapped: number;
  expectedFields: string[];
  actualKospiSampleKeys: string[];
  actualKosdaqSampleKeys: string[];
  actualKospiSample: Record<string, unknown> | null;
  actualKosdaqSample: Record<string, unknown> | null;
  rawProbeSummary?: string;
}

const EXPECTED_BASE_INFO_FIELDS = [
  'code',
  'name',
  'isin',
  'listDate',
  'market',
  'securityType',
  'listedShares',
] as const;

function sampleKeys(row: unknown): string[] {
  if (!row || typeof row !== 'object') return [];
  return Object.keys(row as Record<string, unknown>).slice(0, 20);
}

function sampleRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>).slice(0, 10)) out[k] = v;
  return out;
}

export function buildOpenApiMasterDiagnostics(input: {
  kospiRows: KrxIsuBaseInfoRow[];
  kosdaqRows: KrxIsuBaseInfoRow[];
  kospiMapped: number;
  kosdaqMapped: number;
  basDd?: string;
  dateAttempts?: string[];
  rawProbeSummary?: string;
}): KrxOpenApiMasterDiagnostics {
  const status = getKrxOpenApiStatus();
  return {
    parserBranch: 'KOSPI_BASE_INFO+KOSDAQ_BASE_INFO',
    base: status.base,
    circuitState: status.circuitState,
    failures: status.failures,
    authKeyConfigured: status.authKeyConfigured,
    enabled: status.enabled,
    cacheKeys: status.cacheKeys.slice(0, 8),
    basDd: input.basDd,
    dateAttempts: input.dateAttempts,
    kospiRows: input.kospiRows.length,
    kosdaqRows: input.kosdaqRows.length,
    kospiMapped: input.kospiMapped,
    kosdaqMapped: input.kosdaqMapped,
    expectedFields: [...EXPECTED_BASE_INFO_FIELDS],
    actualKospiSampleKeys: sampleKeys(input.kospiRows[0]),
    actualKosdaqSampleKeys: sampleKeys(input.kosdaqRows[0]),
    actualKospiSample: sampleRow(input.kospiRows[0]),
    actualKosdaqSample: sampleRow(input.kosdaqRows[0]),
    rawProbeSummary: input.rawProbeSummary,
  };
}

export function formatOpenApiMasterDiagnostics(d: KrxOpenApiMasterDiagnostics): string {
  return [
    `branch=${d.parserBranch}`,
    `base=${d.base}`,
    d.basDd ? `basDd=${d.basDd}` : '',
    d.dateAttempts?.length ? `dateAttempts=${d.dateAttempts.join('|')}` : '',
    `enabled=${d.enabled}`,
    `auth=${d.authKeyConfigured}`,
    `circuit=${d.circuitState}`,
    `failures=${d.failures}`,
    `rows=${d.kospiRows}/${d.kosdaqRows}`,
    `mapped=${d.kospiMapped}/${d.kosdaqMapped}`,
    `expected=${d.expectedFields.join('|')}`,
    `kospiKeys=${d.actualKospiSampleKeys.join('|') || 'NONE'}`,
    `kosdaqKeys=${d.actualKosdaqSampleKeys.join('|') || 'NONE'}`,
    d.rawProbeSummary ? `rawProbe=${d.rawProbeSummary}` : '',
  ].filter(Boolean).join(';');
}

function logOpenApiMasterParseFailure(reason: KrxOpenApiFetchReason, d: KrxOpenApiMasterDiagnostics): void {
  console.warn('[KRX_MASTER_PARSE_DIAG]', {
    reason,
    parserBranch: d.parserBranch,
    base: d.base,
    basDd: d.basDd,
    dateAttempts: d.dateAttempts,
    enabled: d.enabled,
    authKeyConfigured: d.authKeyConfigured,
    circuitState: d.circuitState,
    failures: d.failures,
    rowCounts: { kospiRows: d.kospiRows, kosdaqRows: d.kosdaqRows },
    mappedCounts: { kospiMapped: d.kospiMapped, kosdaqMapped: d.kosdaqMapped },
    expectedFields: d.expectedFields,
    actualTopLevelKeys: {
      kospi: d.actualKospiSampleKeys,
      kosdaq: d.actualKosdaqSampleKeys,
    },
    sampleRows: {
      kospi: d.actualKospiSample,
      kosdaq: d.actualKosdaqSample,
    },
    rawProbeSummary: d.rawProbeSummary,
    cacheKeys: d.cacheKeys,
  });
}

/**
 * `KrxIsuBaseInfoRow[]` → `StockMasterEntry[]` 매핑 (테스트 가능하도록 분리).
 * 6자리 코드 검증 + dedup. market 은 호출자(KOSPI/KOSDAQ endpoint) 가 결정.
 *
 * ADR-0455: 옵셔널 enrichment 필드 (isin/listDate/listedShares/nameEng) 를 그대로 propagate.
 * 모든 필드 옵셔널 — 부재 시 entry 에 미설정 (후방호환 보존).
 */
export function mapBaseInfoToMaster(
  rows: KrxIsuBaseInfoRow[],
  market: 'KOSPI' | 'KOSDAQ',
): StockMasterEntry[] {
  const out: StockMasterEntry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (!r.code || !r.name) continue;
    if (!/^\d{6}$/.test(r.code)) continue;
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    const entry: StockMasterEntry = { code: r.code, name: r.name, market };
    if (r.securityType && r.securityType !== '주권') entry.securityType = r.securityType;
    // ADR-0455: enrichment 필드 propagate — 빈 문자열 / NaN / 0 거부.
    if (r.isin && /^[A-Z0-9]{12}$/i.test(r.isin)) entry.isin = r.isin.toUpperCase();
    if (r.listDate && /^\d{4}[-/]?\d{2}[-/]?\d{2}$/.test(r.listDate)) {
      entry.listDate = r.listDate.replace(/[/]/g, '-');
    }
    if (typeof r.listedShares === 'number' && Number.isFinite(r.listedShares) && r.listedShares > 0) {
      entry.listedShares = r.listedShares;
    }
    if (r.nameEng && typeof r.nameEng === 'string' && r.nameEng.trim().length > 0) {
      entry.nameEng = r.nameEng.trim();
    }
    out.push(entry);
  }
  return out;
}

async function buildRawProbeSummaryForDate(basDd: string): Promise<string> {
  const [kospi, kosdaq] = await Promise.all([
    probeKrxOpenApiBases(getKrxOpenApiEndpointPath('kospiBaseInfo'), { basDd }),
    probeKrxOpenApiBases(getKrxOpenApiEndpointPath('kosdaqBaseInfo'), { basDd }),
  ]);
  const kospiSummary = formatRawProbeSummary(kospi);
  const kosdaqSummary = formatRawProbeSummary(kosdaq);
  if (kospiSummary === kosdaqSummary) return kospiSummary;
  return `KOSPI[${kospiSummary}] KOSDAQ[${kosdaqSummary}]`;
}

/**
 * KOSPI + KOSDAQ 종목기본정보 병렬 호출 후 단일 entries 배열로 합성.
 *
 * 정책:
 * - AUTH_KEY 미설정/서킷 OPEN/DISABLED: 즉시 ok=false + reason='DISABLED' (fallback 진입).
 * - 최근 5영업일을 순차 시도한다. 특정 basDd 가 빈 응답이면 이전 영업일을 확인한다.
 * - 양쪽 모두 0건: ok=false + reason='EMPTY_PARSE'.
 * - 한쪽만 0건: 남은 쪽 entries 보존 + ok=false + reason 으로 호출자에게 보고
 *   (호출자가 검증 게이트로 결정 — 부분 데이터로는 KRX_MIN_VALID_ENTRIES=2000 통과 불가).
 * - 양쪽 정상: ok=true + KOSPI+KOSDAQ 합산.
 */
export async function fetchMasterFromOpenApi(): Promise<KrxOpenApiFetchResult> {
  if (!isKrxOpenApiHealthy()) {
    return { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'DISABLED' };
  }
  try {
    const dateAttempts = recentBusinessDaysKst(5);
    let lastFailure: KrxOpenApiFetchResult | null = null;
    let lastDiag: KrxOpenApiMasterDiagnostics | null = null;

    for (const basDd of dateAttempts) {
      const [kospiRows, kosdaqRows] = await Promise.all([
        fetchKospiBaseInfo(basDd),
        fetchKosdaqBaseInfo(basDd),
      ]);
      const kospiEntries = mapBaseInfoToMaster(kospiRows, 'KOSPI');
      const kosdaqEntries = mapBaseInfoToMaster(kosdaqRows, 'KOSDAQ');
      const diag = buildOpenApiMasterDiagnostics({
        kospiRows,
        kosdaqRows,
        kospiMapped: kospiEntries.length,
        kosdaqMapped: kosdaqEntries.length,
        basDd,
        dateAttempts,
      });
      const detail = formatOpenApiMasterDiagnostics(diag);

      if (kospiEntries.length > 0 && kosdaqEntries.length > 0) {
        return {
          ok: true,
          entries: [...kospiEntries, ...kosdaqEntries],
          kospiCount: kospiEntries.length,
          kosdaqCount: kosdaqEntries.length,
          detail: `selectedBasDd=${basDd};dateAttempts=${dateAttempts.join('|')}`,
        };
      }

      lastDiag = diag;
      if (kospiEntries.length === 0 && kosdaqEntries.length === 0) {
        lastFailure = { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'EMPTY_PARSE', detail };
        continue;
      }
      if (kospiEntries.length === 0) {
        lastFailure = {
          ok: false,
          entries: kosdaqEntries,
          kospiCount: 0,
          kosdaqCount: kosdaqEntries.length,
          reason: 'KOSPI_EMPTY',
          detail,
        };
        continue;
      }
      lastFailure = {
        ok: false,
        entries: kospiEntries,
        kospiCount: kospiEntries.length,
        kosdaqCount: 0,
        reason: 'KOSDAQ_EMPTY',
        detail,
      };
    }

    if (lastDiag) {
      const rawProbeSummary = await buildRawProbeSummaryForDate(lastDiag.basDd ?? dateAttempts[0]);
      lastDiag = { ...lastDiag, rawProbeSummary };
      const detail = formatOpenApiMasterDiagnostics(lastDiag);
      logOpenApiMasterParseFailure((lastFailure?.reason ?? 'EMPTY_PARSE') as KrxOpenApiFetchReason, lastDiag);
      return {
        ...(lastFailure ?? { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'EMPTY_PARSE' as const }),
        detail,
      };
    }

    return { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'EMPTY_PARSE' };
  } catch (e) {
    return {
      ok: false,
      entries: [],
      kospiCount: 0,
      kosdaqCount: 0,
      reason: 'EXCEPTION',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
