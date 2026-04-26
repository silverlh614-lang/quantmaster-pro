// @responsibility 분할매수 계획 카드 — 1차/2차/3차 시각화 (ADR-0031 PR-D)

import React from 'react';
import { Layers, Check, Clock } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { TranchePlan } from '../../types/quant';

interface TranchePlanCardProps {
  plan: TranchePlan | null | undefined;
  className?: string;
}

const STATUS_STYLE = {
  EXECUTED: { label: '실행', cls: 'bg-green-500/20 border-green-500/40 text-green-200', icon: <Check className="w-3 h-3" /> },
  PENDING:  { label: '대기', cls: 'bg-gray-700/40   border-white/10    text-white/60', icon: <Clock className="w-3 h-3" /> },
} as const;

interface TrancheRowProps {
  index: 1 | 2 | 3;
  size: number;
  trigger: string;
  status: 'EXECUTED' | 'PENDING';
}

function TrancheRow({ index, size, trigger, status }: TrancheRowProps) {
  const s = STATUS_STYLE[status];
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-[10px] font-black tracking-widest text-white/50 w-8 shrink-0">
        {index}차
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* size bar */}
        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden min-w-[60px] max-w-[120px]">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              status === 'EXECUTED' ? 'bg-green-500/60' : 'bg-violet-500/40',
            )}
            style={{ width: `${Math.max(0, Math.min(100, size))}%` }}
          />
        </div>
        <span className="text-[11px] font-num font-black text-white/80 shrink-0">
          {size}%
        </span>
      </div>
      <div className="hidden sm:block flex-1 text-[10px] text-white/60 truncate min-w-0">
        {trigger}
      </div>
      <span className={cn(
        'flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0',
        s.cls,
      )}>
        {s.icon}
        {s.label}
      </span>
    </div>
  );
}

/**
 * 1차/2차/3차 분할매수 계획 카드.
 * 데이터 부재 시 placeholder 표시. StockDetailModal 임베드.
 */
export function TranchePlanCard({ plan, className }: TranchePlanCardProps) {
  if (!plan) {
    return (
      <div
        className={cn('rounded border border-white/10 bg-black/20 p-3', className)}
        role="region"
        aria-label="분할매수 계획"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">
          <Layers className="w-3 h-3" /> 분할매수 계획
        </div>
        <p className="text-xs opacity-60">분할매수 계획 데이터 없음 (스캔 미실행 또는 단일 진입)</p>
      </div>
    );
  }

  const totalExecuted = [plan.tranche1, plan.tranche2, plan.tranche3]
    .filter(t => t.status === 'EXECUTED').length;

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-3', className)}
      role="region"
      aria-label="분할매수 계획"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-60 flex items-center gap-1.5">
          <Layers className="w-3 h-3" /> 분할매수 계획
        </span>
        <span className="text-[10px] font-num text-white/60">
          진행: <span className="font-black text-white/90">{totalExecuted}/3</span>
        </span>
      </div>
      <div className="divide-y divide-white/5">
        <TrancheRow
          index={1}
          size={plan.tranche1.size}
          trigger={plan.tranche1.trigger}
          status={plan.tranche1.status}
        />
        <TrancheRow
          index={2}
          size={plan.tranche2.size}
          trigger={plan.tranche2.trigger}
          status={plan.tranche2.status}
        />
        <TrancheRow
          index={3}
          size={plan.tranche3.size}
          trigger={plan.tranche3.trigger}
          status={plan.tranche3.status}
        />
      </div>
    </div>
  );
}
