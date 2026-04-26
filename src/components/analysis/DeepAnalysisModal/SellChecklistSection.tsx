// @responsibility analysis 영역 SellChecklistSection 컴포넌트
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function SellChecklistSection({ stock }: Props) {
  if (!stock.sellSignals || stock.sellSignals.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 bg-red-500 rounded-full" />
          <h3 className="text-base font-black text-white uppercase tracking-tighter">Sell Checklist Evaluation</h3>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-black text-red-500 tracking-tighter">{stock.sellScore || 0}</span>
          <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">Sell Score</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(stock.sellSignals || []).map((signal, i) => (
          <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-red-500/[0.03] border border-red-500/10 hover:bg-red-500/[0.06] transition-all">
            <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <div className="min-w-0">
              <h5 className="text-xs font-black text-white mb-1 uppercase tracking-tight">{signal.condition}</h5>
              <p className="text-[11px] font-bold text-white/45 leading-relaxed">{signal.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
