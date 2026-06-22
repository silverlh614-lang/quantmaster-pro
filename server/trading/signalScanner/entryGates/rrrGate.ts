// @responsibility RRR Risk-Reward Ratio 최소 임계값 미달 진입 게이트
/**
 * entryGates/rrrGate.ts — RRR 미달 진입 차단 (ADR-0030).
 *
 * (target - entry) / (entry - stopLoss) 가 RRR_MIN_THRESHOLD (entryEngine SSOT)
 * 미만이면 진입 보류. scanCounters.rrrMisses 증가 + stageLog.rrr 기록 + pushTrace.
 *
 * ADR-0648 — 눌림목 레인(entryLane==='PULLBACK') 후보는 effectiveMinRrr =
 * max(RRR_MIN_THRESHOLD, 2.0) 로 하한 강화(두 번째 RRR 공식 신설 0 — calcRRR 재사용).
 * entryLane 미태깅(기본/flag OFF) 후보는 기존 RRR_MIN_THRESHOLD 그대로(byte-identical).
 */

import { RRR_MIN_THRESHOLD, calcRRR } from '../../riskManager.js';
import type { EntryGate, EntryGateResult } from './types.js';

/** ADR-0648 — 눌림목 레인 후보의 강화 RRR 하한(손절 거리가 짧아 RRR 확보 용이 → RRR-우선). */
const PULLBACK_LANE_MIN_RRR = 2.0;

export const rrrGate: EntryGate = (ctx) => {
  const { stock } = ctx;
  const rrr = calcRRR(stock.entryPrice, stock.targetPrice, stock.stopLoss);
  // ADR-0648 — 눌림목 레인 후보만 하한 강화. 기본 후보는 RRR_MIN_THRESHOLD(byte-identical).
  const effectiveMinRrr = stock.entryLane === 'PULLBACK'
    ? Math.max(RRR_MIN_THRESHOLD, PULLBACK_LANE_MIN_RRR)
    : RRR_MIN_THRESHOLD;
  if (rrr < effectiveMinRrr) {
    return {
      pass: false,
      logMessage:
        `[AutoTrade] 📐 ${stock.name}(${stock.code}) RRR ${rrr.toFixed(2)} < ${effectiveMinRrr} — 진입 제외`,
      counter: 'rrrMisses',
      stageLog: { key: 'rrr', value: `FAIL(${rrr.toFixed(2)} < ${effectiveMinRrr})` },
      pushTrace: true,
    };
  }
  return { pass: true } as EntryGateResult;
};
