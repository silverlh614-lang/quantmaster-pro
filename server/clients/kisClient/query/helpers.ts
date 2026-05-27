/**
 * @responsibility KIS 응답 파싱·추출 순수 leaf 헬퍼 — bucket/row picker, 숫자·문자 추출, KST 날짜 연산.
 *
 * ADR-0537 — kisClient/query.ts 분해 시 무상태 순수 헬퍼 격리.
 * provider 호출·모듈 상태 0 — isTradingDay 외 의존성 없음 (cycle-free leaf).
 */

import { isTradingDay } from '../../../utils/marketDayClassifier.js';

export type KisOutput = Record<string, string>;

/**
 * KIS는 동일 TR에서도 output 객체, output 배열, output1 객체, output2 배열을 섞어 반환한다.
 * PR-557: 수급 endpoint가 `output: array(30)` 으로 내려오면서 기존 object-only 파서가
 * 전부 0 fallback 처리하던 문제를 해결한다.
 */
function pickKisOutput(data: unknown): KisOutput | undefined {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (root?.output && typeof root.output === 'object' && !Array.isArray(root.output)) {
    return root.output as KisOutput;
  }
  if (Array.isArray(root?.output) && root.output.length > 0 && typeof root.output[0] === 'object') {
    return root.output[0] as KisOutput;
  }
  if (root?.output1 && typeof root.output1 === 'object' && !Array.isArray(root.output1)) {
    return root.output1 as KisOutput;
  }
  if (Array.isArray(root?.output1) && root.output1.length > 0 && typeof root.output1[0] === 'object') {
    return root.output1[0] as KisOutput;
  }
  if (Array.isArray(root?.output2) && root.output2.length > 0 && typeof root.output2[0] === 'object') {
    return root.output2[0] as KisOutput;
  }
  return undefined;
}

function rowsFromKisBucket(bucket: unknown): KisOutput[] {
  if (Array.isArray(bucket)) {
    return bucket.filter((item): item is KisOutput => !!item && typeof item === 'object' && !Array.isArray(item));
  }
  if (bucket && typeof bucket === 'object') return [bucket as KisOutput];
  return [];
}

function pickKisRowsByBucket(data: unknown): { output: KisOutput[]; output1: KisOutput[]; output2: KisOutput[] } {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  return {
    output: rowsFromKisBucket(root?.output),
    output1: rowsFromKisBucket(root?.output1),
    output2: rowsFromKisBucket(root?.output2),
  };
}

function pickKisRows(data: unknown): KisOutput[] {
  const buckets = pickKisRowsByBucket(data);
  return [...buckets.output, ...buckets.output1, ...buckets.output2];
}

function pickMaterializedBucket(
  data: unknown,
  order: Array<'output' | 'output1' | 'output2'>,
  classifier: (rows: KisOutput[]) => { materialized: boolean },
): { bucket: 'output' | 'output1' | 'output2'; rows: KisOutput[] } | null {
  const buckets = pickKisRowsByBucket(data);
  for (const bucket of order) {
    const rows = buckets[bucket];
    if (rows.length > 0 && classifier(rows).materialized) return { bucket, rows };
  }
  return null;
}


function isAcceptedEmptyKisResponse(data: unknown): boolean {
  const root = data as { rt_cd?: unknown; msg_cd?: unknown; output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (!root || typeof root !== 'object') return false;
  const accepted = String(root.rt_cd ?? '') === '0' && String(root.msg_cd ?? '') === 'MCA00000';
  if (!accepted) return false;
  const hasEmptyOutputArray = Array.isArray(root.output) && root.output.length === 0;
  const hasEmptyOutput1Array = Array.isArray(root.output1) && root.output1.length === 0;
  const hasEmptyOutput2Array = Array.isArray(root.output2) && root.output2.length === 0;
  const hasNoPickedOutput = !pickKisOutput(data);
  return hasNoPickedOutput && (hasEmptyOutputArray || hasEmptyOutput1Array || hasEmptyOutput2Array);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function previousKrxTradingDate(dateKst: string): string {
  let cursor = shiftYmd(dateKst, -1);
  for (let i = 0; i < 32; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    cursor = shiftYmd(cursor, -1);
  }
  return dateKst;
}

function investorDailySession(dateKst: string): 'PRE_OPEN' | 'REGULAR' | 'POST_CLOSE' | 'CLOSED' | 'NON_TRADING_DAY' {
  if (!isTradingDay(dateKst)) return 'NON_TRADING_DAY';
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (minutes < 9 * 60) return 'PRE_OPEN';
  if (minutes >= 9 * 60 && minutes < 15 * 60 + 30) return 'REGULAR';
  if (minutes >= 15 * 60 + 30) return 'POST_CLOSE';
  return 'CLOSED';
}

/**
 * KIS 응답 output 의 한글 약어 필드에서 첫 번째 매칭 값을 추출.
 * 미발견/파싱 실패 시 fallback (default 0).
 */
function extractKisNumber(out: Record<string, string> | undefined, keys: string[], fallback = 0): number {
  if (!out) return fallback;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const cleaned = String(raw).replace(/,/g, '').trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function extractKisNumberOptional(out: Record<string, string> | undefined, keys: string[]): number | undefined {
  if (!out) return undefined;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (cleaned === '') continue;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sumKisNumbersOptional(out: Record<string, string> | undefined, keys: string[]): number | undefined {
  if (!out) return undefined;
  let sum = 0;
  let found = false;
  for (const key of keys) {
    const value = extractKisNumberOptional(out, [key]);
    if (value === undefined) continue;
    sum += value;
    found = true;
  }
  return found ? sum : undefined;
}

function extractKisString(out: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!out) return undefined;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value.length > 0) return value;
  }
  return undefined;
}

function formatKisYmd(ymd: string | undefined): string | undefined {
  if (!ymd || !/^\d{8}$/.test(ymd)) return undefined;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function trendFromChange(change: number | undefined): 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN' {
  if (change === undefined || !Number.isFinite(change)) return 'UNKNOWN';
  if (change > 0) return 'INCREASING';
  if (change < 0) return 'DECREASING';
  return 'FLAT';
}

function percentChange(latest: number | undefined, previous: number | undefined): number | undefined {
  if (latest === undefined || previous === undefined || previous === 0) return undefined;
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return undefined;
  return ((latest - previous) / Math.abs(previous)) * 100;
}

function hasAnyFinite(...values: Array<number | undefined | null>): boolean {
  return values.some((value) => typeof value === 'number' && Number.isFinite(value));
}

export {
  pickKisOutput,
  rowsFromKisBucket,
  pickKisRowsByBucket,
  pickKisRows,
  pickMaterializedBucket,
  isAcceptedEmptyKisResponse,
  shiftYmd,
  previousKrxTradingDate,
  investorDailySession,
  extractKisNumber,
  extractKisNumberOptional,
  sumKisNumbersOptional,
  extractKisString,
  formatKisYmd,
  trendFromChange,
  percentChange,
  hasAnyFinite,
};
