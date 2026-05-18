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

export interface R6ForcedExitSkipDecision {
  skip: boolean;
  reason?: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT';
  detail?: string;
}

export interface R6LiveForcedExitSessionInput {
  marketSessionState?: string;
  isKrxTradingOpen?: boolean;
  kisOrderAllowed?: boolean;
  liveOrderAllowed?: boolean;
  now?: Date;
}

export interface R6LiveForcedExitSessionDecision {
  allowed: boolean;
  marketSessionState: string;
  isKrxTradingOpen: boolean;
  kisOrderAllowed: boolean;
  liveOrderAllowed: boolean;
  reason?: 'NON_REGULAR_SESSION' | 'KRX_NOT_OPEN' | 'KIS_ORDER_NOT_ALLOWED' | 'LIVE_ORDER_NOT_ALLOWED';
}

export function shouldSkipR6ForcedExitForShadow(position: ServerShadowTrade): R6ForcedExitSkipDecision {
  const candidate = position as ServerShadowTrade & {
    positionKind?: string;
    accountKind?: string;
    origin?: string;
    source?: string;
  };

  if (candidate.mode !== 'LIVE') {
    return { skip: true, reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT', detail: 'mode_not_live' };
  }
  if (candidate.positionKind && candidate.positionKind !== 'LIVE') {
    return { skip: true, reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT', detail: `positionKind_${candidate.positionKind}` };
  }
  if (candidate.accountKind === 'VIRTUAL_SHADOW' || candidate.accountKind === 'PAPER_LEDGER') {
    return { skip: true, reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT', detail: `accountKind_${candidate.accountKind}` };
  }
  if (
    (candidate.source && SHADOW_FORCED_EXIT_EXCLUDED_SOURCES.has(candidate.source)) ||
    (candidate.origin && SHADOW_FORCED_EXIT_EXCLUDED_SOURCES.has(candidate.origin))
  ) {
    return { skip: true, reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT', detail: 'shadow_source' };
  }
  if (candidate.liveOrderSent === false || candidate.executionImpact === 'NONE') {
    return { skip: true, reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT', detail: 'diagnostic_or_no_live_order' };
  }

  return { skip: false };
}

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

export function resolveR6LiveForcedExitSession(
  input: R6LiveForcedExitSessionInput = {},
): R6LiveForcedExitSessionDecision {
  const now = input.now ?? new Date();
  const derivedSession = deriveKstSession(now);
  const marketSessionState = input.marketSessionState ?? derivedSession;
  const derivedOpen = isRegularSessionName(derivedSession);
  const isKrxTradingOpen = input.isKrxTradingOpen ?? derivedOpen;
  const kisOrderAllowed = input.kisOrderAllowed ?? isKrxTradingOpen;
  const liveOrderAllowed = input.liveOrderAllowed ?? isKrxTradingOpen;

  if (!isRegularSessionName(marketSessionState)) {
    return {
      allowed: false,
      marketSessionState,
      isKrxTradingOpen,
      kisOrderAllowed,
      liveOrderAllowed,
      reason: 'NON_REGULAR_SESSION',
    };
  }
  if (!isKrxTradingOpen) {
    return {
      allowed: false,
      marketSessionState,
      isKrxTradingOpen,
      kisOrderAllowed,
      liveOrderAllowed,
      reason: 'KRX_NOT_OPEN',
    };
  }
  if (!kisOrderAllowed) {
    return {
      allowed: false,
      marketSessionState,
      isKrxTradingOpen,
      kisOrderAllowed,
      liveOrderAllowed,
      reason: 'KIS_ORDER_NOT_ALLOWED',
    };
  }
  if (!liveOrderAllowed) {
    return {
      allowed: false,
      marketSessionState,
      isKrxTradingOpen,
      kisOrderAllowed,
      liveOrderAllowed,
      reason: 'LIVE_ORDER_NOT_ALLOWED',
    };
  }

  return {
    allowed: true,
    marketSessionState,
    isKrxTradingOpen,
    kisOrderAllowed,
    liveOrderAllowed,
  };
}

export function getLastSellFill(trade: ServerShadowTrade): PositionFill | null {
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
