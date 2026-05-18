// @responsibility Determine whether live sell orders may be submitted now.

import { emitExitOperationalWarn } from './exitOperationalWarn.js';
import type { ExitMarketSessionState } from './exitTypes.js';

export interface ExitSessionGuardInput {
  marketSessionState?: string;
  isKrxTradingOpen?: boolean;
  kisOrderAllowed?: boolean;
  liveOrderAllowed?: boolean;
  sellOnly?: boolean;
  now?: Date;
}

export interface ExitSessionGuardDecision {
  marketSessionState: ExitMarketSessionState;
  liveSellOrderAllowed: boolean;
  isKrxTradingOpen: boolean;
  kisOrderAllowed: boolean;
  liveOrderAllowed: boolean;
  reason?: 'SESSION_NOT_OPEN' | 'KRX_NOT_OPEN' | 'KIS_ORDER_NOT_ALLOWED' | 'LIVE_ORDER_NOT_ALLOWED';
}

export function resolveExitSessionGuard(input: ExitSessionGuardInput = {}): ExitSessionGuardDecision {
  try {
    const derivedState = normalizeSessionState(input.marketSessionState ?? deriveKstSession(input.now ?? new Date()), input.sellOnly);
    const isRegular = derivedState === 'OPEN' || derivedState === 'REGULAR' || derivedState === 'SELL_ONLY';
    const isKrxTradingOpen = input.isKrxTradingOpen ?? isRegular;
    const kisOrderAllowed = input.kisOrderAllowed ?? isKrxTradingOpen;
    const liveOrderAllowed = input.liveOrderAllowed ?? isKrxTradingOpen;

    if (derivedState !== 'OPEN' && derivedState !== 'REGULAR') {
      return {
        marketSessionState: derivedState,
        liveSellOrderAllowed: false,
        isKrxTradingOpen,
        kisOrderAllowed,
        liveOrderAllowed,
        reason: 'SESSION_NOT_OPEN',
      };
    }
    if (!isKrxTradingOpen) {
      return {
        marketSessionState: derivedState,
        liveSellOrderAllowed: false,
        isKrxTradingOpen,
        kisOrderAllowed,
        liveOrderAllowed,
        reason: 'KRX_NOT_OPEN',
      };
    }
    if (!kisOrderAllowed) {
      return {
        marketSessionState: derivedState,
        liveSellOrderAllowed: false,
        isKrxTradingOpen,
        kisOrderAllowed,
        liveOrderAllowed,
        reason: 'KIS_ORDER_NOT_ALLOWED',
      };
    }
    if (!liveOrderAllowed) {
      return {
        marketSessionState: derivedState,
        liveSellOrderAllowed: false,
        isKrxTradingOpen,
        kisOrderAllowed,
        liveOrderAllowed,
        reason: 'LIVE_ORDER_NOT_ALLOWED',
      };
    }

    return {
      marketSessionState: derivedState,
      liveSellOrderAllowed: true,
      isKrxTradingOpen,
      kisOrderAllowed,
      liveOrderAllowed,
    };
  } catch (error) {
    emitExitOperationalWarn({
      code: 'P0_EXIT_SESSION_GUARD_FAILED',
      message: 'Exit session guard failed; live sell must be blocked',
      context: {
        marketSessionState: input.marketSessionState,
      },
      cause: error,
    });
    return {
      marketSessionState: 'UNKNOWN',
      liveSellOrderAllowed: false,
      isKrxTradingOpen: false,
      kisOrderAllowed: false,
      liveOrderAllowed: false,
      reason: 'SESSION_NOT_OPEN',
    };
  }
}

function deriveKstSession(now: Date): ExitMarketSessionState {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (day === 0 || day === 6) return 'NON_TRADING_DAY';
  if (minutes < 9 * 60) return 'PRE_MARKET';
  if (minutes >= 9 * 60 && minutes < 15 * 60 + 30) return 'REGULAR';
  return 'AFTER_HOURS';
}

function normalizeSessionState(value: string, sellOnly?: boolean): ExitMarketSessionState {
  if (sellOnly) return 'SELL_ONLY';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OPEN' || normalized === 'REGULAR' || normalized === 'REGULAR_SESSION') return 'REGULAR';
  if (normalized === 'PRE_MARKET' || normalized === 'PRE_OPEN') return 'PRE_MARKET';
  if (normalized === 'AFTER_MARKET' || normalized === 'AFTER_HOURS') return 'AFTER_HOURS';
  if (normalized === 'CLOSED') return 'CLOSED';
  if (normalized === 'NON_TRADING_DAY' || normalized === 'KRX_NON_TRADING_DAY') return 'NON_TRADING_DAY';
  if (normalized === 'SELL_ONLY') return 'SELL_ONLY';
  return 'UNKNOWN';
}
