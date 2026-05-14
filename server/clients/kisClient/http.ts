/**
 * @responsibility KIS REST 저수준 호출 — raw GET/POST + rate-limited 래퍼 + 실계좌 GET
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 HTTP 레이어 격리.
 * ADR-0014 retry safety (idempotency 'unsafe' 5xx 차단) + PR-21 회로차단 + PR-24 24h 블랙리스트.
 * ADR-0368: realDataKisGet 5xx에도 retry/backoff/circuit를 적용해 KIS 500 로그 폭주 차단.
 */

import { scheduleKisCall, type KisApiPriority } from '../kisRateLimiter.js';
import { assertModeCompatible } from '../kisModeGuard.js';
import { KIS_BASE, KIS_IS_REAL, REAL_DATA_BASE, HAS_REAL_DATA_CLIENT } from './constants.js';
import { refreshKisToken, refreshRealDataToken, invalidateKisToken } from './auth.js';
import {
  _isCircuitOpen,
  _recordCircuitFailure,
  _recordCircuitSuccess,
  _kisBackoffDelayMs,
  _kis429DelayMs,
  _isKisRetryEnabled,
  _kisSleep,
  _alertUnsafeWriteFailure,
} from './resilience.js';
import { getKisOverrides } from './overrides.js';
import type { KisPostIdempotency, KisPostOptions } from './types.js';
// Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — provider noise classification + per-key
//   cooldown + suppressed log count. providerIssue=true / marketSignal=false /
//   executionImpact='NONE' literal type 강제. ENV `KIS_REALDATA_BACKOFF_DISABLED=true`
//   1줄 즉시 기존 retry/log 동작 100% 복원.
import {
  classifyKisRealDataError,
  formatKisRealDataNoiseSummaryLine,
  isKisRealDataCooldownActive,
  recordKisRealDataFailure,
  recordKisRealDataSuccess,
  shouldEmitNoiseSummary,
} from './realDataNoiseStore.js';
// Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine (OPEN/HALF_OPEN/
//   CLOSED) + KIS500 단독 실패가 매매엔진 중단 사유 아님 강제. ENV
//   `KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED=true` 1줄 즉시 Patch-001 직후 동작 100% 복원.
import {
  evaluateCircuitTransition,
  recordProviderFailure,
  recordProviderSuccess,
  shouldSkipProviderCall,
} from './providerHealthIsolationPatch003.js';
// Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001 — 5-priority budget queue (P0~P4) +
//   trId+symbol+priority TTL dedup + DATA_VACUUM root cause 4분류. literal type 강제로
//   marketSignal=false / executionImpact=NONE|NEW_BUY_BLOCKED_ONLY / engineAlive=true /
//   shadowLearning=true 보장. ENV `KIS_PRIORITY_BUDGET_PATCH_004_DISABLED=true` 1줄 즉시
//   Patch-003 동작 100% 복원. 호출자 측 inline ENV 검사 0건 — SSOT 위임.
import {
  evaluatePriorityBudget,
  formatKisPriorityBudgetLogThrottled,
  isPriorityCallDeduped,
  mapPriorityV1ToV2,
  recordPriorityBudgetCall,
  recordPriorityCallTtl,
  shouldEmitTtlDedupLog,
} from './kisPriorityBudgetPatch004.js';
import {
  classifyDataVacuumRootCause,
  formatDataVacuumRootCauseLogThrottled,
} from './dataVacuumRootCauseClassifierPatch004.js';
import {
  assessKisTrPressure,
  classifyKisError,
  coordinateKisRetry,
  formatKisFallbackSelectedLog,
  formatKisProviderDegradedSafeLog,
  formatKisTrPressureLog,
  getKisCallPressureSnapshot,
  isKisServerCircuitOpen,
  isKisTemporaryUnsupported,
  recordKisCallDeferred,
  recordKisCallFinished,
  recordKisCallStarted,
  recordKisServerErrorForCircuit,
  recordKisServerSuccess,
  recordKisUnsupported404,
  selectKisFallback,
} from './errorTaxonomy.js';

/**
 * 내부 raw GET — 토큰 버킷 없이 직접 호출. 외부에서는 kisGet을 사용할 것.
 *
 * 재시도 정책 (retriesLeft 기본 3회):
 *   - 401 Unauthorized: 토큰 무효화 + 즉시 재시도
 *   - 429 Too Many Requests: 1초+jitter 대기 후 재시도
 *   - 5xx Server Error: 지수 백오프+jitter 후 재시도 (READ 안전)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _rawKisGet(
  trId: string, apiPath: string, params: Record<string, string>, retriesLeft = 3,
): Promise<any> {
  if (_isCircuitOpen(trId)) {
    console.warn(`[KIS] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
    return null;
  }

  const token = await refreshKisToken();
  const url = `${KIS_BASE}${apiPath}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
  });

  const retryAllowed = retriesLeft > 0 && _isKisRetryEnabled();

  if (res.status === 401 && retryAllowed) {
    console.warn(`[KIS] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도 (${retriesLeft}회 남음)`);
    invalidateKisToken();
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (res.status === 429 && retryAllowed) {
    const delay = _kis429DelayMs();
    console.warn(`[KIS] 429 Rate Limit (${trId}) — ${delay}ms 대기 후 재시도 (${retriesLeft}회 남음)`);
    await _kisSleep(delay);
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (res.status >= 500 && res.status < 600 && retryAllowed) {
    const delay = _kisBackoffDelayMs(retriesLeft);
    console.warn(`[KIS] ${res.status} (${trId}) 재시도 ${retriesLeft}회 남음, ${delay}ms 대기`);
    await _kisSleep(delay);
    return _rawKisGet(trId, apiPath, params, retriesLeft - 1);
  }

  if (!res.ok) {
    console.error(`[KIS] API 오류 ${res.status} (${trId})`);
    if (res.status >= 500 && res.status < 600) _recordCircuitFailure(trId, res.status);
    return null;
  }

  _recordCircuitSuccess(trId);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * 내부 raw POST — 토큰 버킷 없이 직접 호출. 외부에서는 kisPost를 사용할 것.
 *
 * ADR-0014 재시도 정책:
 *   - 401: 안전 재시도 (인증 거부, 매칭엔진 미진입)
 *   - 429: 안전 재시도 (게이트웨이 거부, 매칭엔진 미진입)
 *   - 5xx + idempotency='safe': 지수 백오프+jitter 재시도
 *   - 5xx + idempotency='unsafe': **재시도 차단** + 텔레그램 경보 (중복 주문 방지)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _rawKisPost(
  trId: string, apiPath: string, body: Record<string, string>,
  options: { idempotency: KisPostIdempotency } = { idempotency: 'unsafe' },
  retriesLeft = 3,
): Promise<any> {
  if (_isCircuitOpen(trId)) {
    console.warn(`[KIS] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
    return null;
  }

  const token = await refreshKisToken();
  const res = await fetch(`${KIS_BASE}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
      custtype: 'P',
    },
    body: JSON.stringify(body),
  });

  const retryAllowed = retriesLeft > 0 && _isKisRetryEnabled();

  if (res.status === 401 && retryAllowed) {
    console.warn(`[KIS] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도 (${retriesLeft}회 남음)`);
    invalidateKisToken();
    return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
  }

  if (res.status === 429 && retryAllowed) {
    const delay = _kis429DelayMs();
    console.warn(`[KIS] 429 Rate Limit (${trId}) — ${delay}ms 대기 후 재시도 (${retriesLeft}회 남음)`);
    await _kisSleep(delay);
    return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
  }

  if (res.status >= 500 && res.status < 600) {
    // ADR-0014: WRITE(unsafe) 는 5xx 후 재시도 차단 — KIS 가 받았는지 알 수 없어 중복 주문 위험.
    if (options.idempotency === 'unsafe') {
      console.error(
        `[KIS] ${res.status} WRITE 실패 (${trId}) — 재시도 차단 (중복 주문 방지). ` +
        `KIS 실주문 상태를 HTS 로 확인 필요.`
      );
      _recordCircuitFailure(trId, res.status);
      // 텔레그램 경보는 비동기로 발사 — 실패해도 호출자 흐름 차단하지 않음.
      void _alertUnsafeWriteFailure(trId, apiPath, res.status);
      return null;
    }
    if (retryAllowed) {
      const delay = _kisBackoffDelayMs(retriesLeft);
      console.warn(`[KIS] ${res.status} (${trId}) 재시도 ${retriesLeft}회 남음, ${delay}ms 대기`);
      await _kisSleep(delay);
      return _rawKisPost(trId, apiPath, body, options, retriesLeft - 1);
    }
  }

  if (!res.ok) {
    console.error(`[KIS] API 오류 ${res.status} (${trId})`);
    if (res.status >= 500 && res.status < 600) _recordCircuitFailure(trId, res.status);
    return null;
  }

  _recordCircuitSuccess(trId);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Rate-limited KIS GET. 모든 외부 호출은 토큰 버킷을 통과한다.
 * @param priority 기본 MEDIUM. 매도 체결 확인은 HIGH, 잔고/데이터 조회는 LOW.
 */
export function kisGet(
  trId: string, apiPath: string, params: Record<string, string>,
  priority: KisApiPriority = 'MEDIUM',
) {
  assertModeCompatible(trId, KIS_IS_REAL ? 'LIVE' : 'VTS');
  return scheduleKisCall(priority, `GET ${trId}`, () => _rawKisGet(trId, apiPath, params));
}

/**
 * Rate-limited KIS POST. 모든 외부 호출은 토큰 버킷을 통과한다.
 *
 * ADR-0014: `options.idempotency` 기본 'unsafe' — 주문/취소 등 mutate 호출 보호.
 * 5xx 후 재시도가 중복 주문을 만들 수 있으므로 차단 + 텔레그램 경보. read-only POST 가
 * 추가될 경우 호출자가 명시적으로 `{ idempotency: 'safe' }` 전달.
 *
 * @param priority 기본 HIGH (주문 계열). 데이터 조회는 LOW.
 * @param options.idempotency 'unsafe' (기본) | 'safe'
 */
export function kisPost(
  trId: string, apiPath: string, body: Record<string, string>,
  priority: KisApiPriority = 'HIGH',
  options: KisPostOptions = {},
) {
  assertModeCompatible(trId, KIS_IS_REAL ? 'LIVE' : 'VTS');
  const idempotency = options.idempotency ?? 'unsafe';
  return scheduleKisCall(priority, `POST ${trId}`, () =>
    _rawKisPost(trId, apiPath, body, { idempotency }),
  );
}

// ─── 실계좌 데이터 전용 HTTP 헬퍼 ────────────────────────────────────────────
// 시장 데이터(거래량 순위, 현재가, 투자자 수급 등) 조회 전용.
// 실계좌 키 미설정 시 모의계좌 kisGet으로 자동 폴백.

/**
 * 실계좌 데이터 GET 에서 실패가 반복되는 endpoint/trId 를 짧게 차단한다.
 * 기존 circuit 은 3회 누적 후 10분 차단이라 충분하지만, realDataKisGet 은 스캔 루프에서
 * 같은 TR 이 다수 종목에 반복될 수 있어 첫 5xx 직후에도 짧은 micro-cooldown 이 필요하다.
 */
const _realData5xxCooldownUntil = new Map<string, number>();

function realDataCooldownKey(trId: string, apiPath: string): string {
  return `${trId}:${apiPath}`;
}

function realData5xxCooldownMs(status: number): number {
  const env = Number(process.env.KIS_REALDATA_5XX_COOLDOWN_MS);
  if (Number.isFinite(env) && env >= 0) return env;
  return status >= 500 && status < 600 ? 60_000 : 0;
}

function isRealData5xxCooldownActive(trId: string, apiPath: string): boolean {
  const until = _realData5xxCooldownUntil.get(realDataCooldownKey(trId, apiPath)) ?? 0;
  return Date.now() < until;
}

function recordRealData5xxCooldown(trId: string, apiPath: string, status: number): void {
  const cooldownMs = realData5xxCooldownMs(status);
  if (cooldownMs <= 0) return;
  _realData5xxCooldownUntil.set(realDataCooldownKey(trId, apiPath), Date.now() + cooldownMs);
}

function clearRealData5xxCooldown(trId: string, apiPath: string): void {
  _realData5xxCooldownUntil.delete(realDataCooldownKey(trId, apiPath));
}


const _realDataInFlight = new Map<string, { promise: Promise<any>; joinedCount: number }>();
const _realDataLastGood = new Map<string, { value: any; storedAt: number }>();

function mapKisApiPriority(priority: KisApiPriority): 'REAL_POSITION' | 'READY_CANDIDATE' | 'SCAN_DIAGNOSTIC' {
  if (priority === 'HIGH') return 'REAL_POSITION';
  if (priority === 'MEDIUM') return 'READY_CANDIDATE';
  return 'SCAN_DIAGNOSTIC';
}

function stableQueryHash(params: Record<string, string>): string {
  return JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]));
}

function kisRequestKey(trId: string, apiPath: string, params: Record<string, string>): string {
  const symbol = params.symbol ?? params.FID_INPUT_ISCD ?? params.pdno ?? 'UNKNOWN';
  const marketCode = params.marketCode ?? params.FID_COND_MRKT_DIV_CODE ?? params.FID_COND_MRKT_DIV_CODE_1 ?? 'ANY';
  return `${trId}:${apiPath}:${symbol}:${marketCode}:${stableQueryHash(params)}`;
}

function getLastGoodForKey(requestKey: string): { value: any; ageMs: number; confidence: 'DEGRADED' | 'STALE' | 'MISSING' } | null {
  const cached = _realDataLastGood.get(requestKey);
  if (!cached) return null;
  const ageMs = Date.now() - cached.storedAt;
  if (ageMs <= 30_000) return { value: cached.value, ageMs, confidence: 'DEGRADED' };
  if (ageMs <= 180_000) return { value: cached.value, ageMs, confidence: 'STALE' };
  return { value: null, ageMs, confidence: 'MISSING' };
}

/**
 * 실계좌 데이터 전용 GET 요청 (rate-limited).
 * KIS_REAL_DATA_APP_KEY 설정 시 실계좌 서버로, 미설정 시 기존 kisGet 폴백.
 */
export function realDataKisGet(
  trId: string,
  apiPath: string,
  params: Record<string, string>,
  priority: KisApiPriority = 'LOW',
) {
  const overrides = getKisOverrides();
  if (overrides.realDataKisGet) return overrides.realDataKisGet(trId, apiPath, params);
  if (!HAS_REAL_DATA_CLIENT) return kisGet(trId, apiPath, params, priority);

  const requestKey = kisRequestKey(trId, apiPath, params);
  const symbol = params.symbol ?? params.FID_INPUT_ISCD ?? params.pdno ?? 'UNKNOWN';
  const callPriority = mapKisApiPriority(priority);
  const inFlight = _realDataInFlight.get(requestKey);
  if (inFlight) {
    inFlight.joinedCount += 1;
    console.info(`[KIS_SINGLE_FLIGHT_JOINED] trId=${trId} symbol=${symbol} requestKey=${requestKey} joinedCount=${inFlight.joinedCount} executionImpact=NONE`);
    return inFlight.promise;
  }

  const promise = scheduleKisCall(priority, `REAL_GET ${trId}`, async () => {
    const pressureGate = assessKisTrPressure({ trId, priority: callPriority });
    if (pressureGate.level === 'SOFT' || pressureGate.level === 'HARD') {
      console.warn(`[KIS_TR_THROTTLE_APPLIED] trId=${trId} level=${pressureGate.level} sameSecondCalls=${pressureGate.sameSecondCalls} sameMinuteCalls=${pressureGate.sameMinuteCalls} retryWaveDetected=${pressureGate.retryWaveDetected} action=DEFER_LOW_PRIORITY_CALLS executionImpact=NONE`);
    }
    // Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001 — 5-priority budget queue (P0~P4)
    //   wiring 진입. P0_POSITION_EXIT 는 항상 통과 (절대 불변식). circuit OPEN/HARD throttle 시
    //   P3/P4 자동 defer/suppress. TTL dedup 으로 5초 내 동일 trId+symbol+priority 중복 차단.
    //   LIVE 매매 본체 0줄 변경 — 진단 layer + 신규 fallback decision wrapper 만.
    const callPriorityV2 = mapPriorityV1ToV2(pressureGate.shouldDefer || _isCircuitOpen(trId) || isKisServerCircuitOpen(trId)
      ? pressureGate.circuitState === 'OPEN' || pressureGate.level === 'HARD' ? callPriority : callPriority
      : callPriority);
    const _cachedForBudget = getLastGoodForKey(requestKey);
    const _cacheAvailableForBudget = _cachedForBudget !== null && _cachedForBudget.confidence !== 'MISSING';
    const budgetDecision = evaluatePriorityBudget({
      trId,
      symbol,
      priority: callPriorityV2,
      throttleLevel: pressureGate.level,
      circuitState: pressureGate.circuitState,
      sameSecondCalls: pressureGate.sameSecondCalls,
      sameMinuteCalls: pressureGate.sameMinuteCalls,
      cacheAvailable: _cacheAvailableForBudget,
    });
    if (!budgetDecision.allowed) {
      // Patch-004 throttle hotfix — (trId, reason) 별 60s window 내 첫 emit 1회만 detail
      //   출력, 후속은 suppress + 카운트 누적. 60s 경과 후 다음 emit 에 suppressedCount
      //   suffix 부착. ENV `KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED=true` 1줄 즉시 복원.
      //   사용자 5/14 Railway 로그 도배 결함 차단 — `realDataKisGet` 매 호출마다 2 console.warn
      //   라인이 throttle/circuit 활성 시 분당 수백 라인 폭주하던 결함.
      const budgetLog = formatKisPriorityBudgetLogThrottled(budgetDecision);
      if (budgetLog) console.warn(budgetLog);
      const vacuum = classifyDataVacuumRootCause({
        throttleLevel: pressureGate.level,
        circuitState: pressureGate.circuitState,
        hasRecent5xx: pressureGate.circuitState === 'OPEN' || pressureGate.circuitState === 'CLOSED_RECOVERED',
        cacheAvailable: _cacheAvailableForBudget,
        upstreamHydrationFailed: false,
      });
      const vacuumLog = formatDataVacuumRootCauseLogThrottled(vacuum);
      if (vacuumLog) console.warn(vacuumLog);
      if (budgetDecision.deferred) {
        recordKisCallDeferred(trId, Date.now(), { endpoint: apiPath, symbol, caller: 'realDataKisGet', priority: callPriority });
      }
      if (_cachedForBudget && _cachedForBudget.confidence !== 'MISSING') {
        return _cachedForBudget.value;
      }
      return null;
    }
    if (_isCircuitOpen(trId) || isKisServerCircuitOpen(trId) || pressureGate.shouldDefer) {
      const cached = getLastGoodForKey(requestKey);
      recordKisCallDeferred(trId, Date.now(), { endpoint: apiPath, symbol, caller: 'realDataKisGet', priority: callPriority });
      console.warn(`[KIS_CALL_DEFERRED] trId=${trId} reason=TR_CIRCUIT_OPEN_OR_THROTTLED priority=${callPriority} deferredUntil=${new Date(Date.now() + 60_000).toISOString()} executionImpact=NONE`);
      console.info(`[KIS_PRIORITY_QUEUE_STATUS] trId=${trId} allowed=0 deferred=1 dropped=0 byPriority={"${callPriority}":1}`);
      if (cached && cached.confidence !== 'MISSING') {
        console.info(`[KIS_LAST_GOOD_VALUE_USED] trId=${trId} symbol=${symbol} ageSec=${Math.ceil(cached.ageMs / 1000)} confidence=${cached.confidence} executionImpact=NONE`);
        console.info(`[KIS_FALLBACK_SELECTED] fromTrId=${trId} errorClass=SERVER_ERROR fallbackProvider=CACHE reason=TR_CIRCUIT_OPEN confidence=${cached.confidence} executionImpact=NONE`);
        return cached.value;
      }
      console.info(`[KIS_FALLBACK_SELECTED] fromTrId=${trId} errorClass=SERVER_ERROR fallbackProvider=NONE reason=TR_CIRCUIT_OPEN confidence=MISSING executionImpact=NONE`);
      console.info(formatKisProviderDegradedSafeLog(trId));
      return null;
    }
    if (isKisTemporaryUnsupported({ trId, endpoint: apiPath, marketCode: params.marketCode ?? params.FID_COND_MRKT_DIV_CODE })) {
      recordKisCallDeferred(trId, Date.now(), { endpoint: apiPath, symbol, caller: 'realDataKisGet', priority: callPriority });
      return null;
    }
    if (isRealData5xxCooldownActive(trId, apiPath)) {
      console.warn(`[KIS-RealData] 5xx micro-cooldown — ${trId} ${apiPath} 호출 건너뜀`);
      return null;
    }
    // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — per-key (endpoint + symbol +
    //   errorKind) cooldown 활성 시 호출 자체 skip. ENV disabled 시 무영향.
    //   호출자 측 inline ENV 검사 0건 — `isKisRealDataCooldownActive` SSOT 위임.
    if (isKisRealDataCooldownActive({ endpoint: apiPath })) {
      // 잡음 차단 — cooldown skip 은 별도 INFO 로그 0건 (suppressed count 만 누적).
      return null;
    }
    // Patch-KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001 — TTL dedup check + budget call record.
    //   동일 trId+symbol+priority 호출이 5초 TTL 내 중복이면 dedup defer.
    //   P0_POSITION_EXIT 은 dedup 적용 안 함 (보유 매도 절대 보호 invariant).
    if (isPriorityCallDeduped(trId, symbol, callPriorityV2)) {
      // Patch-004 throttle hotfix — TTL_DEDUP_DUPLICATE 도 trId 별 60s window 적용.
      //   5초 TTL dedup 자체는 동작 그대로 (호출 차단 = 정상 invariant), 로그 출력만 throttle.
      const dedupLog = shouldEmitTtlDedupLog(trId);
      if (dedupLog.emit) {
        const suffix = dedupLog.suppressedSinceLast > 0
          ? ` suppressedSinceLastMs=${dedupLog.windowMs} suppressedCount=${dedupLog.suppressedSinceLast}`
          : '';
        console.warn(`[KIS_PRIORITY_BUDGET] priority=${callPriorityV2} allowed=false reason=TTL_DEDUP_DUPLICATE action=DEFER executionImpact=NONE${suffix}`);
      }
      return null;
    }
    recordPriorityCallTtl(trId, symbol, callPriorityV2);
    recordPriorityBudgetCall(trId, callPriorityV2);
    // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine.
    //   OPEN 상태 시 호출 차단 (잡음 0). HALF_OPEN 으로 자동 전이 후 1회 test 통과.
    //   호출자 측 inline ENV 검사 0건 — `shouldSkipProviderCall` SSOT 위임.
    evaluateCircuitTransition();
    if (shouldSkipProviderCall()) {
      return null;
    }

    const doFetch = async (token: string) => {
      recordKisCallStarted(trId, Date.now(), { endpoint: apiPath, symbol, caller: 'realDataKisGet', priority: callPriority, retryAttempt: 2 - retriesLeft, isRetry: retriesLeft < 2 });
      try {
        return await fetch(
          `${REAL_DATA_BASE}${apiPath}?${new URLSearchParams(params)}`,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              appkey: process.env.KIS_REAL_DATA_APP_KEY!,
              appsecret: process.env.KIS_REAL_DATA_APP_SECRET!,
              tr_id: trId,
              custtype: 'P',
            },
          },
        );
      } finally {
        recordKisCallFinished();
      }
    };

    let retriesLeft = _isKisRetryEnabled() ? 2 : 0;
    let token = await refreshRealDataToken();

    for (;;) {
      let res = await doFetch(token);

      // 401 감지 → 실계좌 데이터 토큰 강제 무효화 후 1회 재시도
      if (res.status === 401 && retriesLeft > 0) {
        console.warn(`[KIS-RealData] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도`);
        invalidateKisToken();
        token = await refreshRealDataToken();
        retriesLeft -= 1;
        res = await doFetch(token);
      }

      if (res.status === 429 && retriesLeft > 0) {
        const delay = _kis429DelayMs();
        console.warn(`[KIS-RealData] 429 Rate Limit (${trId}) — ${delay}ms 대기 후 재시도 (${retriesLeft}회 남음)`);
        await _kisSleep(delay);
        retriesLeft -= 1;
        continue;
      }

      if (res.status >= 500 && res.status < 600) {
        _recordCircuitFailure(trId, res.status);
        const circuit = recordKisServerErrorForCircuit(trId);
        recordRealData5xxCooldown(trId, apiPath, res.status);
        const taxonomy = classifyKisError({
          httpStatus: res.status,
          trId,
          endpoint: apiPath,
          marketCode: params.marketCode ?? params.FID_COND_MRKT_DIV_CODE,
          symbol: params.symbol ?? params.FID_INPUT_ISCD,
        });
        const trPressure = assessKisTrPressure({ trId, priority: callPriority, httpStatus: res.status });
        const pressure = getKisCallPressureSnapshot(Date.now(), trId);
        console.info(
          `[KIS_CALL_PRESSURE] windowSec=${pressure.windowSec} totalCalls=${pressure.totalCalls} `
          + `byTrId=${JSON.stringify(pressure.byTrId)} concurrentCalls=${pressure.concurrentCalls} `
          + `queuedCalls=${pressure.queuedCalls} deferredCalls=${pressure.deferredCalls}`,
        );
        console.warn(
          `[KIS_SERVER_ERROR_CONTEXT] trId=${trId} httpStatus=${res.status} `
          + `sameSecondCalls=${pressure.sameSecondCalls} sameMinuteCalls=${pressure.sameMinuteCalls} `
          + `concurrentCalls=${pressure.concurrentCalls} queuedCalls=${pressure.queuedCalls} deferredCalls=${pressure.deferredCalls} `
          + `retryWaveDetected=${pressure.retryWaveDetected} circuitState=${trPressure.circuitState} caller=realDataKisGet `
          + `priority=${callPriority} retryLeft=${retriesLeft} backoffMs=${retriesLeft > 0 ? _kisBackoffDelayMs(retriesLeft) : 0} `
          + `providerIssue=true marketSignal=false executionImpact=NONE`,
        );
        console.info(formatKisTrPressureLog({ trId, priority: callPriority }));
        if (trPressure.level === 'CIRCUIT_OPEN') {
          console.warn(`[KIS_TR_CIRCUIT_OPEN] trId=${trId} reason=CALL_PRESSURE_OR_RETRY_WAVE sameSecondCalls=${trPressure.sameSecondCalls} sameMinuteCalls=${trPressure.sameMinuteCalls} retryWaveDetected=${trPressure.retryWaveDetected} cooldownSec=60 executionImpact=NONE`);
        }
        // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — provider noise 분류 +
        //   per-key suppressed count. providerIssue=true / marketSignal=false /
        //   executionImpact='NONE' literal type 강제.
        const classified = classifyKisRealDataError({
          endpoint: apiPath,
          httpStatus: res.status,
        });
        const noise = recordKisRealDataFailure(classified);
        // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine update.
        //   5xx 누적 시 60s burst / 5min burst / consecutive 임계 평가 후 OPEN 자동 전이.
        recordProviderFailure(classified);
        if (retriesLeft > 0) {
          const delay = _kisBackoffDelayMs(retriesLeft);
          const retry = coordinateKisRetry({ trId, retryAttempt: 3 - retriesLeft, backoffMs: delay, retryWaveDetected: trPressure.retryWaveDetected || trPressure.level === 'CIRCUIT_OPEN' });
          if (!retry.allowed) {
            console.warn(`[KIS_RETRY_WAVE_BLOCKED] trId=${trId} suppressedRetries=${retry.suppressedRetries} representativeRetry=${retry.representativeRetry} reason=${retry.reason ?? 'RETRY_WAVE_DETECTED'} executionImpact=NONE`);
            retriesLeft = 0;
          } else {
            console.info(`[KIS_RETRY_COORDINATED] trId=${trId} retryAttempt=${3 - retriesLeft} backoffMs=${delay} jitterMs=${retry.jitterMs} singleFlight=true`);
          }
          if (noise.shouldEmitDetailLog) {
            console.warn(
              `[KIS_SERVER_ERROR] trId=${trId} httpStatus=${res.status} retryable=${taxonomy.retryable} `
              + `retryLeft=${retriesLeft} backoffMs=${delay} providerIssue=true marketSignal=false executionImpact=NONE`,
            );
          } else {
            // 반복 5xx — 상세 로그 suppress + 60s 간격 INFO compact summary 노출.
            //   ENV disabled 시 shouldEmitNow=false (lastSummaryLoggedAt 갱신 안 함).
            const summary = shouldEmitNoiseSummary();
            if (summary.shouldEmitNow) {
              console.info(formatKisRealDataNoiseSummaryLine(noise.record));
            }
          }
          if (retriesLeft > 0) {
            await _kisSleep(delay);
            retriesLeft -= 1;
            continue;
          }
        }
        if (circuit.opened) {
          const fallback = selectKisFallback({ trId, errorClass: taxonomy.errorClass });
          console.warn(
            `[KIS_TR_CIRCUIT_OPEN] trId=${trId} reason=${circuit.reason ?? 'CALL_PRESSURE_OR_RETRY_WAVE'} sameSecondCalls=${pressure.sameSecondCalls} sameMinuteCalls=${pressure.sameMinuteCalls} retryWaveDetected=${pressure.retryWaveDetected} cooldownSec=${circuit.cooldownSec} `
            + `fallbackProvider=${fallback.fallbackProvider} executionImpact=NONE`,
          );
        }
        const fallback = selectKisFallback({ trId, errorClass: taxonomy.errorClass });
        console.info(formatKisFallbackSelectedLog({ fromTrId: trId, errorClass: taxonomy.errorClass, ...fallback }));
      }

      if (!res.ok) {
        if (res.status === 404) {
          const classified404 = recordKisUnsupported404({
            httpStatus: 404,
            trId,
            endpoint: apiPath,
            marketCode: params.marketCode ?? params.FID_COND_MRKT_DIV_CODE,
            symbol: params.symbol ?? params.FID_INPUT_ISCD,
          });
          const fallback = selectKisFallback({ trId, errorClass: classified404.errorClass });
          console.warn(
            `[KIS_ENDPOINT_UNSUPPORTED] trId=${trId} httpStatus=404 endpoint=${apiPath} `
            + `marketCode=${params.marketCode ?? params.FID_COND_MRKT_DIV_CODE ?? ''} `
            + `symbol=${params.symbol ?? params.FID_INPUT_ISCD ?? ''} reason=${classified404.errorClass} `
            + `retryable=${classified404.retryable} fallbackRequired=${classified404.fallbackRequired} executionImpact=NONE`,
          );
          console.info(formatKisFallbackSelectedLog({ fromTrId: trId, errorClass: classified404.errorClass, ...fallback }));
          return null;
        }
        const taxonomy = classifyKisError({
          httpStatus: res.status,
          trId,
          endpoint: apiPath,
          marketCode: params.marketCode ?? params.FID_COND_MRKT_DIV_CODE,
          symbol: params.symbol ?? params.FID_INPUT_ISCD,
        });
        console.error(
          `[KIS-RealData] API 오류 ${res.status} (${trId}) errorClass=${taxonomy.errorClass} `
          + `providerIssue=true marketSignal=false executionImpact=NONE`,
        );
        if (taxonomy.circuitBreakerEligible) _recordCircuitFailure(trId, res.status);
        if (taxonomy.fallbackRequired) {
          const fallback = selectKisFallback({ trId, errorClass: taxonomy.errorClass });
          console.info(formatKisFallbackSelectedLog({ fromTrId: trId, errorClass: taxonomy.errorClass, ...fallback }));
        }
        return null;
      }

      _recordCircuitSuccess(trId);
      recordKisServerSuccess(trId);
      clearRealData5xxCooldown(trId, apiPath);
      // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — 성공 응답 시 backoff state reset
      //   (해당 endpoint 의 모든 errorKind record 삭제 — fast recovery).
      recordKisRealDataSuccess({ endpoint: apiPath });
      // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker CLOSED 자동 전이.
      //   HALF_OPEN test 성공 시 CLOSED + consecutiveFailures=0 + sliding window 정리.
      recordProviderSuccess();
      const text = await res.text();
      if (!text.trim()) return null;
      try {
        const parsed = JSON.parse(text);
        _realDataLastGood.set(requestKey, { value: parsed, storedAt: Date.now() });
        return parsed;
      } catch { return null; }
    }
  }).finally(() => {
    _realDataInFlight.delete(requestKey);
  });
  _realDataInFlight.set(requestKey, { promise, joinedCount: 0 });
  return promise;
}
