// @responsibility R6 forced exit policy guard helpers for live-only emergency exits
import type { PositionFill, ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

export const R6_FORCED_EXIT_SUSPECT_TAGS = new Set([
  'R6_EMERGENCY_EXIT',
  'BLACKSWAN_FORCED_EXIT',
  'REGIME_FORCED_SELL',
]);

const SHADOW_FORCED_EXIT_EXCLUDED_SOURCES = new Set([
  'ShadowPositionLedger',
  'ShadowTradeRepo',
  'PaperTradeLedger',
  'VirtualAccount',
]);

function deriveKstSession(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (day === 0 || day === 6) return 'NON_TRADING_DAY';
  if (minutes < 9 * 60) return 'PRE_MARKET';
  if (minutes >= 9 * 60 && minutes < 15 * 60 + 30) return 'REGULAR';
  return 'AFTER_MARKET';
}

function isRegularSessionName(session: string): boolean {
  return session === 'REGULAR' || session === 'REGULAR_SESSION' || session === 'OPEN';
}

function getLastSellFill(trade: ServerShadowTrade): PositionFill | null {
  return (trade.fills ?? [])
    .filter(fill => fill.type === 'SELL')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .pop() ?? null;
}

function fillHasSuspectTag(fill: PositionFill | null | undefined): boolean {
  if (!fill) return false;
  const candidate = fill as PositionFill & { origin?: string; source?: string };
  const tokens = [
    fill.exitRuleTag,
    fill.reason,
    fill.attribution?.ruleId,
    candidate.origin,
    candidate.source,
  ].filter((v): v is string => typeof v === 'string');

  return tokens.some(token => Array.from(R6_FORCED_EXIT_SUSPECT_TAGS).some(tag => token.includes(tag)));
}

export function isShadowR6ForcedExitSuspected(trade: ServerShadowTrade): boolean {
  if (trade.mode === 'LIVE') return false;
  if (fillHasSuspectTag(getLastSellFill(trade))) return true;
  return typeof trade.exitRuleTag === 'string' && R6_FORCED_EXIT_SUSPECT_TAGS.has(trade.exitRuleTag);
}

export function formatR6ShadowHoldMessage(trade: ServerShadowTrade): string {
  return [
    `[R6 Shadow hold] ${trade.stockName} (${trade.stockCode})`,
    'R6_DEFENSE detected. Shadow positions are excluded from forced liquidation.',
    'Managed only by normal Shadow exit rules: stopLoss, targetPrice, trailingStop, strategyExit, manualShadowSell.',
    'liveOrderSent=false / executionImpact=NONE',
  ].join('\n');
}
