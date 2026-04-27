// @responsibility Cascade -7% 손실 후 추가매수 차단 플래그 검사 진입 게이트
/**
 * entryGates/addBuyBlockGate.ts — 추가 매수 차단 플래그 진입 차단 (ADR-0030).
 *
 * Cascade -7% 손실에 진입한 종목은 `shadow.addBuyBlocked=true` 가 설정된다.
 * 본 게이트는 같은 종목의 ACTIVE shadow 중 해당 플래그가 켜진 것을 찾으면 차단.
 */

import type { EntryGate, EntryGateResult } from './types.js';

export const addBuyBlockGate: EntryGate = (ctx) => {
  const { stock, shadows } = ctx;
  const blockedShadow = shadows.find(
    s => s.stockCode === stock.code && s.addBuyBlocked === true
  );
  if (blockedShadow) {
    return {
      pass: false,
      logMessage: `[AutoTrade] ⚠️  ${stock.name}(${stock.code}) 추가 매수 차단 중 (Cascade -7%)`,
    };
  }
  return { pass: true } as EntryGateResult;
};
