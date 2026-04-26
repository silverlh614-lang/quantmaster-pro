// @responsibility dynamicStop 도메인 타입 정의
// ─── 변동성 적응형 동적 손절 (Volatility-Adaptive Dynamic Stop) ──────────────────

import type { RegimeLevel } from '../core';

/**
 * 시장 레짐 유형 (동적 손절 배수 결정용)
 * RISK_ON  — Risk-On 강세 레짐 (배수 2.0, 여유 있는 손절)
 * RISK_OFF — Risk-Off 조정 레짐 (배수 1.5, 타이트한 손절)
 * CRISIS   — 시스템 위기 레짐  (배수 1.0, 초타이트 손절)
 */
export type DynamicStopRegime = 'RISK_ON' | 'RISK_OFF' | 'CRISIS';

/** evaluateDynamicStop()에 주입하는 입력 데이터 */
export interface DynamicStopInput {
  entryPrice: number;
  /** 14봉 ATR (Average True Range) */
  atr14: number;
  /** 현재 시장 레짐 */
  regime: DynamicStopRegime;
  /** 현재 가격 (트레일링 스톱 계산용) */
  currentPrice: number;
}

/** evaluateDynamicStop() 반환 결과 */
export interface DynamicStopResult {
  /** Dynamic_Stop = Entry_Price − (ATR_14 × Regime_Multiplier) */
  stopPrice: number;
  /** 레짐 배수 (2.0 / 1.5 / 1.0) */
  multiplier: number;
  /** 입력 레짐 */
  regime: DynamicStopRegime;
  /** 손절가 비율 (진입가 대비 %, 음수) */
  stopPct: number;
  /** 트레일링 스톱 활성화 여부 (+5% 이상 수익 시) */
  trailingActive: boolean;
  trailingStopPrice: number;
  trailingStopPct: number;
  /** BEP 보호 활성화 (+5% → 손절을 진입가로 이동) */
  bepProtection: boolean;
  /** 수익 Lock-in 활성화 (+10% → +3%로 이동) */
  profitLockIn: boolean;
  currentReturnPct: number;
  actionMessage: string;
}

// ─── 매도 사이클 포트폴리오 컨텍스트 ──────────────────────────────────────────

import type { ActivePosition } from './position';

/** runSellCycle() 실행 시 필요한 포트폴리오 수준 상태 */
export interface SellCycleContext {
  positions: ActivePosition[];
  currentRegime: RegimeLevel;
  todayPnLRate: number;          // 당일 손익률 (e.g., -0.025 = -2.5%)
}
