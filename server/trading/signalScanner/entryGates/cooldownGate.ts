// @responsibility Regret Asymmetry Filter 쿨다운 만료 시점 진입 게이트 라우팅
/**
 * entryGates/cooldownGate.ts — 쿨다운 종목 진입 보류·해제 (ADR-0030, PR-58).
 *
 * 손절 직후 추격 매수를 막는 Regret Asymmetry Filter 의 last-mile 가드.
 * 분기 동작:
 *   1) cooldownUntil 미설정 → ADR-0598 G1 진입 시점 재평가 (flag ON 시 5d>+15% 신규 쿨다운,
 *      OFF 시 observe 로그만) 후 pass/차단
 *   2) cooldownUntil 설정 + checkCooldownRelease=true →
 *      stock.cooldownUntil/recentHigh undefined + watchlistMutated.value=true
 *      + console.log("쿨다운 해제") 후 pass
 *   3) cooldownUntil 설정 + 미해제 → console.log("쿨다운 유지") 후 차단
 *
 * 주의: 본 게이트는 mutate-and-pass 패턴을 사용한다 (분기 1·2 가 stock 과 mutables
 * 직접 변경). 다른 게이트는 mutate 안 함이 원칙이지만, 원본 perSymbolEvaluation.ts
 * 동작과 byte-equivalent 보존을 위해 예외 허용.
 */

import {
  checkCooldownRelease,
  evaluateRegretAsymmetry,
  FOMO_SURGE_THRESHOLD_PCT,
  isRegretEntryReevaluationEnabled,
} from '../../regretAsymmetryFilter.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const cooldownGate: EntryGate = (ctx) => {
  const { stock, currentPrice, mutables } = ctx;
  if (!stock.cooldownUntil) {
    // ADR-0598 G1 — 등록 시점 1회 평가 갭 봉인: 진입 시점 5거래일 수익률(% 단위, ADR-0578
    // symbolFeatures 주입) 재평가. 결손/비유한 → 재평가 skip (결손 ≠ 추격 신호, 불변식 #6).
    const return5d = stock.symbolFeatures?.return5d;
    if (typeof return5d === 'number' && Number.isFinite(return5d) && return5d > FOMO_SURGE_THRESHOLD_PCT) {
      if (isRegretEntryReevaluationEnabled()) {
        const regret = evaluateRegretAsymmetry(return5d, currentPrice);
        stock.cooldownUntil = regret.cooldownUntil;
        stock.recentHigh = regret.recentHigh;
        mutables.watchlistMutated.value = true;
        return {
          pass: false,
          logMessage:
            `[Regret Asymmetry] ${stock.name}(${stock.code}) 진입 시점 재평가 — ` +
            `직전 5거래일 +${return5d.toFixed(1)}% 급등, 쿨다운 신규 발동 (until ${regret.cooldownUntil})`,
        } as EntryGateResult;
      }
      console.info(
        `[REGRET_ENTRY_REEVAL_OBSERVE] ${stock.name}(${stock.code}) 5d=+${return5d.toFixed(1)}% — ` +
          `would-cooldown (REGRET_ENTRY_REEVALUATION_ENABLED=OFF, executionImpact=NONE)`,
      );
    }
    return { pass: true } as EntryGateResult;
  }

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
