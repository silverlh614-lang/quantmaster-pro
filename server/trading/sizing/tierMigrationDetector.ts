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

export interface TierMigrationEvent {
  previousTier: AccountTierName;
  currentTier: AccountTierName;
  previousEquity: number;
  currentEquity: number;
  migratedAt: string;
  telegramMessage: string;
}

export interface TierMigrationCheck {
  migrated: boolean;
  event?: TierMigrationEvent;
  currentTier: AccountSizeTier;
}

// ─── 핵심 함수 ───────────────────────────────────────────────────────────────

/**
 * 직전 계좌 총액과 현재 계좌 총액을 비교하여 티어 전환 여부를 감지한다.
 *
 * @param previousEquity  직전 측정 계좌 총액 (원)
 * @param currentEquity   현재 계좌 총액 (원)
 */
export function checkTierMigration(
  previousEquity: number,
  currentEquity: number,
): TierMigrationCheck {
  const prevTier = getAccountSizeTier(previousEquity);
  const currTier = getAccountSizeTier(currentEquity);

  if (prevTier.name === currTier.name) {
    return { migrated: false, currentTier: currTier };
  }

  const event: TierMigrationEvent = {
    previousTier: prevTier.name,
    currentTier: currTier.name,
    previousEquity,
    currentEquity,
    migratedAt: new Date().toISOString(),
    telegramMessage: buildMigrationMessage(prevTier, currTier, currentEquity),
  };

  return { migrated: true, event, currentTier: currTier };
}

/**
 * 티어 경계를 돌파했는지 확인한다 (단순 UP/DOWN 방향 불문).
 * nightlyReflectionEngine에서 매일 호출하면 된다.
 */
export function didCrossThreshold(
  previousEquity: number,
  currentEquity: number,
): boolean {
  return TIER_THRESHOLDS.some((threshold) => {
    const wasBelow = previousEquity < threshold;
    const isAbove  = currentEquity >= threshold;
    const wasAbove = previousEquity >= threshold;
    const isBelow  = currentEquity < threshold;
    return (wasBelow && isAbove) || (wasAbove && isBelow);
  });
}

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
