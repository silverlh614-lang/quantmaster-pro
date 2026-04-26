// @responsibility STOP_APPROACH_ALERT 손절 접근 3단계 경보 규칙 (-5%/-3%/-1% dedupe)
/**
 * exitEngine/rules/stopApproachAlert.ts — 손절가 접근 3단계 경보 (ADR-0028, 아이디어 5).
 *   Stage 1: 손절까지 -5% 이내 → 🟡 접근 경고
 *   Stage 2: 손절까지 -3% 이내 → 🟠 임박 경고
 *   Stage 3: 손절까지 -1% 이내 → 🔴 집행 임박 (exitEngine 하드스톱이 곧 발동)
 *
 * 단계별 dedupeKey 로 중복 알림 차단.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';

export async function stopApproachAlert(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice, hardStopLoss } = ctx;

  const distToStop = ((currentPrice - hardStopLoss) / hardStopLoss) * 100;
  const stage = shadow.stopApproachStage ?? 0;

  if (distToStop > 0 && distToStop < 5 && stage < 1) {
    shadow.stopApproachStage = 1;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    await sendTelegramAlert(
      `🟡 <b>[손절 접근] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
      `현재가: ${currentPrice.toLocaleString()}원\n` +
      `손절까지: -${distToStop.toFixed(1)}%\n` +
      `손절가: ${hardStopLoss.toLocaleString()}원`,
      {
        priority: 'HIGH',
        dedupeKey: `stop_approach_1:${shadow.stockCode}`,
      },
    ).catch(console.error);
  }

  if (distToStop > 0 && distToStop < 3 && stage < 2) {
    shadow.stopApproachStage = 2;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    await sendTelegramAlert(
      `🟠 <b>[손절 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
      `현재가: ${currentPrice.toLocaleString()}원\n` +
      `손절까지: -${distToStop.toFixed(1)}% — 확인 필요\n` +
      `손절가: ${hardStopLoss.toLocaleString()}원`,
      {
        priority: 'CRITICAL',
        dedupeKey: `stop_approach_2:${shadow.stockCode}`,
      },
    ).catch(console.error);
  }

  if (distToStop > 0 && distToStop < 1 && stage < 3) {
    shadow.stopApproachStage = 3;
    shadow.exitRuleTag = 'STOP_APPROACH_ALERT';
    await sendTelegramAlert(
      `🔴 <b>[손절 집행 임박] ${shadow.stockName} (${shadow.stockCode})</b>\n` +
      `현재가: ${currentPrice.toLocaleString()}원\n` +
      `손절까지: -${distToStop.toFixed(1)}% — 곧 청산 실행\n` +
      `손절가: ${hardStopLoss.toLocaleString()}원`,
      {
        priority: 'CRITICAL',
        dedupeKey: `stop_approach_3:${shadow.stockCode}`,
      },
    ).catch(console.error);
  }
  return NO_OP;
}
