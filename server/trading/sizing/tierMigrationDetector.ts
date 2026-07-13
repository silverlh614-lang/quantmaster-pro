/**
 * @responsibility 계좌 티어 마이그레이션 감지 — 전환 이벤트 합성 + Telegram 알림 페이로드 생성 진입점
 *
 * nightlyReflectionEngine 또는 서버 부트 시 호출한다.
 * 즉시 강제 매도 없이 "리밸런싱 후보 등록" 방식으로 전환한다.
 */

import {
  getAccountSizeTier,
  getTierLabel,
  TIER_THRESHOLDS,
  type AccountSizeTier,
  type AccountTierName,
} from './accountSizeTiers.js';

// ─── 타입 ────────────────────────────────────────────────────────────────────
// ─── 핵심 함수 ───────────────────────────────────────────────────────────────
// ─── 알림 메시지 빌더 ────────────────────────────────────────────────────────

function buildMigrationMessage(
  prev: AccountSizeTier,
  curr: AccountSizeTier,
  currentEquity: number,
): string {
  const isUpgrade = curr.minEquity > prev.minEquity;
  const emoji = isUpgrade ? '🏆' : '⚠️';
  const direction = isUpgrade ? '승급' : '하향';

  return (
    `${emoji} <b>계좌 티어 ${direction}!</b>\n` +
    `${prev.name}(${getTierLabel(prev.name)}) → ${curr.name}(${getTierLabel(curr.name)})\n` +
    `계좌 총액: ${currentEquity.toLocaleString()}원\n\n` +
    `✅ <b>새 전략 파라미터 적용:</b>\n` +
    `• BUY 기본 비중: ${(curr.buyPct * 100).toFixed(0)}%\n` +
    `• STRONG_BUY 비중: ${(curr.strongBuyPct * 100).toFixed(0)}%\n` +
    `• CONFIRMED 비중: ${(curr.confirmedStrongBuyPct * 100).toFixed(0)}%\n` +
    `• 최대 단일 비중: ${(curr.maxPositionPct * 100).toFixed(0)}%\n` +
    `• 거래당 허용 손실: ${(curr.riskPerTradePct * 100).toFixed(1)}%\n` +
    `• 권장 보유 종목: ${curr.targetHoldingsMin}~${curr.targetHoldingsMax}개\n` +
    `• 재투자 비율: ${(curr.profitReinvestmentRate * 100).toFixed(0)}%\n\n` +
    `📋 현재 포트폴리오가 새 기준을 초과하는 종목은\n` +
    `강제 매도하지 않고 리밸런싱 후보로 등록됩니다.`
  );
}
