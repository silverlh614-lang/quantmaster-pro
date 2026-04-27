// @responsibility 포트폴리오 리스크 엔진 통합 점검 결과 진입 라우팅 게이트
/**
 * entryGates/portfolioRiskGate.ts — 포트폴리오 리스크 통합 점검 (ADR-0030, PR-58).
 *
 * portfolioRiskEngine 이 섹터 비중·베타·일일 손실을 통합 평가:
 *   - entryAllowed=false → 차단 + stageLog.portfolioRisk + pushTrace
 *   - entryAllowed=true + warnings.length>0 → console.warn 통과 (차단 아님)
 *   - entryAllowed=true + 무경고 → 조용히 통과
 */

import { evaluatePortfolioRisk } from '../../portfolioRiskEngine.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const portfolioRiskGate: EntryGate = async (ctx) => {
  const { stock } = ctx;
  const prisk = await evaluatePortfolioRisk(stock.sector);
  if (!prisk.entryAllowed) {
    return {
      pass: false,
      logMessage: `[PortfolioRisk] ${stock.name} 진입 차단 — ${prisk.blockReasons.join('; ')}`,
      stageLog: { key: 'portfolioRisk', value: prisk.blockReasons.join('; ') },
      pushTrace: true,
    };
  }
  if (prisk.warnings.length > 0) {
    return {
      pass: true,
      passWarnMessage: `[PortfolioRisk] ${stock.name} 경고: ${prisk.warnings.join('; ')}`,
    };
  }
  return { pass: true } as EntryGateResult;
};
