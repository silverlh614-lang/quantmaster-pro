// @responsibility 3-플래그 Enemy Checklist 경고 카드 (ADR-0021 PR-D)

import React from 'react';
import { Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { EnemyChecklistSummary } from '../../types/ui';

interface EnemyChecklistCardProps {
  summary: EnemyChecklistSummary;
  className?: string;
}

const VERDICT_STYLE = {
  CLEAR:   { label: '🟢 안전', cls: 'bg-green-500/20 border-green-500/40 text-green-200' },
  CAUTION: { label: '🟡 경계', cls: 'bg-amber-500/20 border-amber-500/40 text-amber-200' },
  BLOCK:   { label: '🔴 차단', cls: 'bg-red-500/20   border-red-500/40   text-red-200' },
} as const;

export function EnemyChecklistCard({ summary, className }: EnemyChecklistCardProps) {
  const { flags, warningCount, verdict } = summary;
  const v = VERDICT_STYLE[verdict];

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-2', className)}
      role="region"
      aria-label="Enemy 체크리스트"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> Enemy Check
        </span>
        <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap', v.cls)}>
          {v.label} {warningCount > 0 ? `${warningCount}` : '0'}
        </span>
      </div>
      <ul className="space-y-1">
        {flags.map(f => {
          const warn = f.status === 'WARNING';
          return (
            <li
              key={f.id}
              className="flex items-start gap-1.5 text-[11px]"
              title={f.detail}
            >
              <span className={cn('mt-0.5 shrink-0', warn ? 'text-red-300' : 'text-green-300')}>
                {warn ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              </span>
              <span className={cn('flex-1', warn ? 'opacity-100 font-bold text-red-200' : 'opacity-60')}>
                {f.label}
                <span className="opacity-50 ml-1 text-[10px] font-normal hidden sm:inline">
                  {warn ? '경고' : '정상'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
