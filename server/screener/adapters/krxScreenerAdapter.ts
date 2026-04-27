// @responsibility KRX 투자자별 매매 폴백 스크리너 어댑터 외국인 순매수 80개
/**
 * adapters/krxScreenerAdapter.ts — KRX 정보데이터시스템 OpenAPI 폴백 (ADR-0029).
 *
 * KIS 4-TR preScreenStocks 가 0건일 때 자동 폴백. 투자자별 거래실적 +
 * PER/PBR 테이블 두 소스를 결합해 외국인 순매수 양수 종목 80개 반환.
 * 두 소스 모두 실패 시 빈 배열 — 호출자는 기존 캐시로 자연 폴백.
 */

import { fetchInvestorTrading as krxFetchInvestorTrading, fetchPerPbr as krxFetchPerPbr } from '../../clients/krxClient.js';
import type { ScreenedStock } from '../stockScreener.js';

/**
 * KRX 정보데이터시스템(공식 OpenAPI) 기반 폴백 스크리너.
 * - 투자자별 거래실적: 외국인 순매수 양수 종목만 선택
 * - PER/PBR 테이블: 현재가·PER 보강 (데이터가 있는 종목만)
 * - 두 소스 모두 실패하면 빈 배열 — 호출자는 기존 캐시로 자연 폴백
 * KIS와 스키마 동일하므로 ScreenedStock 형태로 변환 후 최대 80개 반환.
 */
export async function fetchKrxScreenerFallback(): Promise<ScreenedStock[]> {
  try {
    const [investors, perPbr] = await Promise.all([
      krxFetchInvestorTrading().catch(() => []),
      krxFetchPerPbr().catch(() => []),
    ]);
    if (investors.length === 0) return [];

    const perMap = new Map(perPbr.map(r => [r.code, r]));
    const now = new Date().toISOString();
    const rows: ScreenedStock[] = [];
    for (const iv of investors) {
      if (iv.foreignNetBuy <= 0) continue; // 외국인 순매수 양수만
      const pp = perMap.get(iv.code);
      const price = pp?.close ?? 0;
      if (price <= 0) continue;            // 종가 없는 로우 제외
      rows.push({
        code: iv.code,
        name: iv.name,
        currentPrice: price,
        // KRX 리포트엔 당일 등락률 없음 — 0으로 초기화. 후단 Yahoo 보강이 덮어씀.
        changeRate: 0,
        volume: 0,
        turnoverRate: 0,
        per: pp?.per ?? 999,
        foreignNetBuy: iv.foreignNetBuy,
        screenedAt: now,
      });
    }
    // 외국인 순매수 규모 상위 80개.
    rows.sort((a, b) => b.foreignNetBuy - a.foreignNetBuy);
    return rows.slice(0, 80);
  } catch (e) {
    console.warn('[Screener/KRX] 폴백 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}
