import React from 'react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function MarketPositionSection({ stock }: Props) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-6 px-4">
        <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Market Position</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Momentum Rank</span>
          <span className="text-3xl font-black text-blue-400">#{stock.momentumRank}</span>
          <span className="text-[9px] font-bold text-white/40 mt-1">Top {Math.round((stock.momentumRank / 2500) * 100)}% of Market</span>
        </div>

        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Supply Quality</span>
          <div className="flex gap-2">
            <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border",
              stock.supplyQuality?.active ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/20 border-white/10")}>
              ACTIVE
            </div>
            <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border",
              stock.supplyQuality?.passive ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/20 border-white/10")}>
              PASSIVE
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Sector Status</span>
          <div className="flex flex-col items-center">
            <span className={cn("text-sm font-black mb-1", stock.isLeadingSector ? "text-orange-400" : "text-white/40")}>
              {stock.isLeadingSector ? "LEADING SECTOR" : "SECONDARY SECTOR"}
            </span>
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">
              {stock.isPreviousLeader ? "PREVIOUS LEADER" : "NEW LEADER CANDIDATE"}
            </span>
          </div>
        </div>

        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Peak Distance</span>
          <div className="flex flex-col items-center">
            <span className="text-xl font-black text-white">₩{stock.peakPrice?.toLocaleString()}</span>
            <span className="text-[10px] font-black text-red-400 mt-1">
              -{Math.round((1 - (stock.currentPrice / (stock.peakPrice || 1))) * 100)}% from Peak
            </span>
          </div>
        </div>

        <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Market Cap</span>
          <span className="text-lg font-black text-white uppercase tracking-tight">{stock.marketCapCategory} CAP</span>
          <span className="text-[9px] font-bold text-white/40 mt-1">₩{(stock.marketCap / 100000000).toFixed(1)}B</span>
        </div>
      </div>
    </div>
  );
}
