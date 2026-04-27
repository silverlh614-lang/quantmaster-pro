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
import type { EntryGate, EntryGateResult } from './types.js';

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
