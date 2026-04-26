// @responsibility riskManager 매매 엔진 모듈
import { type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

export const RRR_MIN_THRESHOLD       = Number(process.env.RRR_MIN_THRESHOLD || 1.8);
export const MAX_SECTOR_CONCENTRATION = Number(process.env.MAX_SECTOR_CONCENTRATION || 2);

export function calcRRR(entryPrice: number, targetPrice: number, stopLoss: number): number {
  const reward = targetPrice - entryPrice;
  const risk   = entryPrice - stopLoss;
  if (risk <= 0) return 0;
  return reward / risk;
}

export interface EuphoriaResult {
  triggered: boolean;
  count: number;
  signals: string[];
}

export function checkEuphoria(shadow: ServerShadowTrade, currentPrice: number): EuphoriaResult {
  const signals: string[] = [];

  // 신호 1: 목표가 근접 (현재가 ≥ 목표가의 95%)
  if (shadow.targetPrice > 0 && currentPrice >= shadow.targetPrice * 0.95) {
    signals.push(`목표가 근접 (${((currentPrice / shadow.targetPrice) * 100).toFixed(1)}%)`);
  }

  // 신호 2: 수익률 ≥ 30% (RSI 80 대용)
  const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
  if (returnPct >= 30) {
    signals.push(`수익률 ${returnPct.toFixed(1)}% (≥30%)`);
  }

  // 신호 3: 7일 급등 ≥ 20%
  if (shadow.price7dAgo && shadow.price7dAgo > 0) {
    const spike7d = ((currentPrice - shadow.price7dAgo) / shadow.price7dAgo) * 100;
    if (spike7d >= 20) {
      signals.push(`7일 급등 +${spike7d.toFixed(1)}%`);
    }
  }

  // 신호 4: 30일 보유 + 수익률 ≥ 40%
  const holdDays = (Date.now() - new Date(shadow.signalTime).getTime()) / (1000 * 60 * 60 * 24);
  if (holdDays >= 30 && returnPct >= 40) {
    signals.push(`30일 보유 + 수익률 ${returnPct.toFixed(1)}%`);
  }

  // 신호 5: 목표가 5% 이상 초과
  if (shadow.targetPrice > 0 && currentPrice > shadow.targetPrice * 1.05) {
    signals.push(`목표가 초과 +${(((currentPrice / shadow.targetPrice) - 1) * 100).toFixed(1)}%`);
  }

  return {
    triggered: signals.length >= 2,
    count: signals.length,
    signals,
  };
}
