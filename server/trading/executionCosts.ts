// @responsibility executionCosts 매매 엔진 모듈
/**
 * executionCosts.ts — 한국 증시 실제 거래 비용 통합 회계 계층 (Phase 2-⑥).
 *
 * 배경:
 *   signalScanner 4곳에 `slippage=0.003` 하드코딩만 존재하고, shadow P&L 집계
 *   지점마다 수수료·세금을 제각각 무시/가정하여 왕복 0.4~0.5% 비용을 놓치고
 *   있었다. 자기학습 가중치가 이 편향된 RRR 위에서 조정되면 누적 드리프트가
 *   발생한다.
 *
 * 한국 증시 비용 구조 (2026 기준, 대표 증권사):
 *   매수 위탁수수료: 0.015%
 *   매도 위탁수수료: 0.015%
 *   증권거래세:      KOSPI 0.18% / KOSDAQ 0.20% (매도 시에만)
 *   농어촌특별세:    KOSPI 0.15% / KOSDAQ 0.00% (매도 시에만)
 *   슬리피지:        양방향 각 0.30% (기존 signalScanner 하드코딩과 정합 유지)
 *
 * 왕복 순수 비용 (세금+수수료만):
 *   KOSPI  ≈ 0.015 + 0.015 + 0.18 + 0.15 = 0.36%
 *   KOSDAQ ≈ 0.015 + 0.015 + 0.20        = 0.23%
 * 왕복 비용 (슬리피지 0.30% × 2 포함):
 *   KOSPI  ≈ 0.96%
 *   KOSDAQ ≈ 0.83%
 *
 * 모든 P&L 집계 지점(shadowRealDriftDetector, recommendationTracker,
 * backtestEngine)은 computeNetPnL() 하나로 통일하여 편향을 제거한다.
 */

export type Market = 'KOSPI' | 'KOSDAQ';

export interface ExecutionCostConfig {
  /** 매수 위탁수수료율 (0.00015 = 0.015%) */
  buyCommissionRate:  number;
  /** 매도 위탁수수료율 */
  sellCommissionRate: number;
  /** 증권거래세율 (매도 시에만) — 시장별 */
  transferTaxRate:    Record<Market, number>;
  /** 농어촌특별세율 (매도 시에만) — KOSPI 만 부과 */
  ruralTaxRate:       Record<Market, number>;
  /** 슬리피지율 (한 방향 — 왕복 시 ×2) */
  slippageRate:       number;
}

const DEFAULT_COST: ExecutionCostConfig = {
  buyCommissionRate:  0.00015,
  sellCommissionRate: 0.00015,
  transferTaxRate:    { KOSPI: 0.0018, KOSDAQ: 0.0020 },
  ruralTaxRate:       { KOSPI: 0.0015, KOSDAQ: 0 },
  slippageRate:       0.003,
};

let _override: Partial<ExecutionCostConfig> = {};

/**
 * 테스트·튜닝용. UI(useMarketStore.commissionFee) 에서 서버로 전달되는 값이
 * 있다면 이 함수를 통해 주입한다.
 */
export function setExecutionCostOverride(over: Partial<ExecutionCostConfig>): void {
  _override = { ...over };
}

export function resetExecutionCostOverride(): void {
  _override = {};
}

export function getExecutionCostConfig(): ExecutionCostConfig {
  return {
    ...DEFAULT_COST,
    ..._override,
    transferTaxRate: { ...DEFAULT_COST.transferTaxRate, ...(_override.transferTaxRate ?? {}) },
    ruralTaxRate:    { ...DEFAULT_COST.ruralTaxRate,    ...(_override.ruralTaxRate    ?? {}) },
  };
}

export interface ComputeNetPnLInput {
  entryPrice: number;
  exitPrice:  number;
  quantity:   number;
  /** 기본 'KOSPI' — KOSPI 가 총비용이 더 높아 보수적. 가능하면 명시적으로 전달. */
  market?:    Market;
  /** 슬리피지 반영 여부 (이미 slippage-adjusted price 라면 false). 기본 true. */
  includeSlippage?: boolean;
}

export interface NetPnLBreakdown {
  /** 슬리피지·세금 전 순이익 (exit − entry) × qty */
  gross:        number;
  buyFee:       number;
  sellFee:      number;
  transferTax:  number;
  ruralTax:     number;
  slippageIn:   number;
  slippageOut:  number;
  /** 수수료+세금+슬리피지 합산 */
  totalCost:    number;
  /** gross − totalCost */
  net:          number;
  /** net / (entryPrice × qty) × 100 — %p 단위 */
  netPct:       number;
}

/**
 * 거래 1회의 순손익 분해.
 *
 * @example
 *   const r = computeNetPnL({ entryPrice: 50000, exitPrice: 51000, quantity: 10, market: 'KOSPI' });
 *   r.netPct  // ≈ +1.04% (gross +2% − 왕복비용 ~0.96%)
 */
export function computeNetPnL(input: ComputeNetPnLInput): NetPnLBreakdown {
  const cfg = getExecutionCostConfig();
  const market = input.market ?? 'KOSPI';
  const includeSlippage = input.includeSlippage ?? true;
  const qty = Math.max(0, input.quantity);
  const entryValue = input.entryPrice * qty;
  const exitValue  = input.exitPrice  * qty;

  const gross = exitValue - entryValue;
  const buyFee      = entryValue * cfg.buyCommissionRate;
  const sellFee     = exitValue  * cfg.sellCommissionRate;
  const transferTax = exitValue  * cfg.transferTaxRate[market];
  const ruralTax    = exitValue  * cfg.ruralTaxRate[market];
  const slippageIn  = includeSlippage ? entryValue * cfg.slippageRate : 0;
  const slippageOut = includeSlippage ? exitValue  * cfg.slippageRate : 0;

  const totalCost = buyFee + sellFee + transferTax + ruralTax + slippageIn + slippageOut;
  const net = gross - totalCost;
  const netPct = entryValue > 0 ? (net / entryValue) * 100 : 0;

  return { gross, buyFee, sellFee, transferTax, ruralTax, slippageIn, slippageOut, totalCost, net, netPct };
}

/**
 * 왕복 비용율(%) — 레짐별 진입 임계값 튜닝·보고서 산출용.
 * slippage 포함 여부 토글 가능.
 */
export function computeRoundTripCostPct(
  market: Market = 'KOSPI',
  includeSlippage = true,
): number {
  const cfg = getExecutionCostConfig();
  const slip = includeSlippage ? cfg.slippageRate * 2 : 0;
  return (
    cfg.buyCommissionRate +
    cfg.sellCommissionRate +
    cfg.transferTaxRate[market] +
    cfg.ruralTaxRate[market] +
    slip
  ) * 100;
}

/**
 * Yahoo 심볼 접미사(.KS/.KQ) 로 시장 추정. 서버 중에서도 워치리스트/재평가
 * 경로가 보유한 심볼을 활용할 때 사용한다.
 */
export function inferMarketFromSymbol(symbol: string | undefined | null): Market {
  if (!symbol) return 'KOSPI';
  return symbol.trim().toUpperCase().endsWith('.KQ') ? 'KOSDAQ' : 'KOSPI';
}

/**
 * 주어진 returnPct(gross)에서 왕복 비용을 차감한 net returnPct 를 즉시 반환.
 * fills 가 없어 entry/exit 단가를 복원할 수 없는 레거시 집계 경로용 빠른 보정.
 */
export function applyRoundTripCostToPct(
  grossReturnPct: number,
  market: Market = 'KOSPI',
  includeSlippage = true,
): number {
  return grossReturnPct - computeRoundTripCostPct(market, includeSlippage);
}
