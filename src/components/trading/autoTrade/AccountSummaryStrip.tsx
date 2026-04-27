// @responsibility trading 영역 AccountSummaryStrip 컴포넌트
import React from 'react';
import { Wallet } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { AccountSummary } from '../../../hooks/useAutoTradeDashboard';

interface Props { summary: AccountSummary; }

export function AccountSummaryStrip({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="border-2 rounded-xl p-4 text-center border-slate-600/40 bg-white/[0.02]">
        <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">평가금액</p>
        <p className="text-lg font-black text-theme-text mt-1 font-num">{summary.totalEvalAmt.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span></p>
      </div>
      <div className={cn(
        'border-2 rounded-xl p-4 text-center',
        summary.totalPnlAmt >= 0
          ? 'border-green-500/40 bg-green-500/[0.06]'
          : 'border-red-500/40 bg-red-500/[0.06]'
      )}>
        <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">총 손익</p>
        <p className={cn('text-lg font-black mt-1 font-num', summary.totalPnlAmt >= 0 ? 'text-green-400' : 'text-red-400')}>
          {summary.totalPnlAmt >= 0 ? '+' : ''}{summary.totalPnlAmt.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span>
        </p>
      </div>
      <div className={cn(
        'border-2 rounded-xl p-4 text-center',
        summary.totalPnlRate >= 0
          ? 'border-green-500/40 bg-green-500/[0.06]'
          : 'border-red-500/40 bg-red-500/[0.06]'
      )}>
        <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">수익률</p>
        <p className={cn('text-lg font-black mt-1 font-num', summary.totalPnlRate >= 0 ? 'text-green-400' : 'text-red-400')}>
          {summary.totalPnlRate >= 0 ? '+' : ''}{summary.totalPnlRate.toFixed(2)}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">%</span>
        </p>
      </div>
      <div className="border-2 rounded-xl p-4 text-center border-blue-500/30 bg-blue-500/[0.04]">
        <div className="flex items-center justify-center gap-1 mb-0.5">
          <Wallet className="w-3 h-3 text-blue-400" />
          <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">가용현금</p>
        </div>
        <p className="text-lg font-black text-blue-400 mt-1 font-num">{summary.availableCash.toLocaleString()}<span className="text-[10px] font-bold text-theme-text-muted ml-0.5">원</span></p>
      </div>
    </div>
  );
}
