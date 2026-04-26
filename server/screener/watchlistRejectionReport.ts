// @responsibility 워치리스트 탈락 사유 텔레그램 일괄 리포트 송출
/**
 * watchlistRejectionReport.ts — 일일 워치리스트 탈락 사유 리포트 (ADR-0029).
 *
 * autoPopulateWatchlist 한 회차 후 누적된 탈락 로그를 사유별 집계 + 상위 10건
 * 종목 리스트로 정리해 LOW priority 텔레그램 1회 발송 (20시간 쿨다운).
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { getLastRejectionLog } from './rejectionLog.js';
import { getScreenerCache } from './stockScreener.js';
import { STOCK_UNIVERSE } from './stockUniverse.js';

export async function sendWatchlistRejectionReport(): Promise<void> {
  const log = getLastRejectionLog();
  if (log.length === 0) {
    console.log('[RejectionReport] 탈락 로그 없음 — 리포트 스킵');
    return;
  }

  // 사유별 집계
  const reasonCounts = new Map<string, number>();
  for (const entry of log) {
    // 사유 카테고리 추출 (숫자 제거하여 그룹화)
    const category = entry.reason.replace(/[+-]?\d+(\.\d+)?[%주배]/g, '').trim() || entry.reason;
    reasonCounts.set(category, (reasonCounts.get(category) ?? 0) + 1);
  }

  const sortedReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
  const reasonLines = sortedReasons.slice(0, 8).map(([r, c]) => `  ${r}: ${c}건`).join('\n');

  // 상위 탈락 종목 (최대 10개)
  const topRejections = log.slice(0, 10).map(e => `  ${e.name}(${e.code}): ${e.reason}`).join('\n');

  const msg =
    `📋 <b>[워치리스트 탈락 리포트]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `스캔 종목: ${getScreenerCache().length || STOCK_UNIVERSE.length}개 | 탈락: ${log.length}건\n\n` +
    `<b>사유별 분포:</b>\n${reasonLines}\n\n` +
    `<b>탈락 종목 (상위 10):</b>\n${topRejections}\n` +
    `━━━━━━━━━━━━━━━━`;

  await sendTelegramAlert(msg, {
    priority: 'LOW',
    dedupeKey: 'watchlist-rejection-daily',
    cooldownMs: 20 * 60 * 60 * 1000,  // 20시간 쿨다운 (하루 1회)
  }).catch(console.error);

  console.log(`[RejectionReport] 텔레그램 발송 완료 — 탈락 ${log.length}건`);
}
