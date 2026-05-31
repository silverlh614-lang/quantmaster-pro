// @responsibility deep analysis 모바일 스크롤 시 상단 고정되는 핵심 요약바 — 종목·최종점수·신호.
import React from 'react';
import { cn } from '../../../ui/cn';
import { buildStockAnalysisCanon } from '../../../services/stock/stockAnalysisCanon';
import type { StockRecommendation } from '../../../services/stockService';

const SIGNAL_META: Record<string, { label: string; cls: string }> = {
  STRONG_BUY:  { label: '적극 매수', cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  BUY:         { label: '매수',      cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  HOLD:        { label: '관망',      cls: 'bg-white/10 text-white/50 border-white/[0.07]' },
  NEUTRAL:     { label: '관망',      cls: 'bg-white/10 text-white/50 border-white/[0.07]' },
  SELL:        { label: '매도',      cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  STRONG_SELL: { label: '적극 매도', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  AVOID:       { label: '회피',      cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

/**
 * 모바일 전용 — DeepAnalysisBody 스크롤 컨테이너 최상단에 sticky 고정.
 * 긴 상세를 내려도 종목·최종점수·신호가 항상 보이게 한다(맥락 유지).
 * 모바일에서 액션버튼(뷰토글·PDF·닫기)은 in-flow 행으로 위에 있어 본 바는 그 아래 full-width.
 */
export function StickySummaryBar({ stock }: { stock: StockRecommendation }) {
  const { finalScore } = buildStockAnalysisCanon(stock);
  const sig = SIGNAL_META[stock.type ?? 'NEUTRAL'] ?? SIGNAL_META.NEUTRAL;
  const scoreCls = finalScore >= 70 ? 'text-green-400' : finalScore >= 40 ? 'text-amber-400' : 'text-white/50';
  return (
    <div className="sm:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/[0.07] bg-neutral-950/90 px-5 py-2.5 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-black text-white">{stock.name}</span>
        <span className="shrink-0 font-num text-[10px] text-white/40">{stock.code}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-baseline gap-0.5">
          <span className={cn('font-num text-base font-black', scoreCls)}>{finalScore}</span>
          <span className="text-[9px] font-bold text-white/30">점</span>
        </div>
        <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-tight', sig.cls)}>
          {sig.label}
        </span>
      </div>
    </div>
  );
}
