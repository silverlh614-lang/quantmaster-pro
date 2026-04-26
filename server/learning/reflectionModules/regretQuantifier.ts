// @responsibility regretQuantifier 학습 엔진 모듈
/**
 * regretQuantifier.ts — Regret Quantifier (#8).
 *
 * 오늘 HIT_STOP 거래 중 "만약 손절 즉시 집행이 아니라 5/30/60분 후였다면
 * 추가로 얼마의 손실이 발생했을 것인가" 를 계산.
 *
 * 기계적 손절의 가치를 매일 재확인 → 심리적 수치화로 "손절 지연 충동" 기각 유도.
 *
 * 데이터 소스:
 *   - 실제 정밀 값: priceAtDelay(trade, delayMin) 주입 시 실측 사용.
 *   - Proxy 값: 미주입 시 현실적 보수 추정 — 손절 트리거 시점의 slippage 를
 *                시간 비례 연장. (Phase 5 에서 KIS intraday 1m OHLC 로 교체 예정)
 *
 * 산출: RegretQuantifierResult
 *   - immediateStopLossKrw: 실제 집행된 손실 (참조 기준)
 *   - delay5/30/60minLossKrw: 가상 지연 시 누적 손실
 *   - mechanicalValueKrw: 즉시 집행 대비 최대 지연(60min) 시 "방지된 손실"
 */

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { RegretQuantifierResult } from '../reflectionTypes.js';

export interface RegretInputs {
  stopLossTrades: ServerShadowTrade[];
  /**
   * 선택: 실측 지연 가격. delayMin ∈ {5, 30, 60}.
   * null 반환 시 proxy 공식 사용.
   */
  priceAtDelay?: (trade: ServerShadowTrade, delayMin: 5 | 30 | 60) => Promise<number | null>;
}

/** Proxy: 손절 시점 slippage 를 시간 비례 연장. 보수적 (과소 추정 방지). */
function proxyDelayPrice(trade: ServerShadowTrade, delayMin: 5 | 30 | 60): number | null {
  if (trade.exitPrice == null || trade.stopLoss == null) return null;
  const baseSlip = trade.stopLoss - trade.exitPrice; // >0 = exit 이 stopLoss 아래
  // baseSlip 이 음수(익절 수준)이면 Regret 계산 의미 없음 → null.
  if (baseSlip <= 0) return null;
  // 시간 스케일: 5분 → 1.0x, 30분 → 2.0x, 60min → 3.0x (선형 확장, 보수적 상한)
  const scale = delayMin === 5 ? 1.0 : delayMin === 30 ? 2.0 : 3.0;
  return trade.exitPrice - baseSlip * (scale - 1.0); // slip 추가 확대
}

/**
 * 단일 거래의 즉시 집행 원금 손실 (음수 returnPct 반영).
 * 수량 × (entryPrice - exitPrice). exitPrice 누락 시 0.
 */
function immediateLossKrw(trade: ServerShadowTrade): number {
  if (trade.exitPrice == null || trade.quantity == null) return 0;
  const loss = (trade.shadowEntryPrice - trade.exitPrice) * trade.quantity;
  return Math.max(0, loss);
}

async function delayedLossKrwFor(
  trade: ServerShadowTrade,
  delayMin: 5 | 30 | 60,
  priceAtDelay?: RegretInputs['priceAtDelay'],
): Promise<number> {
  let priceAtT: number | null = null;
  if (priceAtDelay) {
    try {
      priceAtT = await priceAtDelay(trade, delayMin);
    } catch {
      priceAtT = null;
    }
  }
  if (priceAtT == null) priceAtT = proxyDelayPrice(trade, delayMin);
  if (priceAtT == null || trade.quantity == null) return 0;
  const loss = (trade.shadowEntryPrice - priceAtT) * trade.quantity;
  return Math.max(0, loss);
}

export async function quantifyRegret(inputs: RegretInputs): Promise<RegretQuantifierResult> {
  let immediate = 0;
  let d5 = 0, d30 = 0, d60 = 0;

  for (const t of inputs.stopLossTrades) {
    if (t.status !== 'HIT_STOP') continue;
    immediate += immediateLossKrw(t);
    d5  += await delayedLossKrwFor(t, 5,  inputs.priceAtDelay);
    d30 += await delayedLossKrwFor(t, 30, inputs.priceAtDelay);
    d60 += await delayedLossKrwFor(t, 60, inputs.priceAtDelay);
  }

  const mechanicalValueKrw = Math.max(0, d60 - immediate);

  return {
    immediateStopLossKrw: Math.round(immediate),
    delay5minLossKrw:     Math.round(d5),
    delay30minLossKrw:    Math.round(d30),
    delay60minLossKrw:    Math.round(d60),
    mechanicalValueKrw:   Math.round(mechanicalValueKrw),
  };
}
