// @responsibility Cascade -30% 진입 금지 종목 차단 진입 게이트
/**
 * entryGates/blacklistGate.ts — 블랙리스트 진입 차단 (ADR-0030).
 *
 * Cascade -30% 손실로 청산된 종목은 180일 블랙리스트에 등재된다.
 * 본 게이트는 blacklistRepo 의 인메모리 set 조회로 차단.
 */

import { isBlacklisted } from '../../../persistence/blacklistRepo.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const blacklistGate: EntryGate = (ctx) => {
  const { stock } = ctx;
  if (isBlacklisted(stock.code)) {
    return {
      pass: false,
      logMessage: `[AutoTrade] 🚫 ${stock.name}(${stock.code}) 블랙리스트 — 진입 차단`,
    };
  }
  return { pass: true } as EntryGateResult;
};
