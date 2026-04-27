// @responsibility 4-체크 라스트 트리거 카드 — "왜 지금?" 표시 (ADR-0031 PR-D)

import React from 'react';
import { Check, Clock, Zap } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { LastTriggerSummary } from '../../types/ui';

interface LastTriggerCardProps {
  summary: LastTriggerSummary;
  className?: string;
}

const VERDICT_STYLE = {
  EXECUTE:   { label: '🟢 진입 트리거', cls: 'bg-green-500/20 border-green-500/40 text-green-200' },
  WATCHLIST: { label: '🟡 트리거 대기', cls: 'bg-amber-500/20 border-amber-500/40 text-amber-200' },
  INACTIVE:  { label: '⚫ 비활성',     cls: 'bg-gray-700/40 border-white/10  text-white/60' },
} as const;

export function LastTriggerCard({ summary, className }: LastTriggerCardProps) {
  const { checks, triggeredCount, totalChecks, verdict } = summary;
  const v = VERDICT_STYLE[verdict];

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-2', className)}
      role="region"
      aria-label="라스트 트리거"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Last Trigger
        </span>
        <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap', v.cls)}>
          {v.label} {triggeredCount}/{totalChecks}
        </span>
      </div>
      <ul className="space-y-1">
        {checks.map(c => {
          const triggered = c.status === 'TRIGGERED';
          return (
            <li
              key={c.id}
              className="flex items-start gap-1.5 text-[11px]"
              title={c.detail}
            >
              <span className={cn('mt-0.5 shrink-0', triggered ? 'text-green-300' : 'text-white/40')}>
                {triggered ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              </span>
              <span className={cn('flex-1', triggered ? 'opacity-100 font-bold' : 'opacity-60')}>
                {c.label}
                <span className="opacity-50 ml-1 text-[10px] font-normal hidden sm:inline">
                  {triggered ? '충족' : '대기'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
