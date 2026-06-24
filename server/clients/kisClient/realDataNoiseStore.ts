/**
 * @responsibility KIS RealData provider noise store — Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001
 *
 * KIS RealData 500/429/401/timeout 응답을 *provider noise* 로 격리해 (1) 분류
 * (errorKind 7-value), (2) 동일 endpoint/symbol/errorKind 키 단위 backoff/cooldown
 * 카운팅, (3) 반복 상세 로그 suppress, (4) compact summary SSOT 노출.
 *
 * 설계 원칙 (사용자 명시 절대 변경 금지):
 *   - 모든 `KisRealDataNoiseRecord` 는 `providerIssue: true` literal +
 *     `marketSignal: false` literal + `executionImpact: 'NONE'` literal type
 *     강제 (TypeScript 컴파일 타임).
 *   - LIVE order path 0줄 변경 — 본 SSOT 는 read-only 통계만, 호출자가 직접
 *     주문 흐름 가공 0건. KIS 주문 함수 5종 (placeKisMarketOrder /
 *     placeKisSellOrder / placeKisStopLossOrder / cancelKisOrder /
 *     placeKisTakeProfitOrder) import 0건.
 *   - 외부 fetch / axios / node-fetch import 0건 — read-only in-memory store.
 *   - ENV `KIS_REALDATA_BACKOFF_DISABLED=true` (default OFF, ADR-0157 정확
 *     비교 — `'1'`/`'TRUE'`/`'yes'` 모두 거부) 1줄 즉시 기존 retry/log 동작
 *     100% 복원. 호출자 측 inline ENV 검사 0건 — `isKisRealDataBackoffDisabled()`
 *     SSOT 위임 의무.
 *   - emergencyStop / SELL_ONLY / Gate threshold / requiredScore / UNKNOWN
 *     penalty / Shadow learning 흐름 변경 0.
 */

const NOISE_SUMMARY_LOG_INTERVAL_MS = 60_000;

const SUPPRESS_DETAIL_AFTER_FAILURES = 1;

const COOLDOWN_BY_ERROR_KIND_MS: Readonly<Record<KisRealDataErrorKind, number>> = Object.freeze({
  TRANSIENT_SERVER_500: 60_000,
  RATE_LIMIT_OR_THROTTLE: 30_000,
  AUTH_OR_TOKEN: 30_000,
  MARKET_CLOSED_OR_UNAVAILABLE: 120_000,
  BAD_REQUEST_OR_SYMBOL: 60_000,
  NETWORK_TIMEOUT: 30_000,
  UNKNOWN: 30_000,
});

const RETRY_EXHAUSTED_AT_FAILURES = 3;

export const KIS_REAL_DATA_NOISE_CONSTANTS = Object.freeze({
  NOISE_SUMMARY_LOG_INTERVAL_MS,
  SUPPRESS_DETAIL_AFTER_FAILURES,
  COOLDOWN_BY_ERROR_KIND_MS,
  RETRY_EXHAUSTED_AT_FAILURES,
});

export type KisRealDataErrorKind =
  | 'TRANSIENT_SERVER_500'
  | 'RATE_LIMIT_OR_THROTTLE'
  | 'AUTH_OR_TOKEN'
  | 'MARKET_CLOSED_OR_UNAVAILABLE'
  | 'BAD_REQUEST_OR_SYMBOL'
  | 'NETWORK_TIMEOUT'
  | 'UNKNOWN';

export interface KisRealDataNoiseClassification {
  endpoint: string;
  symbol?: string;
  httpStatus?: number;
  errorKind: KisRealDataErrorKind;
  providerIssue: true;
  marketSignal: false;
  executionImpact: 'NONE';
}

export interface KisRealDataNoiseRecord {
  key: string;
  endpoint: string;
  symbol?: string;
  errorKind: KisRealDataErrorKind;
  consecutiveFailures: number;
  firstFailureAt: string;
  lastFailureAt: string;
  nextAllowedAt: string;
  cooldownMs: number;
  suppressedLogCount: number;
  retryExhausted: boolean;
  providerIssue: true;
  marketSignal: false;
  executionImpact: 'NONE';
}

export interface ClassifyKisRealDataErrorInput {
  endpoint: string;
  symbol?: string;
  httpStatus?: number;
  message?: string;
  errorCode?: string;
}

/**
 * ENV gate SSOT — 호출자 측 inline 검사 0건. ADR-0157 정확 비교.
 */
export function isKisRealDataBackoffDisabled(): boolean {
  return process.env.KIS_REALDATA_BACKOFF_DISABLED === 'true';
}

/**
 * 분류 결정 트리 SSOT (절대 변경 금지):
 *   1. timeout/ECONNRESET/ETIMEDOUT 키워드 → NETWORK_TIMEOUT
 *   2. httpStatus undefined 인데 message=timeout → NETWORK_TIMEOUT
 *   3. httpStatus 401|403 또는 token 키워드 → AUTH_OR_TOKEN
 *   4. httpStatus 429 또는 rate limit/throttle 키워드 → RATE_LIMIT_OR_THROTTLE
 *   5. httpStatus 500~599 → TRANSIENT_SERVER_500
 *   6. httpStatus 400|404 또는 invalid symbol/bad request 키워드 → BAD_REQUEST_OR_SYMBOL
 *   7. 장외/휴장/거래불가 키워드 (market closed) → MARKET_CLOSED_OR_UNAVAILABLE
 *   8. 그 외 → UNKNOWN
 *
 * 모든 분류 결과는 `providerIssue: true` / `marketSignal: false` /
 * `executionImpact: 'NONE'` literal 강제.
 */
export function classifyKisRealDataError(
  input: ClassifyKisRealDataErrorInput,
): KisRealDataNoiseClassification {
  const message = (input.message ?? '').toLowerCase();
  const status = input.httpStatus;

  let errorKind: KisRealDataErrorKind = 'UNKNOWN';

  if (
    message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('econnrefused')
  ) {
    errorKind = 'NETWORK_TIMEOUT';
  } else if (status === undefined && message.includes('time')) {
    errorKind = 'NETWORK_TIMEOUT';
  } else if (status === 401 || status === 403 || message.includes('token') || message.includes('unauthorized')) {
    errorKind = 'AUTH_OR_TOKEN';
  } else if (status === 429 || message.includes('rate limit') || message.includes('throttle')) {
    errorKind = 'RATE_LIMIT_OR_THROTTLE';
  } else if (typeof status === 'number' && status >= 500 && status < 600) {
    errorKind = 'TRANSIENT_SERVER_500';
  } else if (
    message.includes('장외')
    || message.includes('휴장')
    || message.includes('market closed')
    || message.includes('거래불가')
  ) {
    errorKind = 'MARKET_CLOSED_OR_UNAVAILABLE';
  } else if (status === 400 || status === 404 || message.includes('invalid symbol') || message.includes('bad request')) {
    errorKind = 'BAD_REQUEST_OR_SYMBOL';
  }

  const out: KisRealDataNoiseClassification = {
    endpoint: input.endpoint,
    errorKind,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
  };
  if (input.symbol !== undefined) out.symbol = input.symbol;
  if (status !== undefined) out.httpStatus = status;
  return out;
}

/**
 * Per-key (endpoint:symbol:errorKind) backoff/cooldown 영속 store SSOT.
 * 메모리 only — process restart 시 자연 reset (ADR-0508 graceful drain 정합).
 */
const _records = new Map<string, KisRealDataNoiseRecord>();
let _lastSummaryLoggedAt = 0;

export function buildKisRealDataNoiseKey(input: {
  endpoint: string;
  symbol?: string;
  errorKind: KisRealDataErrorKind;
}): string {
  const sym = input.symbol ?? '*';
  return `${input.endpoint}:${sym}:${input.errorKind}`;
}

/**
 * 분류 → record upsert. consecutiveFailures 증가 + cooldown 갱신 +
 * suppressedLogCount += 1 (첫 SUPPRESS_DETAIL_AFTER_FAILURES 회는 0).
 *
 * 반환값:
 *   - record: 갱신된 record
 *   - shouldEmitDetailLog: true 면 상세 로그 1회 출력 가능 (호출자가 결정)
 */
export interface RecordKisRealDataFailureResult {
  record: KisRealDataNoiseRecord;
  shouldEmitDetailLog: boolean;
}

export function recordKisRealDataFailure(
  classification: KisRealDataNoiseClassification,
  now: Date = new Date(),
): RecordKisRealDataFailureResult {
  if (isKisRealDataBackoffDisabled()) {
    // ENV uninstall — ephemeral record, 모든 detail log 통과 (suppress 0).
    const ephemeralKey = buildKisRealDataNoiseKey({
      endpoint: classification.endpoint,
      ...(classification.symbol !== undefined ? { symbol: classification.symbol } : {}),
      errorKind: classification.errorKind,
    });
    const ephemeral: KisRealDataNoiseRecord = {
      key: ephemeralKey,
      endpoint: classification.endpoint,
      ...(classification.symbol !== undefined ? { symbol: classification.symbol } : {}),
      errorKind: classification.errorKind,
      consecutiveFailures: 1,
      firstFailureAt: now.toISOString(),
      lastFailureAt: now.toISOString(),
      nextAllowedAt: now.toISOString(),
      cooldownMs: 0,
      suppressedLogCount: 0,
      retryExhausted: false,
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'NONE',
    };
    return { record: ephemeral, shouldEmitDetailLog: true };
  }

  const key = buildKisRealDataNoiseKey({
    endpoint: classification.endpoint,
    ...(classification.symbol !== undefined ? { symbol: classification.symbol } : {}),
    errorKind: classification.errorKind,
  });
  const existing = _records.get(key);
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const cooldownMs = COOLDOWN_BY_ERROR_KIND_MS[classification.errorKind];
  const nextAllowedAt = new Date(now.getTime() + cooldownMs).toISOString();
  const retryExhausted = consecutiveFailures >= RETRY_EXHAUSTED_AT_FAILURES;
  const shouldEmitDetailLog = consecutiveFailures <= SUPPRESS_DETAIL_AFTER_FAILURES;
  const suppressedLogCount = (existing?.suppressedLogCount ?? 0) + (shouldEmitDetailLog ? 0 : 1);

  const next: KisRealDataNoiseRecord = {
    key,
    endpoint: classification.endpoint,
    ...(classification.symbol !== undefined ? { symbol: classification.symbol } : {}),
    errorKind: classification.errorKind,
    consecutiveFailures,
    firstFailureAt: existing?.firstFailureAt ?? now.toISOString(),
    lastFailureAt: now.toISOString(),
    nextAllowedAt,
    cooldownMs,
    suppressedLogCount,
    retryExhausted,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
  };
  _records.set(key, next);
  return { record: next, shouldEmitDetailLog };
}

/**
 * 성공 응답 시 record reset (해당 key 만 삭제) — fast recovery.
 */
export function recordKisRealDataSuccess(input: {
  endpoint: string;
  symbol?: string;
}): void {
  if (isKisRealDataBackoffDisabled()) return;
  // 동일 endpoint:symbol prefix 의 모든 errorKind reset (성공은 모든 분류를 회복).
  const sym = input.symbol ?? '*';
  const prefix = `${input.endpoint}:${sym}:`;
  for (const key of Array.from(_records.keys())) {
    if (key.startsWith(prefix)) _records.delete(key);
  }
}

/**
 * cooldown 활성 여부 — 호출자가 fetch skip 결정에 사용.
 * ENV disabled 시 항상 false.
 */
export function isKisRealDataCooldownActive(input: {
  endpoint: string;
  symbol?: string;
  errorKind?: KisRealDataErrorKind;
  now?: Date;
}): boolean {
  if (isKisRealDataBackoffDisabled()) return false;
  const now = input.now ?? new Date();
  const sym = input.symbol ?? '*';
  if (input.errorKind) {
    const key = buildKisRealDataNoiseKey({
      endpoint: input.endpoint,
      ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
      errorKind: input.errorKind,
    });
    const rec = _records.get(key);
    if (!rec) return false;
    return Date.parse(rec.nextAllowedAt) > now.getTime();
  }
  // errorKind 미지정 — 동일 endpoint:symbol 의 모든 record 중 하나라도 활성이면 true.
  const prefix = `${input.endpoint}:${sym}:`;
  for (const [key, rec] of _records.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (Date.parse(rec.nextAllowedAt) > now.getTime()) return true;
  }
  return false;
}

/**
 * 모든 record snapshot (read-only) — diagnostic compact summary 빌더용.
 */
export function listKisRealDataNoiseRecords(): readonly KisRealDataNoiseRecord[] {
  return Array.from(_records.values());
}

/**
 * Compact summary SSOT — `[KIS-RealDataSummary]` INFO 라인 1줄 합성.
 *
 * 호출자는 매 5xx 마다 호출하지 말고 NOISE_SUMMARY_LOG_INTERVAL_MS 간격으로
 * 노이즈 격리. `shouldEmitNow=true` 일 때만 INFO 출력 가능.
 */
export interface ShouldEmitNoiseSummaryResult {
  shouldEmitNow: boolean;
  intervalMs: number;
}

export function shouldEmitNoiseSummary(now: Date = new Date()): ShouldEmitNoiseSummaryResult {
  const elapsed = now.getTime() - _lastSummaryLoggedAt;
  if (elapsed >= NOISE_SUMMARY_LOG_INTERVAL_MS) {
    _lastSummaryLoggedAt = now.getTime();
    return { shouldEmitNow: true, intervalMs: NOISE_SUMMARY_LOG_INTERVAL_MS };
  }
  return { shouldEmitNow: false, intervalMs: NOISE_SUMMARY_LOG_INTERVAL_MS };
}

export function formatKisRealDataNoiseSummaryLine(record: KisRealDataNoiseRecord): string {
  const cooldownSec = Math.round(record.cooldownMs / 1000);
  return (
    `[KIS-RealDataSummary] endpoint=${record.endpoint} `
    + `errorKind=${record.errorKind} `
    + `failures=${record.consecutiveFailures} `
    + `suppressed=${record.suppressedLogCount} `
    + `cooldown=${cooldownSec}s `
    + `providerIssue=true marketSignal=false executionImpact=NONE`
  );
}

/**
 * `/scan_blockers supply | runtime` compact health 섹션 (multi-line).
 * 빈 store → null 반환 (호출자가 noise 차단).
 */
export function formatKisRealDataHealthSection(
  records: readonly KisRealDataNoiseRecord[] = listKisRealDataNoiseRecords(),
): string | null {
  if (records.length === 0) return null;
  // 가장 큰 consecutiveFailures 우선 표시 (Top 3).
  const topRecords = records
    .slice()
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    .slice(0, 3);
  const lines: string[] = ['🔌 KIS RealData Health [PATCH-RUNTIME] (Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001)'];
  for (const r of topRecords) {
    const cooldownSec = Math.round(r.cooldownMs / 1000);
    const symLabel = r.symbol ? ` symbol=${r.symbol}` : '';
    lines.push(`• endpoint: ${r.endpoint}${symLabel}`);
    lines.push(`  errorKind: ${r.errorKind}${r.retryExhausted ? ' (retry exhausted)' : ''}`);
    lines.push(`  failures: ${r.consecutiveFailures} · suppressedLogs: ${r.suppressedLogCount} · cooldown: ${cooldownSec}s`);
  }
  lines.push('• providerIssue=true · marketSignal=false · executionImpact=NONE');
  lines.push('• action: keep engine alive; retry after cooldown');
  return lines.join('\n');
}

/* ───────── 진단 전용 last-error 레코더 (passive — Patch-LEADER-PROBE-LASTERR-DIAG) ─────────
 *
 * 목적: /leader_refresh 프로브가 랭킹 TR 의 *마지막 real-data 실패* HTTP status /
 *   errorKind 를 표시해 403(권한) vs 5xx(일시장애) 를 구분하게 한다.
 *
 * 격리 불변식 (절대 변경 금지):
 *   - 본 맵은 cooldown / circuit breaker / provider-health 와 완전 분리된 read/stamp 전용.
 *     기존 recordKisRealDataFailure / recordProviderFailure 호출 빈도·인자 0 변경.
 *   - stamp 는 passive observation only — 어떤 retry/skip/집계 결정에도 사용되지 않는다.
 *   - executionImpact=NONE · marketSignal=false. provider 장애 ≠ bearish (불변식 #6).
 */

export interface RealDataLastErrorDiag {
  endpoint: string;
  httpStatus?: number;
  errorKind: KisRealDataErrorKind;
  at: string;
}

const _lastErrorDiagByEndpoint = new Map<string, RealDataLastErrorDiag>();

/**
 * endpoint(=apiPath, chartContext 없는 비-chart realData GET) 별 마지막 실패 status 를 stamp.
 * 순수 진단 stamp — cooldown/circuit/provider-health 에 일절 관여하지 않는다.
 */
export function recordRealDataLastErrorForDiag(input: {
  endpoint: string;
  httpStatus?: number;
  message?: string;
  now?: Date;
}): void {
  const classification = classifyKisRealDataError({
    endpoint: input.endpoint,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
  });
  const entry: RealDataLastErrorDiag = {
    endpoint: input.endpoint,
    errorKind: classification.errorKind,
    at: (input.now ?? new Date()).toISOString(),
  };
  if (input.httpStatus !== undefined) entry.httpStatus = input.httpStatus;
  _lastErrorDiagByEndpoint.set(input.endpoint, entry);
}

/**
 * endpoint(apiPath) 의 마지막 진단용 실패 레코드 read (순수). 없으면 null.
 */
export function getRealDataLastErrorForDiag(endpoint: string): RealDataLastErrorDiag | null {
  return _lastErrorDiagByEndpoint.get(endpoint) ?? null;
}

/**
 * 성공 응답 시 해당 endpoint 의 진단 last-error stamp 해제 (회복 반영). 순수 read/delete.
 */
export function clearRealDataLastErrorForDiag(endpoint: string): void {
  _lastErrorDiagByEndpoint.delete(endpoint);
}

/* ───────── test isolation ───────── */

export function __resetKisRealDataNoiseStoreForTests(): void {
  _records.clear();
  _lastSummaryLoggedAt = 0;
  _lastErrorDiagByEndpoint.clear();
}
