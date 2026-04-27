// @responsibility 승인 큐 투입 전 섹터 노출 비중 사전 검증 차단 게이트
/**
 * entryGates/sectorPreGuardGate.ts — Phase 1-② 섹터 사전 가드 (ADR-0030, PR-58).
 *
 * 현재 보유 섹터 + 같은 tick 의 pending 섹터 합산으로 투영 비중 계산해
 * 단일 섹터 > 40% 또는 상관 그룹 > 50% 사전 차단. portfolioRiskGate 의 사후
 * 점검은 그대로 남아 제2방어선 역할.
 *
 * 신규 진입 예상 금액은 gateScore 기반 raw 비중(보수적 추정) × totalAssets ×
 * kellyMultiplier 로 산출. 후속 포지션 사이징 결과와 10~30% 오차 허용.
 */

import { checkSectorExposureBefore } from '../../preOrderGuard.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const sectorPreGuardGate: EntryGate = (ctx) => {
  const { stock, totalAssets, kellyMultiplier, mutables } = ctx;
  const candidateSector = stock.sector || getSectorByCode(stock.code);
  const estGateScore = stock.gateScore ?? 5;
  const estRawPct = estGateScore >= 9 ? 0.12 : estGateScore >= 7 ? 0.08 : estGateScore >= 5 ? 0.05 : 0.03;
  const estCandidateValue = totalAssets * estRawPct * kellyMultiplier;
  const secGuard = checkSectorExposureBefore({
    candidateSector,
    candidateValue: estCandidateValue,
    currentSectorValue: mutables.currentSectorValue,
    pendingSectorValue: mutables.pendingSectorValue,
    totalAssets,
  });
  if (!secGuard.allowed) {
    return {
      pass: false,
      logMessage: `[SectorPreGuard] ${stock.name}(${candidateSector ?? '?'}) ${secGuard.reason}`,
      stageLog: { key: 'sectorGuard', value: `BLOCK(${secGuard.projectedSectorWeight.toFixed(2)})` },
      pushTrace: true,
    };
  }
  return { pass: true } as EntryGateResult;
};
