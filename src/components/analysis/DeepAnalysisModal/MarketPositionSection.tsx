import React from 'react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function MarketPositionSection({ stock }: Props) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <div className="w-1 h-5 bg-blue-500 rounded-full" />
        <h3 className="text-base font-black text-white uppercase tracking-tighter">Market Position</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Momentum Rank</span>
          <span className="text-2xl font-black text-blue-400">#{stock.momentumRank}</span>
          <span className="text-[9px] font-bold text-white/40 mt-0.5">Top {Math.round((stock.momentumRank / 2500) * 100)}%</span>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Supply Quality</span>
          <div className="flex gap-1.5">
            <div className={cn("px-2 py-0.5 rounded text-[9px] font-black border",
              stock.supplyQuality?.active ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/20 border-white/10")}>
              ACTIVE
            </div>
            <div className={cn("px-2 py-0.5 rounded text-[9px] font-black border",
              stock.supplyQuality?.passive ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/20 border-white/10")}>
              PASSIVE
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Sector Status</span>
          <span className={cn("text-xs font-black", stock.isLeadingSector ? "text-orange-400" : "text-white/40")}>
            {stock.isLeadingSector ? "LEADING" : "SECONDARY"}
          </span>
          <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest mt-0.5">
            {stock.isPreviousLeader ? "PREV LEADER" : "NEW CANDIDATE"}
          </span>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Peak Distance</span>
          <span className="text-base font-black text-white">₩{stock.peakPrice?.toLocaleString()}</span>
          <span className="text-[10px] font-black text-red-400 mt-0.5">
            -{Math.round((1 - (stock.currentPrice / (stock.peakPrice || 1))) * 100)}%
          </span>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Market Cap</span>
          <span className="text-sm font-black text-white uppercase">{stock.marketCapCategory} CAP</span>
          <span className="text-[9px] font-bold text-white/40 mt-0.5">₩{(stock.marketCap / 100000000).toFixed(1)}B</span>
        </div>
      </div>
    </div>
  );
}
