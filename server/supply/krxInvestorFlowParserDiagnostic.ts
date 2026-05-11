/**
 * @responsibility ADR-0445 KRX investor-flow parser empty rows 진단 SSOT.
 *
 * ADR-0435 의 PARSER_EMPTY_ROWS status 위에서 *empty rows 의 진짜 원인* 을 분해
 * 한다. raw KRX response shape 을 sanitized metadata 만으로 영속하고, parser
 * 가 시도한 expectedPaths 와 실제 발견된 detectedCandidatePaths 를 분리 기록한다.
 *
 * 절대 불변식 (사용자 명시 §13):
 *   1. raw payload 무제한 저장 금지 (sanitized metadata 만).
 *   2. token/cookie/secret/account 키 영속 금지 (정적 grep 가드).
 *   3. PARSER_EMPTY_ROWS 는 DATA_UNAVAILABLE 이지 failed 아님 (ADR-0416 정합).
 *   4. DATA_UNAVAILABLE 은 NEUTRAL 아님 (ADR-0421 정합).
 *   5. STALE/CACHE/LAST_GOOD 는 OK 아님 (호출자 측 액티브 정책).
 *   6. parser auto-switch 금지 (candidate path 발견은 진단만, 검증된 path 는
 *      후속 PR 에서 명시적으로 추가).
 *   7. supply_confluence weight / Gate threshold / STRONG_BUY 변경 0
 *      (본 모듈은 진단 layer 만, 외부 의존성 0).
 *   8. KIS 주문 함수 5종 import 0 (정적 grep 가드).
 *   9. autoTradeEngine / orderExecutor / trancheExecutor import 0 (정적 grep).
 *  10. fetch / axios / node-fetch 추가 호출 0 (cache/ledger read-only 만).
 *
 * 외부 의존성: fs (atomic write) + paths SSOT 만. KIS/KRX/Yahoo/Naver outbound
 * 빈도 0 변경.
 */

import fs from 'node:fs';
import path from 'node:path';

import { KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE } from '../persistence/paths.js';

// ---------------------------------------------------------------------------
// SSOT 상수
// ---------------------------------------------------------------------------

/**
 * KRX investor-flow parser 진단 status union (사용자 §C 정합, 절대 변경 금지).
 *
 * - OK: parser 가 정상 row 를 반환했으며 semantic field 도 finite.
 * - PARSER_EMPTY_ROWS: 200 OK + row 배열이 비었거나 0 length.
 * - PARSER_SHAPE_MISMATCH: rows 가 array 가 아닌 object/null 이거나 schema 변경.
 * - HTTP_*: HTTP 오류 코드.
 * - TIMEOUT: AbortError / 네트워크 timeout.
 * - MARKET_CLOSED / NON_TRADING_DAY: session gate 자체 차단 (호출 안 함).
 * - CACHE_EMPTY: cache 비어있음.
 * - CACHE_HIT: fresh cache (14일 이내).
 * - LAST_GOOD_STALE: stale cache (14일 이상). semanticAvailable=true 라도
 *   liveStrongBuyAllowed=false 강제.
 * - UNKNOWN_ERROR: 그 외 예외.
 */
export type KrxInvestorFlowParserStatus =
  | 'OK'
  | 'PARSER_EMPTY_ROWS'
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'PARSER_KEY_MISMATCH'
  | 'PARSER_FIELD_MISMATCH'
  | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
  | 'PARSER_SHAPE_MISMATCH'
  | 'HTTP_400'
  | 'HTTP_403'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'MARKET_CLOSED'
  | 'NON_TRADING_DAY'
  | 'CACHE_EMPTY'
  | 'CACHE_HIT'
  | 'LAST_GOOD_STALE'
  | 'UNKNOWN_ERROR';

/**
 * KRX parser 가 시도하는 row array path SSOT (사용자 §3 정합).
 *
 * 본 SSOT 는 *진단 정보 only* — parser 자체는 자동으로 candidate 로 전환하지 않음.
 * parser 자체의 row path 는 호출자 (`investorFlowRouter` / `krxClient`) 가 결정하며,
 * 본 모듈은 그 결과의 *검증* 만 담당.
 */
export const KRX_INVESTOR_FLOW_EXPECTED_PATHS: readonly string[] = [
  'output',
  'output1',
  'output2',
  'data',
  'list',
  'rows',
  'result',
  'response.body.items.item',
  'OutBlock_1',
  'block1',
] as const;

/**
 * 영속 ledger FIFO trim 한도 (사용자 보고 패턴 분석에 충분).
 */
export const KRX_PARSER_DIAGNOSTIC_LEDGER_MAX = 200;

/**
 * Last-good cache stale 임계 — 14 calendar days. 영업일 기준 약 10일 (사용자
 * §5 §I 정합 — `LAST_GOOD_STALE` 분기).
 */
export const KRX_PARSER_LAST_GOOD_STALE_DAYS = 14;
const DAY_MS = 86_400_000;
const LAST_GOOD_STALE_MS = KRX_PARSER_LAST_GOOD_STALE_DAYS * DAY_MS;

/**
 * Sanitized sample 정책 — 영구 금지 토큰/민감 키 SSOT (정적 grep 가드).
 *
 * 본 SSOT 가 검출하는 키는 sanitizedSampleKeys 에서 자동 제외된다. 새 KRX
 * endpoint 가 신규 토큰 키를 반환하면 본 SSOT 에 즉시 추가 의무 (PR review).
 */
export const KRX_PARSER_FORBIDDEN_KEY_TOKENS: readonly string[] = [
  'accesstoken',
  'access_token',
  'appkey',
  'app_key',
  'secret',
  'password',
  'token',
  'auth',
  'authorization',
  'credential',
  'cookie',
  'account',
  'accountno',
  'session',
  'apikey',
  'api_key',
] as const;

const KST_OFFSET_MS = 9 * 60 * 60_000;

/**
 * KST ISO 시각 — sanitized metadata 영속용 (timestamp 만).
 */
export function toKrxParserKstIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

// ---------------------------------------------------------------------------
// 본체 schema
// ---------------------------------------------------------------------------

/**
 * Sanitized response sample — raw payload 절대 저장 금지, metadata 만.
 */
export interface KrxInvestorFlowSanitizedSample {
  topLevelKeys: string[];
  candidatePathLabels: string[]; // ['output:len=12', 'response.body.items[0]:len=0']
  firstRowKeys: string[];
  httpStatusCode?: number;
  contentTypeBucket?: string;
  responseSizeBucket?: '<1KB' | '1-10KB' | '10-100KB' | '>100KB';
  timestamp: string; // KST ISO
}

/**
 * KRX investor-flow parser 진단 결과 SSOT (사용자 §B schema 직접 정합).
 */
export interface KrxInvestorFlowParserDiagnostic {
  provider: 'KRX';
  status: KrxInvestorFlowParserStatus;
  available: boolean;
  semanticAvailable: boolean;
  rowCount: number;
  expectedPaths: string[];
  detectedCandidatePaths: string[];
  sanitizedSampleKeys: string[];
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
  note?: string;
}

/**
 * 영속 ledger entry — sanitized sample + diagnostic 합성.
 */
export interface KrxInvestorFlowParserLedgerEntry {
  diagnosedAt: string; // KST ISO
  diagnostic: KrxInvestorFlowParserDiagnostic;
  sanitizedSample: KrxInvestorFlowSanitizedSample;
}

// ---------------------------------------------------------------------------
// ENV gate SSOT
// ---------------------------------------------------------------------------

/**
 * ADR-0157 정확 비교 의무. `'1'` / `'TRUE'` / `'yes'` 거부 — `'true'` 만 인정.
 * default OFF — 활성화 시 ADR-0445 진단 layer 자체 비활성, ADR-0435 동작 100%
 * 복원.
 */
export function isKrxParserDiagnosticDisabled(): boolean {
  return process.env.KRX_PARSER_DIAGNOSTIC_DISABLED === 'true';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Token-like key 검출 SSOT — sanitized sample 에서 자동 제외 + 진단 ledger 영속
 * 시점 정적 grep 가드. lower-case 매칭.
 */
export function isForbiddenSampleKey(key: unknown): boolean {
  if (typeof key !== 'string') return true;
  const lower = key.toLowerCase();
  for (const token of KRX_PARSER_FORBIDDEN_KEY_TOKENS) {
    if (lower.includes(token)) return true;
  }
  return false;
}

/**
 * Response size bucket SSOT (사용자 §5 정합).
 */
export function classifyResponseSizeBucket(
  bytes: number | undefined | null,
): '<1KB' | '1-10KB' | '10-100KB' | '>100KB' | undefined {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return '<1KB';
  if (bytes < 10 * 1024) return '1-10KB';
  if (bytes < 100 * 1024) return '10-100KB';
  return '>100KB';
}

/**
 * Content-type bucket — 단순 라벨만 (Authorization / Cookie 헤더 영속 금지).
 */
export function classifyContentTypeBucket(
  contentType: string | undefined | null,
): string | undefined {
  if (typeof contentType !== 'string' || contentType.length === 0) return undefined;
  const lower = contentType.toLowerCase();
  if (lower.includes('json')) return 'json';
  if (lower.includes('xml')) return 'xml';
  if (lower.includes('html')) return 'html';
  if (lower.includes('text')) return 'text';
  return 'other';
}

/**
 * Row 배열 후보 탐색 SSOT (사용자 §3 정합).
 *
 * payload 의 *직접 자식 + 1단계 nested* 중 array 인 후보를 path:length 페어로
 * 반환. 본 SSOT 는 *진단 정보 only* — parser 자동 전환 금지 (사용자 §6 절대
 * 불변식 정합).
 */
export function probeRowArrayCandidates(
  payload: unknown,
  options?: { maxDepth?: number; maxCandidates?: number },
): Array<{ path: string; length: number }> {
  const maxDepth = Math.max(1, Math.min(3, options?.maxDepth ?? 3));
  const maxCandidates = Math.max(1, Math.min(20, options?.maxCandidates ?? 10));
  const out: Array<{ path: string; length: number }> = [];

  if (payload == null || typeof payload !== 'object') return out;

  const visit = (node: unknown, prefix: string, depth: number): void => {
    if (out.length >= maxCandidates) return;
    if (node == null || typeof node !== 'object') return;
    if (depth > maxDepth) return;
    if (Array.isArray(node)) {
      out.push({ path: prefix || '<root>', length: node.length });
      // first element 가 array 인 경우는 흔치 않으므로 더 들어가지 않음
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (out.length >= maxCandidates) return;
      if (isForbiddenSampleKey(key)) continue;
      const value = obj[key];
      const nextPrefix = prefix.length > 0 ? `${prefix}.${key}` : key;
      if (Array.isArray(value)) {
        out.push({ path: nextPrefix, length: value.length });
      } else if (value != null && typeof value === 'object') {
        visit(value, nextPrefix, depth + 1);
      }
    }
  };

  visit(payload, '', 0);
  return out;
}

/**
 * Sanitized sample 합성 SSOT (사용자 §5 정합).
 *
 * top-level keys + candidate path labels + 첫 row key 목록만 영속. raw 값 / token
 * / 대용량 body 절대 저장 금지.
 */
export function buildSanitizedSample(input: {
  payload: unknown;
  httpStatusCode?: number;
  contentType?: string;
  responseSizeBytes?: number;
  now?: Date;
}): KrxInvestorFlowSanitizedSample {
  const timestamp = toKrxParserKstIso(input.now);
  const payload = input.payload;
  const contentTypeBucket = classifyContentTypeBucket(input.contentType);
  const responseSizeBucket = classifyResponseSizeBucket(input.responseSizeBytes);
  const httpStatusCode = typeof input.httpStatusCode === 'number' && Number.isFinite(input.httpStatusCode)
    ? input.httpStatusCode
    : undefined;

  if (payload == null || typeof payload !== 'object') {
    return {
      topLevelKeys: [],
      candidatePathLabels: [],
      firstRowKeys: [],
      ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
      ...(contentTypeBucket ? { contentTypeBucket } : {}),
      ...(responseSizeBucket ? { responseSizeBucket } : {}),
      timestamp,
    };
  }

  const obj = payload as Record<string, unknown>;
  const topLevelKeys = Object.keys(obj).filter((k) => !isForbiddenSampleKey(k));
  const candidates = probeRowArrayCandidates(payload);
  const candidatePathLabels = candidates.map((c) => `${c.path}:len=${c.length}`);

  // 첫 row 의 key 목록 추출 (값 절대 저장 X).
  let firstRowKeys: string[] = [];
  for (const cand of candidates) {
    if (cand.length === 0) continue;
    // path 의 첫 element resolve.
    const segments = cand.path.split('.');
    let cursor: unknown = payload;
    for (const seg of segments) {
      if (cursor == null || typeof cursor !== 'object') {
        cursor = null;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    if (Array.isArray(cursor) && cursor.length > 0) {
      const firstRow = cursor[0];
      if (firstRow != null && typeof firstRow === 'object' && !Array.isArray(firstRow)) {
        firstRowKeys = Object.keys(firstRow as Record<string, unknown>).filter(
          (k) => !isForbiddenSampleKey(k),
        );
        break;
      }
    }
  }

  return {
    topLevelKeys,
    candidatePathLabels,
    firstRowKeys,
    ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
    ...(contentTypeBucket ? { contentTypeBucket } : {}),
    ...(responseSizeBucket ? { responseSizeBucket } : {}),
    timestamp,
  };
}

/**
 * Semantic field 검증 SSOT — ADR-0421 와 정합.
 *
 * 0 은 number 인정 (운영자가 "오늘 순매수 0주" 의미 가능). NaN/Infinity/string
 * garbage 거부.
 */
function isSemanticFieldFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 진단 본체 합성 SSOT — sanitized sample 위에 status + last-good cache 결합.
 */
export interface BuildKrxParserDiagnosticInput {
  status: KrxInvestorFlowParserStatus;
  rowCount?: number;
  sanitizedSample: KrxInvestorFlowSanitizedSample;
  /** parser 가 시도한 expected path 목록 — 미전달 시 SSOT default 사용. */
  expectedPaths?: readonly string[];
  /** 첫 row 의 semantic field (foreignNetBuy + institutionalNetBuy) — 검증용. */
  firstRowFields?: { foreignNetBuy?: unknown; institutionalNetBuy?: unknown };
  /** 직전 성공 시점 영속 (기존 ledger 또는 InvestorFlowProviderHealth 에서 propagate). */
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  /** 직전 실패 시점 영속. */
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  /** Cache fallback 결과 — sanitized sample 과는 별도. */
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
  note?: string;
}

export function buildKrxInvestorFlowParserDiagnostic(
  input: BuildKrxParserDiagnosticInput,
): KrxInvestorFlowParserDiagnostic {
  const expectedPaths = (input.expectedPaths ?? KRX_INVESTOR_FLOW_EXPECTED_PATHS).slice();
  const detectedCandidatePaths = input.sanitizedSample.candidatePathLabels.slice();
  const sanitizedSampleKeys = input.sanitizedSample.firstRowKeys.slice();
  const rowCount = Math.max(0, Math.floor(input.rowCount ?? 0));

  const semanticAvailable = !!input.firstRowFields
    && isSemanticFieldFinite(input.firstRowFields.foreignNetBuy)
    && isSemanticFieldFinite(input.firstRowFields.institutionalNetBuy);

  // dataAvailable 판정 SSOT (사용자 §I 정합):
  //   OK / CACHE_HIT → true
  //   LAST_GOOD_STALE → true (참고용 only — liveStrongBuyAllowed=false 는 호출자 측)
  //   그 외 → false
  let available = false;
  if (input.status === 'OK') available = true;
  else if (input.status === 'CACHE_HIT') available = true;
  else if (input.status === 'LAST_GOOD_STALE') available = true;

  return {
    provider: 'KRX',
    status: input.status,
    available,
    semanticAvailable,
    rowCount,
    expectedPaths,
    detectedCandidatePaths,
    sanitizedSampleKeys,
    ...(input.lastSuccessAtKst ? { lastSuccessAtKst: input.lastSuccessAtKst } : {}),
    ...(input.lastSuccessRowCount !== undefined
      ? { lastSuccessRowCount: input.lastSuccessRowCount }
      : {}),
    ...(input.lastFailureAtKst ? { lastFailureAtKst: input.lastFailureAtKst } : {}),
    ...(input.lastFailureReason ? { lastFailureReason: input.lastFailureReason } : {}),
    ...(input.cacheStatus ? { cacheStatus: input.cacheStatus } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

/**
 * Cache age 분류 SSOT (사용자 §I 정합).
 *
 * - cache 없음 → CACHE_EMPTY
 * - 14일 미만 → CACHE_HIT
 * - 14일 이상 → LAST_GOOD_STALE
 *
 * `cacheFetchedAt` 가 ISO 형식 아니거나 미래 시점 → CACHE_EMPTY 안전 fallback.
 */
export function classifyCacheStatus(
  cacheFetchedAt: string | undefined | null,
  now: Date = new Date(),
): 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE' {
  if (!cacheFetchedAt) return 'CACHE_EMPTY';
  const ts = Date.parse(cacheFetchedAt);
  if (!Number.isFinite(ts)) return 'CACHE_EMPTY';
  const ageMs = now.getTime() - ts;
  if (ageMs < 0) return 'CACHE_EMPTY'; // 미래 시점 → 손상으로 처리
  if (ageMs < LAST_GOOD_STALE_MS) return 'CACHE_HIT';
  return 'LAST_GOOD_STALE';
}

// ---------------------------------------------------------------------------
// 영속 ledger
// ---------------------------------------------------------------------------

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Ledger 영속 read (손상 JSON → 빈 배열 fallback).
 */
export function loadKrxInvestorFlowParserDiagnostics(): KrxInvestorFlowParserLedgerEntry[] {
  try {
    if (!fs.existsSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE)) return [];
    const raw = fs.readFileSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 항목별 최소 schema 검증 — 손상된 항목은 빈 배열 fallback.
    return parsed.filter(
      (e) =>
        e != null
        && typeof e === 'object'
        && typeof (e as Record<string, unknown>).diagnosedAt === 'string'
        && typeof (e as Record<string, unknown>).diagnostic === 'object'
        && typeof (e as Record<string, unknown>).sanitizedSample === 'object',
    ) as KrxInvestorFlowParserLedgerEntry[];
  } catch {
    return [];
  }
}

/**
 * Ledger 영속 write — atomic (tmp → rename) + FIFO trim 200건.
 */
export function appendKrxInvestorFlowParserDiagnostic(
  entry: KrxInvestorFlowParserLedgerEntry,
): void {
  const existing = loadKrxInvestorFlowParserDiagnostics();
  const next = [...existing, entry].slice(-KRX_PARSER_DIAGNOSTIC_LEDGER_MAX);
  ensureDir(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE);
  const tmp = `${KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE);
}

/**
 * 가장 최근 success/failure 진단 propagate SSOT — provider health 결합용.
 *
 * 외부 부작용 0 — 영속 read-only.
 */
export interface KrxInvestorFlowParserHistorySummary {
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
}

export function summarizeKrxInvestorFlowParserHistory(): KrxInvestorFlowParserHistorySummary {
  const entries = loadKrxInvestorFlowParserDiagnostics();
  let lastSuccess: KrxInvestorFlowParserLedgerEntry | null = null;
  let lastFailure: KrxInvestorFlowParserLedgerEntry | null = null;
  for (const e of entries) {
    if (e.diagnostic.status === 'OK' || e.diagnostic.status === 'CACHE_HIT') {
      if (!lastSuccess || e.diagnosedAt > lastSuccess.diagnosedAt) lastSuccess = e;
    } else {
      if (!lastFailure || e.diagnosedAt > lastFailure.diagnosedAt) lastFailure = e;
    }
  }
  return {
    ...(lastSuccess
      ? {
          lastSuccessAtKst: lastSuccess.diagnosedAt,
          lastSuccessRowCount: lastSuccess.diagnostic.rowCount,
        }
      : {}),
    ...(lastFailure
      ? {
          lastFailureAtKst: lastFailure.diagnosedAt,
          lastFailureReason: lastFailure.diagnostic.note ?? lastFailure.diagnostic.status,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// /supply_health + /scan_blockers 라인 빌더
// ---------------------------------------------------------------------------

/**
 * KRX investor-flow 진단 한 줄 요약 SSOT (운영 출력 §12 정합).
 *
 * 출력 예 (빈 lastOK 시 일부 라인 생략):
 *
 * ```
 * KRX: DATA_UNAVAILABLE / PARSER_EMPTY_ROWS
 *   lastOK: 09:02 KST rows=12
 *   lastFail: 09:34 KST
 *   expected: output1
 *   detected: response.body.items[0]:len=0
 *   cache: CACHE_EMPTY
 * ```
 */
export function formatKrxParserDiagnosticBlock(
  diag: KrxInvestorFlowParserDiagnostic,
): string {
  const headLabel = diag.available ? 'OK' : 'DATA_UNAVAILABLE';
  const lines: string[] = [`KRX: ${headLabel} / ${diag.status}`];
  if (diag.lastSuccessAtKst) {
    const hhmm = extractKstHhmm(diag.lastSuccessAtKst);
    const rowsLabel = diag.lastSuccessRowCount !== undefined
      ? ` rows=${diag.lastSuccessRowCount}`
      : '';
    lines.push(`  lastOK: ${hhmm}${rowsLabel}`);
  }
  if (diag.lastFailureAtKst) {
    const hhmm = extractKstHhmm(diag.lastFailureAtKst);
    lines.push(`  lastFail: ${hhmm}`);
  }
  if (diag.expectedPaths.length > 0) {
    lines.push(`  expected: ${diag.expectedPaths.slice(0, 4).join(',')}`);
  }
  if (diag.detectedCandidatePaths.length > 0) {
    lines.push(`  detected: ${diag.detectedCandidatePaths.slice(0, 3).join(',')}`);
  }
  if (diag.cacheStatus) {
    lines.push(`  cache: ${diag.cacheStatus}`);
  }
  return lines.join('\n');
}

function extractKstHhmm(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[1]}:${match[2]} KST`;
}

// ---------------------------------------------------------------------------
// 테스트 격리 헬퍼
// ---------------------------------------------------------------------------

/**
 * 테스트 격리용 — 영속 파일 삭제 (mkdtempSync isolated dir 사용 시 안전).
 */
export function __resetKrxInvestorFlowParserDiagnosticsForTests(): void {
  try {
    if (fs.existsSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE)) {
      fs.unlinkSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE);
    }
  } catch {
    /* noop */
  }
}
