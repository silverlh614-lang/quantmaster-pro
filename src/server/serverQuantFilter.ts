/**
 * serverQuantFilter.ts — 서버사이드 경량 Gate 평가
 *
 * 전체 27조건 중 Yahoo Finance 데이터만으로 평가 가능한 8개 조건을 서버에서 계산.
 * 나머지 19개는 UI에서 수동 입력 시 반영되는 구조 유지.
 */

import type { YahooQuoteExtended } from './autoTradeEngine.js';

export interface ServerGateResult {
  gateScore: number;                          // 0~8 (서버 평가 가능 조건만)
  signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  positionPct: number;                        // Kelly 기반 포지션 비율
  details: string[];                          // 통과한 조건 목록
}

/**
 * Yahoo Finance 확장 시세 데이터로 8개 Gate 조건 평가
 *
 * 조건 2:  모멘텀 (+2% 이상)
 * 조건 10: 정배열 (5일선 > 20일선 > 60일선)
 * 조건 11: 거래량 돌파 (5일 평균 2배 이상)
 * 조건 13: PER 밸류에이션 (< 20)
 * 조건 18: 터틀 돌파 (20일 신고가)
 * 조건 24: 상대강도 (코스피 대비 초과 수익 — 간이: +1.5% 초과)
 * 조건 25: VCP 변동성 축소 (ATR < 20일 ATR 평균의 70%)
 * 조건 27: 거래량 급증 + 상승 (거래량 3배 이상 & +1% 이상)
 */
export function evaluateServerGate(quote: YahooQuoteExtended): ServerGateResult {
  let score = 0;
  const details: string[] = [];

  // 조건 2: 모멘텀 (+2% 이상)
  if (quote.changePercent >= 2) {
    score++;
    details.push(`모멘텀 +${quote.changePercent.toFixed(1)}%`);
  }

  // 조건 10: 정배열 (5일선 > 20일선 > 60일선)
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    score++;
    details.push('정배열 (MA5>MA20>MA60)');
  }

  // 조건 11: 거래량 돌파 (5일 평균 2배 이상)
  if (quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 2) {
    score++;
    details.push(`거래량 ${(quote.volume / quote.avgVolume).toFixed(1)}배`);
  }

  // 조건 13: PER 밸류에이션 (0 < PER < 20)
  if (quote.per > 0 && quote.per < 20) {
    score++;
    details.push(`PER ${quote.per.toFixed(1)}`);
  }

  // 조건 18: 터틀 돌파 (20일 신고가)
  if (quote.high20d > 0 && quote.price >= quote.high20d) {
    score++;
    details.push('20일 신고가 돌파');
  }

  // 조건 24: 상대강도 (간이: 전일 대비 +1.5% 초과 상승)
  if (quote.changePercent > 1.5) {
    score++;
    details.push('상대강도 우위');
  }

  // 조건 25: VCP 변동성 축소 (ATR < 20일 ATR 평균의 70%)
  if (quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.7) {
    score++;
    details.push(`VCP (ATR ${((quote.atr / quote.atr20avg) * 100).toFixed(0)}%)`);
  }

  // 조건 27: 거래량 급증 + 상승 (거래량 3배 이상 & +1% 이상)
  if (quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 3 && quote.changePercent >= 1) {
    score++;
    details.push('거래량 급증+상승');
  }

  // 신호 분류 및 포지션 사이징
  const signalType = score >= 6 ? 'STRONG' as const
                   : score >= 4 ? 'NORMAL' as const
                   : 'SKIP' as const;

  const positionPct = score >= 6 ? 0.12
                    : score >= 4 ? 0.08
                    : 0.03;

  return { gateScore: score, signalType, positionPct, details };
}
