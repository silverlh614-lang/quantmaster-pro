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
const KIS_CHART_TR_ID = 'FHKST03010100';
const KIS_CHART_5XX_COOLDOWN_MS = 5 * 60 * 1000;
const KIS_CHART_LOG_THROTTLE_MS = 60 * 1000;
const _kisChartLogThrottle = new Map<string, number>();

function getKisChartContext(trId: string, params: Record<string, string>): {
  trId: string;
  symbol: string;
  period: string;
  startDate: string;
  endDate: string;
} | null {
  if (trId !== KIS_CHART_TR_ID) return null;
  const rawSymbol = params.FID_INPUT_ISCD ?? '';
  const period = params.FID_PERIOD_DIV_CODE ?? '';
  if (!rawSymbol || !period) return null;
  const symbol = rawSymbol.padStart(6, '0');
  return {
    trId,
    symbol,
    period,
    startDate: params.FID_INPUT_DATE_1 ?? '',
    endDate: params.FID_INPUT_DATE_2 ?? '',
  };
}

function kisChartCooldownKey(ctx: { trId: string; symbol: string; period: string }): string {
  return `${ctx.trId}:${ctx.symbol}:${ctx.period}`;
}

function shouldEmitKisChartLog(kind: string, key: string): boolean {
  const throttleKey = `${kind}:${key}`;
  const now = Date.now();
  const last = _kisChartLogThrottle.get(throttleKey) ?? 0;
  if (now - last < KIS_CHART_LOG_THROTTLE_MS) return false;
  _kisChartLogThrottle.set(throttleKey, now);
  return true;
}

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

function isKisChart5xxCooldownActive(ctx: { trId: string; symbol: string; period: string }): boolean {
  const until = _realData5xxCooldownUntil.get(kisChartCooldownKey(ctx)) ?? 0;
  return Date.now() < until;
}

function recordRealData5xxCooldown(trId: string, apiPath: string, status: number): void {
  const cooldownMs = realData5xxCooldownMs(status);
  if (cooldownMs <= 0) return;
  _realData5xxCooldownUntil.set(realDataCooldownKey(trId, apiPath), Date.now() + cooldownMs);
}

function recordKisChart5xxCooldown(ctx: { trId: string; symbol: string; period: string }, status: number): void {
  if (status < 500 || status >= 600) return;
  _realData5xxCooldownUntil.set(kisChartCooldownKey(ctx), Date.now() + KIS_CHART_5XX_COOLDOWN_MS);
}

function clearRealData5xxCooldown(trId: string, apiPath: string): void {
  _realData5xxCooldownUntil.delete(realDataCooldownKey(trId, apiPath));
}

function clearKisChart5xxCooldown(ctx: { trId: string; symbol: string; period: string }): void {
  _realData5xxCooldownUntil.delete(kisChartCooldownKey(ctx));
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

  return scheduleKisCall(priority, `REAL_GET ${trId}`, async () => {
    const chartContext = getKisChartContext(trId, params);
    const chartCooldownKey = chartContext ? kisChartCooldownKey(chartContext) : null;
    if (_isCircuitOpen(trId)) {
      console.warn(`[KIS-RealData] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
      return null;
    }
    if (chartContext && isKisChart5xxCooldownActive(chartContext)) {
      if (shouldEmitKisChartLog('KIS_CHART_COOLDOWN_HIT', chartCooldownKey!)) {
        console.warn(
          `[KIS_CHART_COOLDOWN_HIT]\n`
          + `trId=${chartContext.trId}\n`
          + `symbol=${chartContext.symbol}\n`
          + `period=${chartContext.period}\n`
          + `newNetworkCall=false\n`
          + `executionImpact=NONE`,
        );
      }
      return null;
    }
    if (!chartContext && isRealData5xxCooldownActive(trId, apiPath)) {
      console.warn(`[KIS-RealData] 5xx micro-cooldown — ${trId} ${apiPath} 호출 건너뜀`);
      return null;
    }
    // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — per-key (endpoint + symbol +
    //   errorKind) cooldown 활성 시 호출 자체 skip. ENV disabled 시 무영향.
    //   FHKST03010100 은 symbol+period chart cooldown 으로 분리하여 다른 종목/주기 영향 0.
    //   호출자 측 inline ENV 검사 0건 — `isKisRealDataCooldownActive` SSOT 위임.
    if (!chartContext && isKisRealDataCooldownActive({ endpoint: apiPath })) {
      // 잡음 차단 — cooldown skip 은 별도 INFO 로그 0건 (suppressed count 만 누적).
      return null;
    }
    // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine.
    //   OPEN 상태 시 호출 차단 (잡음 0). HALF_OPEN 으로 자동 전이 후 1회 test 통과.
    //   호출자 측 inline ENV 검사 0건 — `shouldSkipProviderCall` SSOT 위임.
    evaluateCircuitTransition();
    if (shouldSkipProviderCall()) {
      return null;
    }

    const doFetch = async (token: string) => fetch(
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
        if (chartContext) {
          recordKisChart5xxCooldown(chartContext, res.status);
          if (shouldEmitKisChartLog('KIS_CHART_FETCH_FAILED', chartCooldownKey!)) {
            console.warn(
              `[KIS_CHART_FETCH_FAILED]\n`
              + `trId=${chartContext.trId}\n`
              + `symbol=${chartContext.symbol}\n`
              + `period=${chartContext.period}\n`
              + `startDate=${chartContext.startDate}\n`
              + `endDate=${chartContext.endDate}\n`
              + `status=${res.status}\n`
              + `providerIssue=true\n`
              + `marketSignal=false\n`
              + `executionImpact=NONE\n`
              + `cooldownMs=${KIS_CHART_5XX_COOLDOWN_MS}`,
            );
          }
        } else {
          recordRealData5xxCooldown(trId, apiPath, res.status);
        }
        // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — provider noise 분류 +
        //   per-key suppressed count. providerIssue=true / marketSignal=false /
        //   executionImpact='NONE' literal type 강제.
        const classified = classifyKisRealDataError({
          endpoint: chartContext ? chartContext.trId : apiPath,
          ...(chartContext ? { symbol: `${chartContext.symbol}:${chartContext.period}` } : {}),
          httpStatus: res.status,
        });
        const noise = recordKisRealDataFailure(classified);
        // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine update.
        //   5xx 누적 시 60s burst / 5min burst / consecutive 임계 평가 후 OPEN 자동 전이.
        recordProviderFailure(classified);
        if (chartContext) {
          return null;
        }
        if (retriesLeft > 0) {
          const delay = _kisBackoffDelayMs(retriesLeft);
          if (noise.shouldEmitDetailLog) {
            console.warn(
              `[KIS-RealData] ${res.status} (${trId}) 재시도 ${retriesLeft}회 남음, ${delay}ms 대기 — `
              + `providerIssue=true marketSignal=false executionImpact=NONE`,
            );
          } else {
            // 반복 5xx — 상세 로그 suppress + 60s 간격 INFO compact summary 노출.
            //   ENV disabled 시 shouldEmitNow=false (lastSummaryLoggedAt 갱신 안 함).
            const summary = shouldEmitNoiseSummary();
            if (summary.shouldEmitNow) {
              console.info(formatKisRealDataNoiseSummaryLine(noise.record));
            }
          }
          await _kisSleep(delay);
          retriesLeft -= 1;
          continue;
        }
      }

      if (!res.ok) {
        console.error(`[KIS-RealData] API 오류 ${res.status} (${trId})`);
        // 5xx(일시 장애) + 404/403(엔드포인트/권한 불일치 — 자연 복구 불가)은 회로 차단.
        // 400/429는 호출자 파라미터 조정·재시도로 해결 여지가 있어 카운팅에서 제외.
        if (
          (res.status >= 500 && res.status < 600)
          || res.status === 404
          || res.status === 403
        ) {
          _recordCircuitFailure(trId, res.status);
        }
        return null;
      }

      _recordCircuitSuccess(trId);
      if (chartContext) {
        clearKisChart5xxCooldown(chartContext);
      } else {
        clearRealData5xxCooldown(trId, apiPath);
      }
      // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — 성공 응답 시 backoff state reset
      //   (해당 endpoint 의 모든 errorKind record 삭제 — fast recovery).
      recordKisRealDataSuccess(chartContext
        ? { endpoint: chartContext.trId, symbol: `${chartContext.symbol}:${chartContext.period}` }
        : { endpoint: apiPath });
      // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker CLOSED 자동 전이.
      //   HALF_OPEN test 성공 시 CLOSED + consecutiveFailures=0 + sliding window 정리.
      recordProviderSuccess();
      const text = await res.text();
      if (!text.trim()) return null;
      try { return JSON.parse(text); } catch { return null; }
    }
  });
}
