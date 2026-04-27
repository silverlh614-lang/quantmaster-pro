// @responsibility kisProxy 서비스 모듈
/**
 * kisProxy.ts — KIS API 공통 클라이언트 헬퍼
 *
 * orderExecution.ts / timeFilter.ts / trancheEngine.ts 등이
 * 공유하는 KIS 프록시 호출, 계좌 유형 판별 유틸리티를 제공합니다.
 */

export interface KISProxyRequest {
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, string>;
  params?: Record<string, string>;
}

export async function kisProxy(req: KISProxyRequest): Promise<Record<string, unknown>> {
  const res = await fetch('/api/kis/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`KIS 프록시 오류: ${res.status}`);
  return res.json();
}

// 모의(VTS) vs 실계좌 TR ID 선택
export const isReal = () => import.meta.env.VITE_KIS_IS_REAL === 'true';
export const BUY_TR  = () => (isReal() ? 'TTTC0802U' : 'VTTC0802U');
export const SELL_TR = () => (isReal() ? 'TTTC0801U' : 'VTTC0801U');

/**
 * 서버 자동매매가 활성화되어 있으면 true.
 * true일 때 클라이언트 실주문은 중복 방지를 위해 차단됩니다.
 */
export function isServerAutoTradeActive(): boolean {
  return import.meta.env.VITE_AUTO_TRADE_ENABLED === 'true';
}
