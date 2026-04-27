// @responsibility RRR Risk-Reward Ratio 최소 임계값 미달 진입 게이트
/**
 * entryGates/rrrGate.ts — RRR 미달 진입 차단 (ADR-0030).
 *
 * (target - entry) / (entry - stopLoss) 가 RRR_MIN_THRESHOLD (entryEngine SSOT)
 * 미만이면 진입 보류. scanCounters.rrrMisses 증가 + stageLog.rrr 기록 + pushTrace.
 */

import { RRR_MIN_THRESHOLD, calcRRR } from '../../riskManager.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const rrrGate: EntryGate = (ctx) => {
  const { stock } = ctx;
  const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
  if (rrr < RRR_MIN_THRESHOLD) {
    return {
      pass: false,
      logMessage:
        `[AutoTrade] 📐 ${stock.name}(${stock.code}) RRR ${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 진입 제외`,
      counter: 'rrrMisses',
      stageLog: { key: 'rrr', value: `FAIL(${rrr.toFixed(2)} < ${RRR_MIN_THRESHOLD})` },
      pushTrace: true,
    };
  }
  return { pass: true } as EntryGateResult;
};
