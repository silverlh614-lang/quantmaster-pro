// @responsibility 동일 섹터 보유 한도 초과 진입 보류 Correlation Guard 게이트
/**
 * entryGates/sectorConcentrationGate.ts — 섹터 집중도 가드 (ADR-0030, PR-58).
 *
 * 동일 섹터 보유 종목이 MAX_SECTOR_CONCENTRATION 이상이면 진입 보류 + 텔레그램 알림.
 * 본 게이트는 텔레그램 메시지를 결과에 포함만 하고 실제 발송은 orchestrator 가 일괄 처리.
 *
 * sector 미설정 종목은 pass.
 */

import { MAX_SECTOR_CONCENTRATION } from '../../riskManager.js';
import { isOpenShadowStatus } from '../../entryEngine.js';
import type { EntryGate, EntryGateResult } from './types.js';

export const sectorConcentrationGate: EntryGate = (ctx) => {
  const { stock, watchlist, shadows } = ctx;
  if (!stock.sector) return { pass: true } as EntryGateResult;

  const activeSectorCodes = watchlist
    .filter(w => shadows.some(
      s => s.stockCode === w.code && isOpenShadowStatus(s.status)
    ))
    .map(w => w.sector)
    .filter(Boolean);
  const sectorCount = activeSectorCodes.filter(s => s === stock.sector).length;
  if (sectorCount >= MAX_SECTOR_CONCENTRATION) {
    return {
      pass: false,
      logMessage:
        `[CorrelationGuard] ${stock.name}(${stock.sector}) 진입 보류 — ` +
        `동일 섹터 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 포화`,
      telegramMessage:
        `🚧 <b>[가드] ${stock.name} 진입 보류</b>\n` +
        `섹터: ${stock.sector}\n` +
        `동일 섹터 보유 ${sectorCount}/${MAX_SECTOR_CONCENTRATION}개 → 분산 한도 초과`,
    };
  }
  return { pass: true } as EntryGateResult;
};
