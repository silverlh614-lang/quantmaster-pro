/**
 * kisFinanceClient.ts — KIS 공식 재무 지표(L1) 조회. DART(L2) 펀더멘털 1차 대체 소스 (ADR-0532 Phase 1).
 *
 * @responsibility KIS finance 엔드포인트(financial-ratio/income-statement)에서 ROE/OPM/부채비율을
 *                 캐시 + 서킷 브레이커로 안정 조회하고 QmpDartFinancials 호환 형태로 정규화한다.
 *
 * 단일 통로: 모든 KIS 호출은 realDataKisGet(kisClient) 경유. corp_code 불필요(FID_INPUT_ISCD 6자리 직접).
 * KIS_APP_KEY/SECRET(또는 real-data client) 없으면 null. 24h 인메모리 캐시(분기 데이터).
 * Phase 1 = 인프라 + 정규화 + 진단. gate2 read 경로 연결은 ADR-0532 Phase 3 (소비처 미연결).
 *
 * 미가용(ADR-0532 한계): ICR(이자비용 미분리) · OCF(현금흐름표 엔드포인트 없음) → DART 잔존 책임.
 */

import { realDataKisGet } from './kisClient/http.js';
import { HAS_REAL_DATA_CLIENT } from './kisClient/constants.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';
import { compactError, emitProviderWarn } from '../observability/providerWarn.js';
import type { QmpDartFinancials } from './dartFinancialNormalizer.js';

const FINANCIAL_RATIO = { trId: 'FHKST66430300', path: '/uapi/domestic-stock/v1/finance/financial-ratio' } as const;
const INCOME_STATEMENT = { trId: 'FHKST66430200', path: '/uapi/domestic-stock/v1/finance/income-statement' } as const;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// KIS finance API rate guard — 누적 5xx/네트워크 실패 시 1분 차단 (dart 와 동형).
const _kisFinCb = createCircuitBreaker({ name: 'kis-finance', failureThreshold: 6, windowMs: 60_000, cooldownMs: 60_000 });

export function getKisFinanceCircuitStats() {
  return _kisFinCb.getStats();
}

export interface KisFinancials {
  symbol: string;
  fiscalYearMonth: string | null; // stac_yymm (결산년월)
  roe: number | null; // % (financial-ratio roe_val)
  opm: number | null; // % (income-statement op_prfi / sale_account * 100)
  netMargin: number | null; // % (thtr_ntin / sale_account * 100)
  debtRatio: number | null; // % (financial-ratio lblt_rate)
  eps: number | null;
  bps: number | null;
  revenue: number | null; // sale_account
  operatingIncome: number | null; // op_prfi
  netIncome: number | null; // thtr_ntin
  source: 'KIS_FINANCE';
}

const _cache = new Map<string, { data: KisFinancials; exp: number }>();

function hasKisFinanceCredentials(): boolean {
  return HAS_REAL_DATA_CLIENT || Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** KIS finance 응답의 output(배열/객체) 에서 최신 결산 row(첫 요소) 를 추출. */
function latestRow(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const output = data.output ?? data.output1;
  if (Array.isArray(output)) return output.find(isRecord) ?? null;
  if (isRecord(output)) return output;
  return null;
}

async function fetchFinanceRow(
  endpoint: { trId: string; path: string },
  symbol: string,
  purpose: string,
): Promise<Record<string, unknown> | null> {
  const data = await _kisFinCb.exec(() =>
    realDataKisGet(
      endpoint.trId,
      endpoint.path,
      { FID_DIV_CLS_CODE: '0', fid_cond_mrkt_div_code: 'J', fid_input_iscd: symbol, __kisPurpose: purpose },
      'LOW',
    ),
  );
  return latestRow(data);
}

/**
 * 종목코드로 KIS 재무 핵심 지표 조회 (전년도 연간, financial-ratio + income-statement).
 * KIS_APP_KEY/SECRET 미설정 또는 조회 실패 시 null. 24h 캐시.
 */
export async function getKisFinancials(stockCode: string): Promise<KisFinancials | null> {
  if (!hasKisFinanceCredentials()) return null;
  const symbol = stockCode.padStart(6, '0');

  const hit = _cache.get(symbol);
  if (hit && Date.now() < hit.exp) return hit.data;

  try {
    const ratioRow = await fetchFinanceRow(FINANCIAL_RATIO, symbol, 'GATE2_KIS_FINANCIAL_RATIO');
    const incomeRow = await fetchFinanceRow(INCOME_STATEMENT, symbol, 'GATE2_KIS_INCOME_STATEMENT');
    if (!ratioRow && !incomeRow) return null;

    const revenue = cleanNumber(incomeRow?.sale_account);
    const operatingIncome = cleanNumber(incomeRow?.op_prfi);
    const netIncome = cleanNumber(incomeRow?.thtr_ntin);
    const result: KisFinancials = {
      symbol,
      fiscalYearMonth: typeof ratioRow?.stac_yymm === 'string' ? ratioRow.stac_yymm
        : typeof incomeRow?.stac_yymm === 'string' ? incomeRow.stac_yymm : null,
      roe: cleanNumber(ratioRow?.roe_val),
      opm: revenue && revenue !== 0 && operatingIncome != null ? (operatingIncome / revenue) * 100 : null,
      netMargin: revenue && revenue !== 0 && netIncome != null ? (netIncome / revenue) * 100 : null,
      debtRatio: cleanNumber(ratioRow?.lblt_rate),
      eps: cleanNumber(ratioRow?.eps),
      bps: cleanNumber(ratioRow?.bps),
      revenue,
      operatingIncome,
      netIncome,
      source: 'KIS_FINANCE',
    };
    _cache.set(symbol, { data: result, exp: Date.now() + CACHE_TTL_MS });
    console.log(
      `[KIS/Fin] ${symbol} ${result.fiscalYearMonth ?? 'N/A'}: ROE=${result.roe?.toFixed(1) ?? 'N/A'}% ` +
      `OPM=${result.opm?.toFixed(1) ?? 'N/A'}% DR=${result.debtRatio?.toFixed(0) ?? 'N/A'}%`,
    );
    return result;
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      emitProviderWarn({ source: 'KIS_AUX', message: 'KIS finance circuit open; lookup skipped.', dedupKey: `p2:provider:KIS_AUX:fin-circuit:${symbol}`, fallbackUsed: true, details: { stockCode: symbol } });
    } else {
      emitProviderWarn({ source: 'KIS_AUX', message: 'KIS finance lookup failed.', dedupKey: `p2:provider:KIS_AUX:fin-error:${symbol}`, fallbackUsed: true, details: { stockCode: symbol, compactError: compactError(e) } });
    }
    return null;
  }
}

/**
 * KisFinancials → QmpDartFinancials 호환 매핑 (ADR-0532 Phase 3 read 경로 swap-in 대비).
 * KIS 미가용 축(ocfRatio/interestCoverageRatio/operatingCashFlow/interestExpense)은 null — DART 잔존.
 */
export function kisFinancialsToQmpDartFinancials(kis: KisFinancials): QmpDartFinancials {
  const present = ['operatingCashFlow', 'netIncome'].filter(f => (f === 'netIncome' ? kis.netIncome != null : false));
  const hasData = kis.roe != null || kis.opm != null || kis.revenue != null || kis.netIncome != null;
  return {
    symbol: kis.symbol,
    corpCode: null,
    reportDate: null,
    fiscalYear: kis.fiscalYearMonth ?? undefined,
    quarter: 'ANNUAL',
    revenue: kis.revenue,
    operatingIncome: kis.operatingIncome,
    netIncome: kis.netIncome,
    operatingCashFlow: null,
    interestExpense: null,
    totalEquity: null,
    totalAssets: null,
    ocfRatio: null,
    roe: kis.roe,
    opm: kis.opm,
    opmYoYDelta: null,
    revenueYoYGrowth: null,
    operatingIncomeYoYGrowth: null,
    marginAcceleration: null,
    interestCoverageRatio: null,
    source: 'UNKNOWN',
    providerStatus: hasData ? 'OK_WITH_DATA' : 'FIELD_MISSING',
    dataConfidence: hasData ? 'VERIFIED' : 'DEGRADED',
    providerIssue: !hasData,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    rawFieldCoverage: {
      requiredFields: ['operatingCashFlow', 'netIncome'],
      presentFields: present,
      missingFields: ['operatingCashFlow', 'netIncome'].filter(f => !present.includes(f)),
      allRequiredFieldsPresent: false,
    },
    fetchedAt: new Date().toISOString(),
  };
}

export function __resetKisFinanceCacheForTests(): void {
  _cache.clear();
}
