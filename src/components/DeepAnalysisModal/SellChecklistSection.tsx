import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { StockRecommendation } from '../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function SellChecklistSection({ stock }: Props) {
  if (!stock.sellSignals || stock.sellSignals.length === 0) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-6 px-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-red-500 rounded-full" />
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sell Checklist Evaluation</h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black text-red-500 tracking-tighter">{stock.sellScore || 0}</span>
          <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Sell Score</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(stock.sellSignals || []).map((signal, i) => (
          <div key={i} className="flex items-start gap-5 p-6 rounded-[2rem] bg-red-500/[0.03] border border-red-500/10 hover:bg-red-500/[0.06] transition-all group/sell">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20 group-hover/sell:scale-110 transition-transform">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <h5 className="text-sm font-black text-white mb-2 uppercase tracking-tight">{signal.condition}</h5>
              <p className="text-xs font-bold text-white/40 leading-relaxed">{signal.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
