/**
 * dynamicStopEngine.ts — 변동성 적응형 동적 손절 알고리즘
 *
 * 핵심 개념: 고정 손절(-7%)을 ATR(Average True Range) 기반 변동성 적응형 손절로 대체.
 * 변동성이 낮은 종목은 손절을 타이트하게, 높은 종목은 여유 있게 설정하여
 * 일시적 노이즈에 의한 손절을 방지하고 실제 추세 반전에만 반응한다.
 *
 * Dynamic_Stop = Entry_Price − (ATR_14 × Regime_Multiplier)
 *   Risk-On  강세 레짐: Multiplier = 2.0 (여유 있는 손절)
 *   Risk-Off 조정 레짐: Multiplier = 1.5 (타이트한 손절)
 *   시스템 위기 레짐:   Multiplier = 1.0 (초타이트 손절)
 *
 * 이동 추적 손절(Trailing Stop) 자동 활성화:
 *   수익 +5% 초과 → 손절선을 진입가로 이동 (BEP 보호)
 *   수익 +10% 초과 → 손절선을 +3%로 이동 (수익 Lock-in)
 */

import type { DynamicStopInput, DynamicStopResult, DynamicStopRegime } from '../../types/sell';

// ─── 레짐별 ATR 배수 ──────────────────────────────────────────────────────────

const REGIME_MULTIPLIER: Record<DynamicStopRegime, number> = {
  RISK_ON:  2.0,  // Risk-On 강세 레짐 — 여유 있는 손절 (거짓 신호 방지)
  RISK_OFF: 1.5,  // Risk-Off 조정 레짐 — 타이트한 손절 (손실 최소화)
  CRISIS:   1.0,  // 시스템 위기 레짐 — 초타이트 손절 (즉각 반응)
};

// ─── 트레일링 스톱 임계값 ────────────────────────────────────────────────────

const BEP_TRIGGER   = 0.05;   // +5%: 손절을 진입가(BEP)로 이동
const LOCK_TRIGGER  = 0.10;   // +10%: 손절을 +3%로 이동
const LOCK_FLOOR    = 0.03;   // +3%: 수익 Lock-in 손절선

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * ATR 기반 동적 손절가 및 트레일링 스톱 계산.
 *
 * @param input - 진입가, ATR14, 레짐, 현재가
 * @returns 동적 손절 결과 (손절가, 트레일링 설정, 행동 권고)
 */
export function evaluateDynamicStop(input: DynamicStopInput): DynamicStopResult {
  const { entryPrice, atr14, regime, currentPrice } = input;

  const multiplier = REGIME_MULTIPLIER[regime];

  // Dynamic_Stop = Entry_Price − (ATR_14 × Multiplier)
  const rawStopPrice = entryPrice - atr14 * multiplier;
  const stopPrice = Math.max(1, Math.round(rawStopPrice));
  const stopPct = ((stopPrice - entryPrice) / entryPrice) * 100;

  // 현재 수익률
  const currentReturnPct = ((currentPrice - entryPrice) / entryPrice) * 100;

  // ── 트레일링 스톱 결정 ───────────────────────────────────────────────────────
  let trailingActive = false;
  let trailingStopPrice = stopPrice;
  let bepProtection = false;
  let profitLockIn = false;

  const currentReturn = currentReturnPct / 100;

  if (currentReturn >= LOCK_TRIGGER) {
    // +10% 이상: +3% 수익 Lock-in
    trailingActive = true;
    profitLockIn = true;
    bepProtection = true;
    trailingStopPrice = Math.round(entryPrice * (1 + LOCK_FLOOR));
  } else if (currentReturn >= BEP_TRIGGER) {
    // +5% 이상: 진입가(BEP)로 이동
    trailingActive = true;
    bepProtection = true;
    trailingStopPrice = Math.round(entryPrice);
  }

  const trailingStopPct = ((trailingStopPrice - entryPrice) / entryPrice) * 100;

  // ── 행동 권고 메시지 ────────────────────────────────────────────────────────
  let actionMessage: string;
  if (profitLockIn) {
    actionMessage = `수익 Lock-in 활성: 손절선 → +${(LOCK_FLOOR * 100).toFixed(0)}% (현재 +${currentReturnPct.toFixed(1)}% | 손절 ${trailingStopPct.toFixed(1)}%)`;
  } else if (bepProtection) {
    actionMessage = `BEP 보호 활성: 손절선 → 진입가 이동 (현재 +${currentReturnPct.toFixed(1)}% | 원금 보호)`;
  } else {
    const regimeLabel = regime === 'RISK_ON' ? 'Risk-On' : regime === 'RISK_OFF' ? 'Risk-Off' : '위기';
    actionMessage = `동적 손절 (${regimeLabel} ×${multiplier}): ATR ${atr14.toLocaleString()}원 → 손절 ${stopPct.toFixed(1)}%`;
  }

  return {
    stopPrice,
    multiplier,
    regime,
    stopPct: parseFloat(stopPct.toFixed(2)),
    trailingActive,
    trailingStopPrice,
    trailingStopPct: parseFloat(trailingStopPct.toFixed(2)),
    bepProtection,
    profitLockIn,
    currentReturnPct: parseFloat(currentReturnPct.toFixed(2)),
    actionMessage,
  };
}
