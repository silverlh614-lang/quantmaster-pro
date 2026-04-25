/**
 * @responsibility PR-42 M2 — /api/kis/proxy 화이트리스트 + 주문 TR 차단 정책 (kisClient 단일 통로 강화)
 */

// PR-42 M2 — kisRouter `/proxy` 경유 호출의 화이트리스트·블랙리스트.
// 자동매매 단일 통로(절대 규칙 #4) 보호 + kisClient 회로차단기·24h 블랙리스트
// 우회 차단(절대 규칙 #2 강화). 클라이언트가 임의 path/headers/body 로
// 주문/취소를 우회 호출하지 못하도록 두 겹 차단:
//
//   1) 경로 화이트리스트 — 가격/잔고 read-only TR 만 허용
//   2) 주문/취소 TR ID 블랙리스트 — 화이트리스트 누락에 대한 안전망

export type ProxyMethod = 'GET' | 'POST';

export interface ProxyPolicyDecision {
  readonly action: 'allow' | 'reject';
  readonly httpStatus?: number;
  readonly reason?: string;
}

/** 가격/잔고 조회 read-only 경로만 허용. */
export const ALLOWED_PROXY_PATHS: ReadonlySet<string> = new Set([
  '/uapi/domestic-stock/v1/quotations/inquire-price',
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
  '/uapi/domestic-stock/v1/quotations/inquire-time-itemconclusion',
  '/uapi/domestic-stock/v1/trading/inquire-balance',
  '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
  '/uapi/domestic-stock/v1/trading/inquire-psbl-order',
]);

/** 주문/취소/정정 경로 — 화이트리스트 통과해도 본 경로는 거부. */
export const FORBIDDEN_PROXY_PATHS: ReadonlySet<string> = new Set([
  '/uapi/domestic-stock/v1/trading/order-cash',
  '/uapi/domestic-stock/v1/trading/order-credit',
  '/uapi/domestic-stock/v1/trading/order-rvsecncl',
]);

/**
 * 주문/취소 TR ID — 자동매매 단일 통로(autoTradeEngine) 만 발급해야 한다.
 * 클라이언트 위에서 위 TR 을 명시적으로 지정해 호출하는 경우 차단.
 */
export const FORBIDDEN_TR_IDS: ReadonlySet<string> = new Set([
  // 매수 (실/모의)
  'TTTC0802U', 'VTTC0802U',
  // 매도 (실/모의)
  'TTTC0801U', 'VTTC0801U',
  // 정정/취소 (실/모의)
  'TTTC0803U', 'VTTC0803U',
]);

/**
 * /api/kis/proxy 요청 정책 평가 — 라우터 핸들러 진입 직후 호출.
 * Body 의 method/path/headers.tr_id 만 검증한다. 회로차단기/블랙리스트는
 * kisGet/kisPost 가 자동 적용한다.
 */
export function evaluateProxyPolicy(input: {
  method: unknown;
  path: unknown;
  trId: unknown;
}): ProxyPolicyDecision {
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
  if (method !== 'GET' && method !== 'POST') {
    return { action: 'reject', httpStatus: 405, reason: `Method '${method}' 미지원 — GET/POST 만 허용` };
  }

  if (typeof input.path !== 'string' || !input.path.startsWith('/uapi/')) {
    return { action: 'reject', httpStatus: 400, reason: 'path 누락 또는 잘못된 형식' };
  }
  const path = input.path;

  if (FORBIDDEN_PROXY_PATHS.has(path)) {
    return {
      action: 'reject',
      httpStatus: 403,
      reason: `경로 '${path}' 는 자동매매 전용 — autoTradeEngine 단일 통로 사용 (절대 규칙 #4)`,
    };
  }

  if (!ALLOWED_PROXY_PATHS.has(path)) {
    return {
      action: 'reject',
      httpStatus: 403,
      reason: `경로 '${path}' 는 화이트리스트 미등록 — kisRouter 직접 라우트 사용 권장`,
    };
  }

  const trId = typeof input.trId === 'string' ? input.trId : '';
  if (!trId) {
    return { action: 'reject', httpStatus: 400, reason: 'tr_id 헤더 누락' };
  }
  if (FORBIDDEN_TR_IDS.has(trId)) {
    return {
      action: 'reject',
      httpStatus: 403,
      reason: `TR '${trId}' 는 주문/취소 — autoTradeEngine 단일 통로만 호출 가능`,
    };
  }

  return { action: 'allow' };
}
