// @responsibility analysis 영역 SectorAnalysisSection 컴포넌트
import React from 'react';
import { TrendingUp, Zap, Layers, Crown, AlertCircle } from 'lucide-react';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function SectorAnalysisSection({ stock }: Props) {
  if (!stock.sectorAnalysis) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <div className="w-1 h-5 bg-blue-500 rounded-full" />
        <h3 className="text-base font-black text-white uppercase tracking-tighter">섹터: {stock.sectorAnalysis.sectorName}</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Trends & Catalysts */}
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07]">
            <div className="flex items-center gap-2 mb-2.5">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-[10px] font-black text-white/40 tracking-tight">현재 트렌드</span>
            </div>
            <ul className="space-y-2">
              {stock.sectorAnalysis?.currentTrends?.map((trend, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <span className="text-[12px] text-white/80 font-bold leading-snug">{trend}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07]">
            <div className="flex items-center gap-2 mb-2.5">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-[10px] font-black text-white/40 tracking-tight">섹터 촉매</span>
            </div>
            <ul className="space-y-2">
              {stock.sectorAnalysis?.catalysts?.map((catalyst, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-yellow-500 mt-1.5 shrink-0" />
                  <span className="text-[12px] text-white/80 font-bold leading-snug">{catalyst}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07]">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-purple-400" />
                <span className="text-[10px] font-black text-white/40 tracking-tight">연관 섹터 및 상관관계</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {(stock.relatedSectors || []).map((sector, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 text-[11px] font-black border border-purple-500/20">
                    {sector}
                  </span>
                ))}
              </div>
              <div className="bg-black/20 px-3 py-2 rounded-lg border border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black text-white/30 tracking-tight">상관관계 그룹</span>
                <span className="text-xs font-black text-white/80">{stock.correlationGroup}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Leading Stocks */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07]">
          <div className="flex items-center gap-2 mb-2.5">
            <Crown className="w-4 h-4 text-orange-400" />
            <span className="text-[10px] font-black text-white/40 tracking-tight">주도주</span>
          </div>
          <div className="space-y-2">
            {(stock.sectorAnalysis?.leadingStocks || []).map((s, i) => (
              <div key={i} className="bg-white/5 px-3 py-2 rounded-lg border border-white/5 hover:bg-white/10 transition-all">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-white">{s.name}</span>
                  <span className="text-[10px] font-bold text-white/30">{s.code}</span>
                </div>
                {s.marketCap && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-black text-white/20 tracking-tight">시총</span>
                    <span className="text-[10px] font-black text-white/60">{s.marketCap}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {stock.sectorAnalysis?.riskFactors && stock.sectorAnalysis.riskFactors.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <span className="text-[10px] font-black text-red-400/40 tracking-tight block mb-2">섹터 리스크</span>
              <div className="space-y-1.5">
                {(stock.sectorAnalysis.riskFactors || []).map((risk, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-white/50 font-bold">
                    <AlertCircle className="w-2.5 h-2.5 text-red-500/50 shrink-0" />
                    <span className="leading-snug">{risk}</span>
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
