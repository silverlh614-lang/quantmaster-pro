// @responsibility WatchlistCard 헤더 우측 4-Gate 미니 인디케이터 — 4 dot horizontal + tooltip (ADR-0049 PR-Z7)

import React from 'react';
import { cn } from '../../ui/cn';
import type { StockRecommendation } from '../../services/stockService';
import {
  evaluateGateMini,
  type GateDotState,
  type GateLineSummary,
} from '../../utils/gateMiniIndicator';

const STATE_DOT_CSS: Record<GateDotState, string> = {
  PASS:    'bg-emerald-400 ring-emerald-300/40',
  PARTIAL: 'bg-amber-400 ring-amber-300/40',
  FAIL:    'bg-red-500 ring-red-400/40',
  NA:      'bg-transparent border border-zinc-600/60',
};

const STATE_LABEL: Record<GateDotState, string> = {
  PASS: '통과',
  PARTIAL: '부분 통과',
  FAIL: '탈락',
  NA: '평가 불가',
};

function buildTooltip(line: GateLineSummary): string {
  if (line.state === 'NA') return `${line.label}: 평가 불가`;
  return `${line.label}: ${line.passedCount}/${line.totalCount} 통과 — ${STATE_LABEL[line.state]}`;
}

interface GateMiniIndicatorProps {
  stock: StockRecommendation;
}

export function GateMiniIndicator({ stock }: GateMiniIndicatorProps) {
  const summary = evaluateGateMini(stock);

  return (
    <div
      data-testid="gate-mini-indicator"
      data-pass-count={summary.passCount}
      className="inline-flex items-center gap-1"
      role="group"
      aria-label={`4-Gate 통과 ${summary.passCount}/4`}
    >
      {summary.gates.map((g) => (
        <span
          key={g.id}
          data-testid={`gate-mini-dot-${g.id}`}
          data-gate-state={g.state}
          title={buildTooltip(g)}
          className={cn(
            'inline-block h-2.5 w-2.5 rounded-full ring-1 transition-colors',
            STATE_DOT_CSS[g.state],
          )}
          aria-label={buildTooltip(g)}
        />
      ))}
      <span
        className={cn(
          'text-[10px] font-mono ml-0.5',
          summary.passCount === 4 ? 'text-emerald-300' :
          summary.passCount >= 2 ? 'text-amber-300' :
          summary.passCount === 0 ? 'text-zinc-500' : 'text-zinc-400',
        )}
      >
        {summary.passCount}/4
      </span>
    </div>
  );
}
