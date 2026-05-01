/**
 * @responsibility KIS REST 저수준 호출 — raw GET/POST + rate-limited 래퍼 + 실계좌 GET
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 HTTP 레이어 격리.
 * ADR-0014 retry safety (idempotency 'unsafe' 5xx 차단) + PR-21 회로차단 + PR-24 24h 블랙리스트.
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
    if (_isCircuitOpen(trId)) {
      console.warn(`[KIS-RealData] 회로 차단 상태 — ${trId} 호출 건너뜀 (cooldown 중)`);
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

    let token = await refreshRealDataToken();
    let res = await doFetch(token);

    // 401 감지 → 실계좌 데이터 토큰 강제 무효화 후 1회 재시도
    if (res.status === 401) {
      console.warn(`[KIS-RealData] 401 Unauthorized (${trId}) — 토큰 강제 갱신 후 재시도`);
      invalidateKisToken();
      token = await refreshRealDataToken();
      res = await doFetch(token);
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
    const text = await res.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text); } catch { return null; }
  });
}
