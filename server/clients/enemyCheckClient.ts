// @responsibility enemyCheckClient 외부 클라이언트 모듈
/**
 * enemyCheckClient.ts — 역검증(Enemy Checklist) 데이터 수집
 *
 * Gate 통과 종목에 대해 "팔아야 할 이유"를 역방향으로 검증.
 * 현재는 관찰 레이어만 구현 — Telegram 승인 메시지에 참고 정보로만 표시.
 * 자동 감점/차단은 모의매매 데이터가 충분히 쌓인 후 유효성 검증 시 도입 예정.
 *
 * 수집 항목:
 *   신용잔고율    — KIS FHKST01010100 (cred_vals)  → 레버리지 잠재 매도 압력
 *   개인 지배 비중 — KIS FHKST01010300              → 스마트머니 이탈 신호
 *
 * 캐시 TTL: 10분 (장중 갱신 주기)
 */

import {
  fetchKisDailyCreditBalance,
  fetchKisDailyLoanTransaction,
  fetchKisDailyShortSale,
  realDataKisGet,
  HAS_REAL_DATA_CLIENT,
} from './kisClient.js';
import {
  formatNullablePercent,
  formatSignedNullablePercent,
  isFiniteNumber,
} from '../utils/nullableFormatters.js';

type EnemySeverity = 'INFO' | 'WARN' | 'BLOCK';
type EnemySource = 'KIS' | 'DART' | 'NAVER' | 'AI_GENERATED' | 'MANUAL' | 'UNKNOWN';

export interface EnemyCheckItem {
  key: string;
  label: string;
  value: number | null;
  displayValue: string;
  materialized: boolean;
  usableForScore: boolean;
  usableForExecution: boolean;
  severity: EnemySeverity;
  source: EnemySource;
  reason?: string;
}

type EnemyDataQualityState = 'OK' | 'N/A' | 'DEGRADED' | 'STALE' | 'AI_ONLY';

export interface EnemyDataQualitySummary {
  PRICE: EnemyDataQualityState;
  FLOW: EnemyDataQualityState;
  SHORT: EnemyDataQualityState;
  CREDIT: EnemyDataQualityState;
  LOAN: EnemyDataQualityState;
  executionImpact: 'NONE';
}

export interface PreMortem {
  lines: string[];
  source: 'DATA_DRIVEN' | 'AI_GENERATED_HYPOTHESIS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  usableForExecution: boolean;
  usableForScore: boolean;
  reason?: string;
}

export interface EnemyCheckResult {
  /** 신용잔고율 (%) — KIS FHKST01010100 cred_vals */
  creditRate: number | null;
  /** 개인 순매수 절대값 / 전체 순매수 절대값 합산 (%) — 스마트머니 이탈 지표 */
  individualDominance: number | null;
  /** KIS official 공매도 증가율 (%) — 부재 시 null, bearish 변환 금지 */
  shortSaleIncreaseRate?: number | null;
  /** KIS official 대차잔고 증가율 (%) — 부재 시 null, bearish 변환 금지 */
  loanIncreaseRate?: number | null;
  /** KIS official 신용잔고 증가율 (%) — 부재 시 null, bearish 변환 금지 */
  creditIncreaseRate?: number | null;
  /** materializer/validator 진단. 표시 계층은 미검증 상태를 숫자로 대체하지 않는다. */
  shortStatus?: string;
  creditStatus?: string;
  loanStatus?: string;
  /** Explicit materializer flags. false always wins over numeric-looking fallback values. */
  shortMaterialized?: boolean;
  creditMaterialized?: boolean;
  loanMaterialized?: boolean;
  flowMaterialized?: boolean;
  priceMaterialized?: boolean;
  /** 데이터 신뢰도 */
  source: 'KIS_FULL' | 'KIS_PARTIAL' | 'UNAVAILABLE';
}

const _cache = new Map<string, { data: EnemyCheckResult; exp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

const NOT_MATERIALIZED_REASONS = new Set([
  'FIELD_MISMATCH_CONFIRMED',
  'FIELD_MISSING',
  'QUOTE_LIKE_OUTPUT_FOR_SHORT',
  'NO_SHORT_SELLING_FIELDS',
  'SHORT_DATA_NOT_MATERIALIZED',
  'MISSING_CONFIRMED',
  'CREDIT_DATA_NOT_MATERIALIZED',
  'LOAN_DATA_NOT_MATERIALIZED',
]);

function isMaterializedNumeric(
  value: number | null | undefined,
  status?: string,
  materialized?: boolean,
): value is number {
  if (materialized === false) return false;
  if (status && NOT_MATERIALIZED_REASONS.has(status)) return false;
  return isFiniteNumber(value);
}

function dataQualityForMaterialized(ok: boolean): EnemyDataQualityState {
  return ok ? 'OK' : 'N/A';
}

function shouldHideUnmaterializedEnemyItems(): boolean {
  return process.env.CARD_HIDE_UNMATERIALIZED_ENEMY_ITEMS !== 'false'
    || process.env.TELEGRAM_HIDE_UNMATERIALIZED_ENEMY_ITEMS !== 'false';
}

export function buildEnemyCheckItems(e: EnemyCheckResult): EnemyCheckItem[] {
  const creditMaterialized = isMaterializedNumeric(e.creditRate, e.creditStatus, e.creditMaterialized);
  const shortMaterialized = isMaterializedNumeric(e.shortSaleIncreaseRate, e.shortStatus, e.shortMaterialized);
  const loanMaterialized = isMaterializedNumeric(e.loanIncreaseRate, e.loanStatus, e.loanMaterialized);
  const creditIncreaseMaterialized = isMaterializedNumeric(e.creditIncreaseRate, e.creditStatus, e.creditMaterialized);
  const flowMaterialized = isMaterializedNumeric(e.individualDominance, undefined, e.flowMaterialized);

  const creditValue: number | null = creditMaterialized ? e.creditRate as number : null;
  const flowValue: number | null = flowMaterialized ? e.individualDominance as number : null;
  const shortValue: number | null = shortMaterialized ? e.shortSaleIncreaseRate as number : null;
  const loanValue: number | null = loanMaterialized ? e.loanIncreaseRate as number : null;
  const loanAbs = Math.abs(loanValue ?? 0);
  const loanSeverity: EnemySeverity = !loanMaterialized || loanAbs < 10 ? 'INFO' : loanAbs < 20 ? 'WARN' : 'BLOCK';

  const items: EnemyCheckItem[] = [
    {
      key: 'creditBalanceRatio',
      label: '신용잔고율',
      value: creditValue,
      displayValue: formatNullablePercent(creditValue),
      materialized: creditMaterialized,
      usableForScore: creditMaterialized,
      usableForExecution: false,
      severity: creditValue !== null && creditValue >= 8 ? 'WARN' : 'INFO',
      source: 'KIS',
      reason: creditMaterialized ? undefined : 'CREDIT_DATA_NOT_MATERIALIZED',
    },
    {
      key: 'individualDominance',
      label: '개인 비중',
      value: flowValue,
      displayValue: flowValue !== null ? `${flowValue.toFixed(0)}%` : 'N/A',
      materialized: flowMaterialized,
      usableForScore: flowMaterialized,
      usableForExecution: false,
      severity: flowValue !== null && flowValue > 80 ? 'WARN' : 'INFO',
      source: 'KIS',
      reason: flowMaterialized ? undefined : 'FLOW_DATA_NOT_MATERIALIZED',
    },
    {
      key: 'shortGrowthPct',
      label: '공매도 증가율',
      value: shortValue,
      displayValue: formatNullablePercent(shortValue),
      materialized: shortMaterialized,
      usableForScore: shortMaterialized,
      usableForExecution: false,
      severity: shortValue !== null && shortValue >= 30 ? 'WARN' : 'INFO',
      source: 'KIS',
      reason: shortMaterialized ? undefined : (e.shortStatus ?? 'SHORT_DATA_NOT_MATERIALIZED'),
    },
    {
      key: 'loanBalanceGrowthPct',
      label: '대차잔고 증가율',
      value: loanValue,
      displayValue: formatSignedNullablePercent(loanValue),
      materialized: loanMaterialized,
      usableForScore: loanMaterialized && loanAbs >= 10,
      usableForExecution: false,
      severity: loanSeverity,
      source: 'KIS',
      reason: loanMaterialized ? (loanAbs < 10 ? 'LOAN_REFERENCE_ONLY_BELOW_10PCT' : undefined) : 'LOAN_DATA_NOT_MATERIALIZED',
    },
    {
      key: 'creditBalanceGrowthPct',
      label: '신용잔고 증가율',
      value: creditIncreaseMaterialized ? e.creditIncreaseRate! : null,
      displayValue: formatNullablePercent(creditIncreaseMaterialized ? e.creditIncreaseRate : null),
      materialized: creditIncreaseMaterialized,
      usableForScore: creditIncreaseMaterialized,
      usableForExecution: false,
      severity: creditIncreaseMaterialized && e.creditIncreaseRate! >= 30 ? 'WARN' : 'INFO',
      source: 'KIS',
      reason: creditIncreaseMaterialized ? undefined : 'CREDIT_DATA_NOT_MATERIALIZED',
    },
  ];

  return shouldHideUnmaterializedEnemyItems() ? items.filter((item) => item.materialized) : items;
}

export function buildEnemyDataQualitySummary(e: EnemyCheckResult): EnemyDataQualitySummary {
  return {
    PRICE: dataQualityForMaterialized(e.priceMaterialized !== false),
    FLOW: dataQualityForMaterialized(isMaterializedNumeric(e.individualDominance, undefined, e.flowMaterialized)),
    SHORT: dataQualityForMaterialized(isMaterializedNumeric(e.shortSaleIncreaseRate, e.shortStatus, e.shortMaterialized)),
    CREDIT: dataQualityForMaterialized(isMaterializedNumeric(e.creditRate, e.creditStatus, e.creditMaterialized)),
    LOAN: dataQualityForMaterialized(isMaterializedNumeric(e.loanIncreaseRate, e.loanStatus, e.loanMaterialized)),
    executionImpact: 'NONE',
  };
}

export function formatDataQualityBadge(summary: EnemyDataQualitySummary): string {
  return `DataQuality:\nPRICE=${summary.PRICE} / FLOW=${summary.FLOW} / SHORT=${summary.SHORT} / CREDIT=${summary.CREDIT} / LOAN=${summary.LOAN}\nexecutionImpact=${summary.executionImpact}`;
}

export function buildPreMortem(input: {
  lines: string[];
  enemyCheck?: EnemyCheckResult | null;
  institutionNetSellMaterialized?: boolean;
  foreignNetSellMaterialized?: boolean;
  earningsConsensusDowngradeMaterialized?: boolean;
  supportBreakMaterialized?: boolean;
  disclosureBadNewsMaterialized?: boolean;
}): PreMortem {
  const e = input.enemyCheck;
  const dataDriven = !!(
    input.institutionNetSellMaterialized
    || input.foreignNetSellMaterialized
    || (e && isMaterializedNumeric(e.shortSaleIncreaseRate, e.shortStatus, e.shortMaterialized) && Math.abs(e.shortSaleIncreaseRate) >= 20)
    || (e && isMaterializedNumeric(e.loanIncreaseRate, e.loanStatus, e.loanMaterialized) && Math.abs(e.loanIncreaseRate) >= 20)
    || (e && isMaterializedNumeric(e.creditIncreaseRate, e.creditStatus, e.creditMaterialized) && Math.abs(e.creditIncreaseRate) >= 20)
    || input.earningsConsensusDowngradeMaterialized
    || input.supportBreakMaterialized
    || input.disclosureBadNewsMaterialized
  );

  if (!dataDriven) {
    return {
      lines: input.lines,
      source: 'AI_GENERATED_HYPOTHESIS',
      confidence: 'LOW',
      usableForExecution: false,
      usableForScore: false,
      reason: 'DATA_NOT_MATERIALIZED',
    };
  }

  return {
    lines: input.lines,
    source: 'DATA_DRIVEN',
    confidence: 'HIGH',
    usableForExecution: false,
    usableForScore: true,
  };
}

/**
 * 주어진 종목의 역검증 데이터를 KIS API로 수집한다.
 * KIS 미설정 또는 오류 시 UNAVAILABLE 반환 (진입 차단 없음).
 */
export async function fetchEnemyCheckData(code: string): Promise<EnemyCheckResult> {
  const key = code.padStart(6, '0');
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const empty: EnemyCheckResult = {
    creditRate: null,
    individualDominance: null,
    shortSaleIncreaseRate: null,
    loanIncreaseRate: null,
    creditIncreaseRate: null,
    shortStatus: 'SHORT_DATA_NOT_MATERIALIZED',
    creditStatus: 'CREDIT_DATA_NOT_MATERIALIZED',
    loanStatus: 'LOAN_DATA_NOT_MATERIALIZED',
    flowMaterialized: false,
    priceMaterialized: true,
    source: 'UNAVAILABLE',
  };

  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return empty;
  }

  let creditRate: number | null = null;
  let individualDominance: number | null = null;
  let shortSaleIncreaseRate: number | null = null;
  let loanIncreaseRate: number | null = null;
  let creditIncreaseRate: number | null = null;
  let hitCount = 0;
  let creditStatus = 'CREDIT_DATA_NOT_MATERIALIZED';
  let shortStatus = 'SHORT_DATA_NOT_MATERIALIZED';
  let loanStatus = 'LOAN_DATA_NOT_MATERIALIZED';
  let flowMaterialized = false;

  try {
    // ── FHKST01010100: 주식현재가 (신용잔고율 포함) ──────────────────────
    const priceData = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: key },
    );
    const priceOut = (priceData as { output?: Record<string, string> } | null)?.output;
    if (priceOut && Object.prototype.hasOwnProperty.call(priceOut, 'cred_vals')) {
      const raw = Number.parseFloat(priceOut.cred_vals);
      if (Number.isFinite(raw) && raw >= 0) {
        creditRate = raw;
        creditStatus = 'OK';
        hitCount++;
      }
    }
  } catch {
    // KIS 일시 장애 — 해당 항목만 null 유지
  }

  try {
    // ── FHKST01010300: 투자자별 순매수 ─────────────────────────────────
    const flowData = await realDataKisGet(
      'FHKST01010300',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: key },
    );
    const flowOut = (flowData as { output?: Record<string, string> } | null)?.output;
    if (flowOut) {
      const foreignNet = Number.parseInt(flowOut.frgn_ntby_qty ?? '0', 10);
      const instNet    = Number.parseInt(flowOut.orgn_ntby_qty  ?? '0', 10);
      const indivNet   = Number.parseInt(flowOut.prsn_ntby_qty  ?? '0', 10);
      const totalAbs = Math.abs(foreignNet) + Math.abs(instNet) + Math.abs(indivNet);
      if (totalAbs > 0) {
        individualDominance = (Math.abs(indivNet) / totalAbs) * 100;
        flowMaterialized = true;
        hitCount++;
      }
    }
  } catch {
    // KIS 일시 장애 — 해당 항목만 null 유지
  }

  try {
    const short = await fetchKisDailyShortSale(key);
    if (isFiniteNumber(short?.shortSaleIncreaseRate)) {
      shortSaleIncreaseRate = short.shortSaleIncreaseRate;
      shortStatus = 'OK';
      hitCount++;
    }
  } catch {
    // KIS 일시 장애 — providerIssue 로만 취급, bearish 변환 금지
  }

  try {
    const loan = await fetchKisDailyLoanTransaction(key);
    if (isFiniteNumber(loan?.loanIncreaseRate)) {
      loanIncreaseRate = loan.loanIncreaseRate;
      loanStatus = 'OK';
      hitCount++;
    }
  } catch {
    // KIS 일시 장애 — providerIssue 로만 취급, bearish 변환 금지
  }

  try {
    const credit = await fetchKisDailyCreditBalance(key);
    if (isFiniteNumber(credit?.creditIncreaseRate)) {
      creditIncreaseRate = credit.creditIncreaseRate;
      hitCount++;
    }
  } catch {
    // KIS 일시 장애 — providerIssue 로만 취급, bearish 변환 금지
  }

  const result: EnemyCheckResult = {
    creditRate,
    individualDominance,
    shortSaleIncreaseRate,
    loanIncreaseRate,
    creditIncreaseRate,
    shortStatus,
    creditStatus,
    loanStatus,
    shortMaterialized: isFiniteNumber(shortSaleIncreaseRate) && shortStatus === 'OK',
    creditMaterialized: isFiniteNumber(creditRate) && creditStatus === 'OK',
    loanMaterialized: isFiniteNumber(loanIncreaseRate) && loanStatus === 'OK',
    flowMaterialized,
    priceMaterialized: true,
    source: hitCount >= 2 ? 'KIS_FULL' : hitCount === 1 ? 'KIS_PARTIAL' : 'UNAVAILABLE',
  };

  _cache.set(key, { data: result, exp: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * 역검증 데이터를 한 줄 요약 문자열로 반환 (Telegram HTML 용).
 * 경고 임계값 초과 시 ⚠️ 표시.
 */
export function formatEnemyCheckSummary(e: EnemyCheckResult): string | null {
  const items = buildEnemyCheckItems(e);
  const lines: string[] = [];

  for (const item of items) {
    if (!item.materialized) {
      lines.push(`${item.label}: ${item.displayValue}`);
      continue;
    }
    const marker = item.severity === 'BLOCK' ? ' ⚠️⚠️' : item.severity === 'WARN' ? ' ⚠️' : '';
    const scoreNote = item.key === 'loanBalanceGrowthPct' && item.severity === 'INFO'
      ? ' (INFO / score 미반영)'
      : '';
    lines.push(`${item.label}: ${item.displayValue}${marker}${scoreNote}`);
  }

  if (process.env.DATAQUALITY_BADGE_ENABLED !== 'false') {
    lines.push(formatDataQualityBadge(buildEnemyDataQualitySummary(e)));
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
