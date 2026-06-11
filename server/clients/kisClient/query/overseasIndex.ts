// @responsibility ADR-0603 KIS 해외지수 일봉(FHKST03030100) 조회 — SPX/NDX 의 KIS-primary 승격 (ADR-0561), 일캐시·실패 격리.

import { HAS_REAL_DATA_CLIENT } from '../constants.js';
import { realDataKisGet } from '../http.js';
import { pickKisRowsByBucket, extractKisNumberOptional } from './helpers.js';
import type { KisApiPriority } from '../../kisRateLimiter.js';

const OVERSEAS_INDEX_DAILY_TR_ID = 'FHKST03030100';
const OVERSEAS_INDEX_DAILY_PATH = '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice';

export interface KisOverseasIndexDailyRow {
  baseDate: string;
  close: number;
}

export interface KisOverseasIndexDaily {
  indexCode: string;
  series: KisOverseasIndexDailyRow[];
  /** 최신 종가 대비 전일 수익률 % (행 부족 시 null — 결손 ≠ 신호). */
  dayReturnPct: number | null;
  return20dPct: number | null;
}

/** default ON (`!== 'false'`) — OFF 시 null 반환으로 호출측 Yahoo fallback 보존 (1줄 롤백). */
export function isKisOverseasIndexDailyDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIS_OVERSEAS_INDEX_DAILY_ENABLED === 'false';
}

/** KIS 해외지수 마스터 코드 — 운영 환경에서 마스터와 다르면 ENV 로 정정 (재배포 불필요). */
export function resolveKisOverseasSpxIscd(env: NodeJS.ProcessEnv = process.env): string {
  return (env.KIS_OVERSEAS_SPX_ISCD ?? 'SPX').trim();
}

export function resolveKisOverseasNdxIscd(env: NodeJS.ProcessEnv = process.env): string {
  return (env.KIS_OVERSEAS_NDX_ISCD ?? 'NDX').trim();
}

/** ADR-0605 — 필라델피아 반도체 지수(SOX). KIS 마스터 코드가 다르면 ENV 정정 (미지원 시 null 격리). */
export function resolveKisOverseasSoxIscd(env: NodeJS.ProcessEnv = process.env): string {
  return (env.KIS_OVERSEAS_SOX_ISCD ?? 'SOX').trim();
}

function kstYyyymmdd(daysAgo: number): string {
  const kst = new Date(Date.now() + 9 * 3_600_000 - daysAgo * 86_400_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

export function parseKisOverseasIndexDaily(indexCode: string, data: unknown): KisOverseasIndexDaily | null {
  const buckets = pickKisRowsByBucket(data);
  const rows = buckets.output2.length > 0 ? buckets.output2 : buckets.output;
  const series: KisOverseasIndexDailyRow[] = rows
    .map((row): KisOverseasIndexDailyRow | null => {
      const baseDate = String(row.stck_bsop_date ?? '').trim();
      const close = extractKisNumberOptional(row, ['ovrs_nmix_prpr', 'ovrs_nmix_prdy_clpr', 'clos']);
      if (!/^\d{8}$/.test(baseDate) || close === null || close === undefined || close <= 0) return null;
      return { baseDate, close };
    })
    .filter((row): row is KisOverseasIndexDailyRow => row !== null)
    .sort((a, b) => b.baseDate.localeCompare(a.baseDate));
  if (series.length === 0) return null;
  const returnPct = (n: number): number | null =>
    series.length > n && series[n].close > 0
      ? Number((((series[0].close - series[n].close) / series[n].close) * 100).toFixed(2))
      : null;
  return {
    indexCode,
    series,
    dayReturnPct: returnPct(1),
    return20dPct: returnPct(Math.min(20, series.length - 1)),
  };
}

interface CachedOverseasDaily {
  dateKey: string;
  result: KisOverseasIndexDaily;
}

// 미국 일봉은 KST 주간(한국 장중)엔 불변(미국 장 마감 상태) — 지수×KST일자 메모로 quota ~지수당 1콜/일.
const overseasDailyCache = new Map<string, CachedOverseasDaily>();
const overseasFailureSuppressed = new Map<string, string>();

/** 테스트 격리용 — 운영 경로 미사용. */
export function __resetKisOverseasIndexDailyCacheForTest(): void {
  overseasDailyCache.clear();
  overseasFailureSuppressed.clear();
}

/**
 * KIS 해외지수 일봉 조회 (N: 해외지수 — 다우30/나스닥100/S&P500 공식 지원).
 * 실패/비활성/행 0 → null — 호출측은 기존 Yahoo fallback 을 유지한다 (ADR-0561: KIS 우선,
 * Yahoo 는 최후 보조). 실패는 당일 재시도 1회 억제로 격리.
 */
export async function fetchKisOverseasIndexDaily(
  indexCode: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisOverseasIndexDaily | null> {
  if (isKisOverseasIndexDailyDisabled()) return null;
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const code = (indexCode ?? '').trim();
  if (!code) return null;
  const dateKey = kstYyyymmdd(0);
  const cached = overseasDailyCache.get(code);
  if (cached && cached.dateKey === dateKey) return cached.result;
  if (overseasFailureSuppressed.get(code) === dateKey) return null;
  try {
    const data = await realDataKisGet(
      OVERSEAS_INDEX_DAILY_TR_ID,
      OVERSEAS_INDEX_DAILY_PATH,
      {
        FID_COND_MRKT_DIV_CODE: 'N',
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: kstYyyymmdd(60),
        FID_INPUT_DATE_2: dateKey,
        FID_PERIOD_DIV_CODE: 'D',
      },
      priority,
    );
    const parsed = parseKisOverseasIndexDaily(code, data);
    if (!parsed) {
      overseasFailureSuppressed.set(code, dateKey);
      return null;
    }
    overseasDailyCache.set(code, { dateKey, result: parsed });
    return parsed;
  } catch {
    // 실패 격리 — 호출측 Yahoo fallback 경로가 정상 동작 (silent 아님: 호출측이 source 로그).
    overseasFailureSuppressed.set(code, dateKey);
    return null;
  }
}
