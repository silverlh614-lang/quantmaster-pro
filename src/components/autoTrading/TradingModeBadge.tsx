import React from 'react';
import { TradingMode } from '../../services/autoTrading/autoTradingTypes';

interface TradingModeBadgeProps {
  mode: TradingMode;
}

const modeStyleMap: Record<TradingMode, string> = {
  LIVE: 'bg-red-500/15 text-red-300 border border-red-500/30',
  PAPER: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  SHADOW: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
  MANUAL: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
};

export function TradingModeBadge({ mode }: TradingModeBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${modeStyleMap[mode]}`}
    >
      {mode}
    </span>
  );
}
