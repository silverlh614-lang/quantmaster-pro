// @responsibility Regret Asymmetry Filter 쿨다운 종목 진입 보류 또는 해제 게이트
/**
 * entryGates/cooldownGate.ts — 쿨다운 종목 진입 보류·해제 (ADR-0030, PR-58).
 *
 * 손절 직후 추격 매수를 막는 Regret Asymmetry Filter 의 last-mile 가드.
 * 3 분기 동작:
 *   1) cooldownUntil 미설정 → no-op pass
 *   2) cooldownUntil 설정 + checkCooldownRelease=true →
 *      stock.cooldownUntil/recentHigh undefined + watchlistMutated.value=true
 *      + console.log("쿨다운 해제") 후 pass
 *   3) cooldownUntil 설정 + 미해제 → console.log("쿨다운 유지") 후 차단
 *
 * 주의: 본 게이트는 mutate-and-pass 패턴을 사용한다 (분기 2 가 stock 과 mutables
 * 직접 변경). 다른 게이트는 mutate 안 함이 원칙이지만, 원본 perSymbolEvaluation.ts
 * 동작과 byte-equivalent 보존을 위해 예외 허용.
 */

import { checkCooldownRelease } from '../../regretAsymmetryFilter.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const cooldownGate: EntryGate = (ctx) => {
  const { stock, currentPrice, mutables } = ctx;
  if (!stock.cooldownUntil) return { pass: true } as EntryGateResult;

  const released = checkCooldownRelease(
    stock.cooldownUntil,
    stock.recentHigh ?? stock.entryPrice,
    currentPrice,
  );
  if (released) {
    // 쿨다운 해제 — 플래그 제거 후 진입 허용
    stock.cooldownUntil = undefined;
    stock.recentHigh    = undefined;
    mutables.watchlistMutated.value = true;
    return {
      pass: true,
      passLogMessage: `[Regret Asymmetry] ${stock.name}(${stock.code}) 쿨다운 해제 — 진입 재허용`,
    };
  }
  return {
    pass: false,
    logMessage:
      `[Regret Asymmetry] ${stock.name}(${stock.code}) 쿨다운 유지` +
      ` (until ${stock.cooldownUntil}, high ${(stock.recentHigh ?? 0).toLocaleString()}원)`,
  };
};
