// @responsibility 동일 섹터 보유 한도 초과 진입 보류 Correlation Guard 게이트
/**
 * entryGates/sectorConcentrationGate.ts — 섹터 집중도 가드 (ADR-0030, PR-58 / ADR-0060).
 *
 * 동일 섹터 보유 종목이 MAX_SECTOR_CONCENTRATION 이상이면 진입 보류 + 텔레그램 알림.
 * 본 게이트는 텔레그램 메시지를 결과에 포함만 하고 실제 발송은 orchestrator 가 일괄 처리.
 *
 * ADR-0060: stock.sector 부재 시 getSectorByCode fallback. watchlist[].sector 도 동일.
 * '미분류' 라벨은 명시적 섹터로 취급 (가드 작동). 진입 결정 로직 무변경 — fallback 만 추가.
 */

import { MAX_SECTOR_CONCENTRATION } from '../../riskManager.js';
import { isOpenShadowStatus } from '../../entryEngine.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';
import { recordCounterfactualCase } from '../../../learning/counterfactualShadow.js';
import type { EntryGate, EntryGateResult } from './types.js';

/** 섹터 한도 차단 counterfactual 기록 (2026-06-11 운영자 토론 처방) — "한도를 풀었다면" 의
 *  forward 성과를 14일 성숙으로 측정해 MAX_SECTOR_CONCENTRATION 완화 논의를 데이터로 판정.
 *  기록 실패는 격리(진단이 게이트를 깨지 않음, 불변식 #1) · dedup 은 counterfactualKey 내장.
 *  regime 은 게이트 컨텍스트에 없어 UNKNOWN — 기존 regime backfill 머신의 복구 대상. */
function recordSectorLimitCounterfactual(ctx: Parameters<EntryGate>[0]): void {
  try {
    recordCounterfactualCase({
      stockCode: ctx.stock.code,
      stockName: ctx.stock.name,
      priceAtSignal: ctx.currentPrice,
      gateScore: ctx.stock.gateScore ?? 0,
      regime: 'UNKNOWN',
      conditionKeys: ctx.stock.conditionKeys ?? [],
      skipReason: 'SECTOR_CONCENTRATION_LIMIT',
      blockedReason: 'SECTOR_CONCENTRATION_LIMIT',
      hypotheticalTargetPrice: ctx.stock.targetPrice,
      hypotheticalStopPrice: ctx.stock.stopLoss,
    });
  } catch (error) {
    console.warn(`[CorrelationGuard] counterfactual 기록 실패(게이트 동작 무영향): ${String(error)}`);
  }
}

export const sectorConcentrationGate: EntryGate = (ctx) => {
  const { stock, watchlist, shadows } = ctx;
  // ADR-0060: stock.sector 부재 시 getSectorByCode fallback. 둘 다 부재 시 pass.
  const candidateSector = stock.sector ?? getSectorByCode(stock.code) ?? null;
  if (!candidateSector) return { pass: true } as EntryGateResult;

  const activeSectorCodes = watchlist
    .filter(w => shadows.some(
      s => s.stockCode === w.code && isOpenShadowStatus(s.status)
    ))
    // ADR-0060: watchlist[].sector 부재 시도 동일 fallback (대칭성 보장).
    .map(w => w.sector ?? getSectorByCode(w.code) ?? null)
    .filter(Boolean);
  const sectorCount = activeSectorCodes.filter(s => s === candidateSector).length;
  if (sectorCount >= MAX_SECTOR_CONCENTRATION) {
    recordSectorLimitCounterfactual(ctx);
    return {
      pass: false,
      logMessage:
        `[CorrelationGuard] ${stock.name}(${candidateSector}) 진입 보류 — ` +
        `동일 섹터 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 포화`,
      telegramMessage:
        `🚧 <b>[가드] ${stock.name} 진입 보류</b>\n` +
        `섹터: ${candidateSector}\n` +
        `동일 섹터 보유 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 → 분산 한도 초과`,
    };
  }
  return { pass: true } as EntryGateResult;
};
