import React from 'react';
import { TrendingUp, Zap, Layers, Crown, AlertCircle } from 'lucide-react';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function SectorAnalysisSection({ stock }: Props) {
  if (!stock.sectorAnalysis) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-6 px-4">
        <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sector Analysis: {stock.sectorAnalysis.sectorName}</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Trends & Catalysts */}
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="w-5 h-5 text-blue-400" />
              <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Current Trends</span>
            </div>
            <ul className="space-y-3">
              {stock.sectorAnalysis?.currentTrends?.map((trend, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-white/80 font-bold leading-tight">{trend}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-5 h-5 text-yellow-400" />
              <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Sector Catalysts</span>
            </div>
            <ul className="space-y-3">
              {stock.sectorAnalysis?.catalysts?.map((catalyst, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-white/80 font-bold leading-tight">{catalyst}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2 mt-2">
            <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10 relative overflow-hidden">
              <div className="flex items-center gap-3 mb-6">
                <Layers className="w-5 h-5 text-purple-400" />
                <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Related Sectors & Correlation</span>
              </div>
              <div className="flex flex-wrap gap-3 mb-6">
                {(stock.relatedSectors || []).map((sector, i) => (
                  <span key={i} className="px-4 py-2 rounded-2xl bg-purple-500/10 text-purple-400 text-xs font-black border border-purple-500/20">
                    {sector}
                  </span>
                ))}
              </div>
              <div className="bg-black/20 p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                <span className="text-[11px] font-black text-white/30 uppercase tracking-widest">Correlation Group</span>
                <span className="text-sm font-black text-white/80">{stock.correlationGroup}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Leading Stocks */}
        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
          <div className="flex items-center gap-3 mb-4">
            <Crown className="w-5 h-5 text-orange-400" />
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Leading Stocks</span>
          </div>
          <div className="space-y-4">
            {(stock.sectorAnalysis?.leadingStocks || []).map((s, i) => (
              <div key={i} className="bg-white/5 p-4 rounded-2xl border border-white/5 hover:bg-white/10 transition-all cursor-pointer group/stock-item">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-black text-white group-hover/stock-item:text-orange-400 transition-colors">{s.name}</span>
                  <span className="text-[10px] font-bold text-white/30">{s.code}</span>
                </div>
                {s.marketCap && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Market Cap:</span>
                    <span className="text-[11px] font-black text-white/60">{s.marketCap}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {stock.sectorAnalysis?.riskFactors && stock.sectorAnalysis.riskFactors.length > 0 && (
            <div className="mt-6 pt-6 border-t border-white/5">
              <span className="text-[10px] font-black text-red-400/40 uppercase tracking-widest block mb-3">Sector Risks</span>
              <div className="space-y-2">
                {(stock.sectorAnalysis.riskFactors || []).map((risk, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-white/50 font-bold">
                    <AlertCircle className="w-3 h-3 text-red-500/50" />
                    {risk}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
