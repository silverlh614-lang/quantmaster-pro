// @responsibility ADR-0523 channel-specific Telegram verbosity routing policy.

import type { TelegramChannelKind, TelegramVerbosity } from './snapshotBundle.js';

export interface ChannelRoutingDecision {
  channel: TelegramChannelKind;
  verbosity: TelegramVerbosity;
  allowRawForensic: boolean;
  allowSignalEvent: boolean;
  reason: string;
}

export function resolveTelegramChannelRouting(input: {
  channel: TelegramChannelKind;
  requestedVerbosity?: TelegramVerbosity;
  isTradeEvent?: boolean;
  isStrongStateChange?: boolean;
}): ChannelRoutingDecision {
  if (input.channel === 'SIGNAL') {
    return {
      channel: 'SIGNAL',
      verbosity: 'COMPACT',
      allowRawForensic: false,
      allowSignalEvent: input.isTradeEvent === true || input.isStrongStateChange === true,
      reason: 'SIGNAL_CHANNEL_COMPACT_ONLY',
    };
  }
  if (input.channel === 'DEBUG') {
    return {
      channel: 'DEBUG',
      verbosity: input.requestedVerbosity ?? 'FULL_FORENSIC',
      allowRawForensic: true,
      allowSignalEvent: true,
      reason: 'DEBUG_CHANNEL_FULL_ALLOWED',
    };
  }
  if (input.channel === 'DM') {
    return {
      channel: 'DM',
      verbosity: input.requestedVerbosity ?? 'COMPACT',
      allowRawForensic: input.requestedVerbosity === 'FULL_FORENSIC' || input.requestedVerbosity === 'DEBUG_RAW',
      allowSignalEvent: true,
      reason: 'DM_REQUESTED_VERBOSITY',
    };
  }
  return {
    channel: 'OPERATOR',
    verbosity: input.requestedVerbosity ?? 'DETAIL',
    allowRawForensic: input.requestedVerbosity === 'FULL_FORENSIC' || input.requestedVerbosity === 'DEBUG_RAW',
    allowSignalEvent: true,
    reason: 'OPERATOR_DETAIL_DEFAULT',
  };
}
