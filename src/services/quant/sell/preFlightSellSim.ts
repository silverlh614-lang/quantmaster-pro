// @responsibility quant preFlightSellSim 엔진 모듈
/**
 * sell/preFlightSellSim.ts — Pre-Flight Sell Simulation
 *
 * 매수 체결 직전에 5가지 매도 시나리오를 자동 시뮬레이션.
 * 매수 시점에 Pre-Mortem을 상상적으로 체험시키는 행동경제학적 장치.
 *
 * 시나리오 정의는 preFlightScenarios.ts에 분리.
 */

import type {
  SellSignal,
  SellContext,
} from '../../../types/sell';
import { evaluateSellSignalsFromContext } from './orchestrator';
import {
  PRE_FLIGHT_SCENARIOS,
  type PreFlightScenarioId,
  type PreFlightScenario,
} from './preFlightScenarios';

export type { PreFlightScenarioId, PreFlightScenario };

// ─── 결과 ────────────────────────────────────────────────────────────────────

export interface PreFlightScenarioResult {
  scenarioId: PreFlightScenarioId;
  description: string;
  triggeredSignals: readonly SellSignal[];
  /** 가장 강한 신호 (있으면) */
  dominantSignal: SellSignal | null;
  /** 시나리오의 currentPrice 기준 예상 손실률 (entryPrice 대비) */
  expectedReturn: number;
  /** 예상 매도 실행 순서 (action 나열) */
  expectedLayerOrder: readonly string[];
  /** 매도 미발동 시 true */
  noExit: boolean;
}

export interface PreFlightReport {
  stockCode: string;
  scenarios: readonly PreFlightScenarioResult[];
  /** 전체 시나리오 중 가장 심각한 예상 손실률 (음수) */
  worstExpectedReturn: number;
  warningLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ─── 메인 함수 ───────────────────────────────────────────────────────────────

export function runPreFlightSellSim(baseCtx: SellContext): PreFlightReport {
  const results: PreFlightScenarioResult[] = PRE_FLIGHT_SCENARIOS.map(scenario => {
    const mutated = scenario.transform(baseCtx);
    const signals = evaluateSellSignalsFromContext(mutated);
    const expectedReturn =
      (mutated.position.currentPrice - baseCtx.position.entryPrice) / baseCtx.position.entryPrice;

    return {
      scenarioId: scenario.id,
      description: scenario.description,
      triggeredSignals: signals,
      dominantSignal: pickDominantSignal(signals),
      expectedReturn,
      expectedLayerOrder: signals.map(s => s.action),
      noExit: signals.length === 0,
    };
  });

  const worstExpectedReturn = results.reduce((min, r) => Math.min(min, r.expectedReturn), 0);

  return {
    stockCode: baseCtx.position.stockCode,
    scenarios: results,
    worstExpectedReturn,
    warningLevel: categorizeWarning(worstExpectedReturn, results),
  };
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function pickDominantSignal(signals: readonly SellSignal[]): SellSignal | null {
  if (signals.length === 0) return null;
  const rank = (s: SellSignal): number => {
    const severityRank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[s.severity ?? 'LOW'];
    return severityRank * 10 + s.ratio;
  };
  return [...signals].sort((a, b) => rank(b) - rank(a))[0];
}

function categorizeWarning(
  worstReturn: number,
  results: readonly PreFlightScenarioResult[],
): PreFlightReport['warningLevel'] {
  const hasFullExit = results.some(r =>
    r.triggeredSignals.some(s => s.ratio === 1.0 && s.action !== 'REVALIDATE_GATE1'),
  );
  if (hasFullExit || worstReturn <= -0.20) return 'CRITICAL';

  const exitCount = results.filter(r => !r.noExit && r.triggeredSignals.some(s => s.ratio > 0)).length;
  if (exitCount >= 3) return 'HIGH';
  if (exitCount >= 1) return 'MEDIUM';
  return 'LOW';
}
