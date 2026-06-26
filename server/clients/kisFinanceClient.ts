/**
 * kisFinanceClient.ts — KIS 공식 재무 지표(L1) 조회. DART(L2) 펀더멘털 1차 대체 소스 (ADR-0532).
 *
 * @responsibility KIS finance 엔드포인트(financial-ratio/income-statement/stability-ratio)에서 ROE/OPM/
 *                 부채비율/유동비율/YoY 성장을 캐시 + 서킷 브레이커로 조회하고 QmpDartFinancials 로 정규화한다.
 *
 * 단일 통로: 모든 KIS 호출은 realDataKisGet(kisClient) 경유. corp_code 불필요(FID_INPUT_ISCD 6자리 직접).
 * KIS_APP_KEY/SECRET(또는 real-data client) 없으면 null. 24h 인메모리 캐시(분기 데이터).
 * gate2 read 경로 연결은 ADR-0532 Phase 3 (getGate2DartFinancialsForEvaluation flag-on).
 *
 * ADR-0532 확장: financial-ratio 응답의 grs/bsop_prfi_inrt/ntin_inrt(YoY 성장)을 추가 추출(0 추가 호출) +
 *               stability-ratio 1콜로 유동비율 보강 → roe/opm/debtRatio/currentRatio/netMargin/YoY 모두 KIS.
 * 미가용(KIS 한계, 사용자 지시로 DART 잔존 유지): ICR(이자비용 미분리) · OCF(현금흐름표 엔드포인트 없음).
 */

import { realDataKisGet } from './kisClient/http.js';
import { HAS_REAL_DATA_CLIENT } from './kisClient/constants.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';
import { compactError, emitProviderWarn } from '../observability/providerWarn.js';
import type { QmpDartFinancials } from './dartFinancialNormalizer.js';

const FINANCIAL_RATIO = { trId: 'FHKST66430300', path: '/uapi/domestic-stock/v1/finance/financial-ratio' } as const;
const INCOME_STATEMENT = { trId: 'FHKST66430200', path: '/uapi/domestic-stock/v1/finance/income-statement' } as const;
const STABILITY_RATIO = { trId: 'FHKST66430600', path: '/uapi/domestic-stock/v1/finance/stability-ratio' } as const;
// ADR-0655 — profit-ratio: ROE 대체(self_cptl_ntin_inrt 자기자본순이익율)·순이익률 대체(sale_ntin_rate).
const PROFIT_RATIO = { trId: 'FHKST66430400', path: '/uapi/domestic-stock/v1/finance/profit-ratio' } as const;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// KIS finance API rate guard — 누적 5xx/네트워크 실패 시 1분 차단 (dart 와 동형).
const _kisFinCb = createCircuitBreaker({ name: 'kis-finance', failureThreshold: 6, windowMs: 60_000, cooldownMs: 60_000 });

export function getKisFinanceCircuitStats() {
  return _kisFinCb.getStats();
}

/**
 * ADR-0655 — 재무 metric 별 출처·신뢰 등급 분류 (Gate2 재무위험 trace·텔레그램 표시용).
 * - KIS_L1: KIS 공식 finance ratio 엔드포인트 직접 필드 (lblt_rate/crnt_rate/roe_val 등).
 * - KIS_DERIVED: KIS 원천 raw 로 산출 (opm = op_prfi/sale_account 등).
 * - DART_L2_RESIDUAL: KIS 미가용 축을 DART 잔존 머지로 보강 (interestCoverageRatio — KIS 이자비용 미분리).
 * - UNAVAILABLE: 결손 (값 null).
 */
export type KisFinanceFieldSource = 'KIS_L1' | 'KIS_DERIVED' | 'DART_L2_RESIDUAL' | 'UNAVAILABLE';

export interface KisFinancials {
  symbol: string;
  fiscalYearMonth: string | null; // stac_yymm (결산년월)
  roe: number | null; // % (financial-ratio roe_val) — source KIS_L1
  opm: number | null; // % (income-statement op_prfi / sale_account * 100) — source KIS_DERIVED
  netMargin: number | null; // % (thtr_ntin / sale_account * 100) — source KIS_DERIVED
  debtRatio: number | null; // % (financial-ratio lblt_rate / stability-ratio lblt_rate) — source KIS_L1
  currentRatio: number | null; // % (stability-ratio crnt_rate) — source KIS_L1
  /**
   * ADR-0655 — 이자보상배율. KIS finance ratio 엔드포인트는 이자비용(interestExpense)을
   * bsop_non_expn(영업외비용)에 묶어 노출하므로 *분리 불가* → KIS 단독 산출 불가.
   * 정확한 ICR 은 DART 잔존(QmpDartFinancials.interestCoverageRatio, L2) 머지에서만 온다.
   * 본 client 산출 시 항상 null (DART_L2_RESIDUAL / UNAVAILABLE). KisFinancials 자체로는 미가용.
   */
  interestCoverageRatio: number | null; // source DART_L2_RESIDUAL | UNAVAILABLE (KIS 단독 null)
  revenueYoYGrowth: number | null; // % (financial-ratio grs, 매출액증가율)
  operatingIncomeYoYGrowth: number | null; // % (financial-ratio bsop_prfi_inrt, 영업이익증가율)
  marginAcceleration: number | null; // pp (영업이익증가율 - 매출액증가율; non-gating, 부호 기반)
  eps: number | null;
  bps: number | null;
  revenue: number | null; // sale_account
  operatingIncome: number | null; // op_prfi
  netIncome: number | null; // thtr_ntin
  /** ADR-0655 — metric 별 출처 분류 (관측 trace, 값 무변경). */
  fieldSources: {
    roe: KisFinanceFieldSource;
    opm: KisFinanceFieldSource;
    debtRatio: KisFinanceFieldSource;
    currentRatio: KisFinanceFieldSource;
    interestCoverageRatio: KisFinanceFieldSource;
  };
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
    // stability-ratio(유동비율)는 보강용 best-effort — 실패해도 핵심 결과를 막지 않는다.
    const stabilityRow = await fetchFinanceRow(STABILITY_RATIO, symbol, 'GATE2_KIS_STABILITY_RATIO').catch(() => null);

    const revenue = cleanNumber(incomeRow?.sale_account);
    const operatingIncome = cleanNumber(incomeRow?.op_prfi);
    const netIncome = cleanNumber(incomeRow?.thtr_ntin);
    // YoY 성장은 financial-ratio 응답에 이미 포함(grs/bsop_prfi_inrt/ntin_inrt) — 추가 호출 없이 추출.
    const revenueYoYGrowth = cleanNumber(ratioRow?.grs);
    const operatingIncomeYoYGrowth = cleanNumber(ratioRow?.bsop_prfi_inrt);

    // ADR-0655 — ROE(financial-ratio roe_val) 결손 시에만 profit-ratio 자기자본순이익율(self_cptl_ntin_inrt)로
    // 보강(best-effort). roe_val 가용 시 추가 호출 0 — 심볼당 과다 호출 방지.
    let roe = cleanNumber(ratioRow?.roe_val);
    let roeSource: KisFinanceFieldSource = roe != null ? 'KIS_L1' : 'UNAVAILABLE';
    if (roe == null) {
      const profitRow = await fetchFinanceRow(PROFIT_RATIO, symbol, 'GATE2_KIS_PROFIT_RATIO').catch(() => null);
      const fallbackRoe = cleanNumber(profitRow?.self_cptl_ntin_inrt);
      if (fallbackRoe != null) {
        roe = fallbackRoe;
        roeSource = 'KIS_L1';
      }
    }

    const result: KisFinancials = {
      symbol,
      fiscalYearMonth: typeof ratioRow?.stac_yymm === 'string' ? ratioRow.stac_yymm
        : typeof incomeRow?.stac_yymm === 'string' ? incomeRow.stac_yymm : null,
      roe,
      opm: revenue && revenue !== 0 && operatingIncome != null ? (operatingIncome / revenue) * 100 : null,
      netMargin: revenue && revenue !== 0 && netIncome != null ? (netIncome / revenue) * 100 : null,
      debtRatio: cleanNumber(ratioRow?.lblt_rate) ?? cleanNumber(stabilityRow?.lblt_rate),
      currentRatio: cleanNumber(stabilityRow?.crnt_rate),
      // ADR-0655 — KIS 단독으로는 ICR 산출 불가(이자비용 bsop_non_expn 비분리). DART 잔존 머지에서만.
      interestCoverageRatio: null,
      revenueYoYGrowth,
      operatingIncomeYoYGrowth,
      marginAcceleration: revenueYoYGrowth != null && operatingIncomeYoYGrowth != null
        ? operatingIncomeYoYGrowth - revenueYoYGrowth : null,
      eps: cleanNumber(ratioRow?.eps),
      bps: cleanNumber(ratioRow?.bps),
      revenue,
      operatingIncome,
      netIncome,
      // ADR-0655 — metric 별 출처 분류 (관측 trace). debtRatio 는 ratio/stability 둘 다 lblt_rate(둘 다 KIS_L1).
      fieldSources: {
        roe: roeSource,
        opm: revenue && revenue !== 0 && operatingIncome != null ? 'KIS_DERIVED' : 'UNAVAILABLE',
        debtRatio: (ratioRow?.lblt_rate != null || stabilityRow?.lblt_rate != null) ? 'KIS_L1' : 'UNAVAILABLE',
        currentRatio: stabilityRow?.crnt_rate != null ? 'KIS_L1' : 'UNAVAILABLE',
        interestCoverageRatio: 'UNAVAILABLE', // KIS 단독 미가용 — DART 머지 시 DART_L2_RESIDUAL 로 승격(engine-dev).
      },
      source: 'KIS_FINANCE',
    };
    _cache.set(symbol, { data: result, exp: Date.now() + CACHE_TTL_MS });
    console.log(
      `[KIS/Fin] ${symbol} ${result.fiscalYearMonth ?? 'N/A'}: ROE=${result.roe?.toFixed(1) ?? 'N/A'}% ` +
      `OPM=${result.opm?.toFixed(1) ?? 'N/A'}% DR=${result.debtRatio?.toFixed(0) ?? 'N/A'}% ` +
      `CR=${result.currentRatio?.toFixed(0) ?? 'N/A'}% revYoY=${result.revenueYoYGrowth?.toFixed(1) ?? 'N/A'}%`,
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
 * KisFinancials → QmpDartFinancials 호환 매핑 (ADR-0532 Phase 3 read 경로).
 * KIS 미가용 축(ocfRatio/interestCoverageRatio/operatingCashFlow/interestExpense)은 null — DART 잔존.
 * debtRatio/currentRatio/YoY 는 non-gating 표시 metric(%); calculateGate2DerivedMetrics 가 record 에서 우선 소비.
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
    debtRatio: kis.debtRatio,
    currentRatio: kis.currentRatio,
    opmYoYDelta: null,
    revenueYoYGrowth: kis.revenueYoYGrowth,
    operatingIncomeYoYGrowth: kis.operatingIncomeYoYGrowth,
    marginAcceleration: kis.marginAcceleration,
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
