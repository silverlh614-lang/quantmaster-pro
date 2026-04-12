import React from 'react';
import { Award, Sparkles, Info, ExternalLink, ShieldCheck } from 'lucide-react';
import { cn } from '../../ui/cn';
import { getMarketPhaseInfo } from '../../constants/checklist';
import type { StockRecommendation } from '../../services/stockService';

interface ModalHeaderProps {
  stock: StockRecommendation;
}

export function ModalHeader({ stock }: ModalHeaderProps) {
  return (
    <div className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tighter text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.1)] break-words max-w-full leading-tight">
            {stock.name}
          </h2>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="text-xs sm:text-sm font-black text-white/60 bg-white/10 px-4 py-2 rounded-2xl border border-white/20 tracking-[0.2em] uppercase shadow-2xl backdrop-blur-xl">
              {stock.code}
            </span>
            {stock.isSectorTopPick && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl shadow-lg">
                <Award className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Sector Top Pick</span>
              </div>
            )}
            {stock.aiConvictionScore?.marketPhase && (
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <div className={cn(
                  "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border backdrop-blur-md shadow-lg flex items-center gap-2 whitespace-nowrap shrink-0",
                  stock.aiConvictionScore.marketPhase === 'RISK_ON' || stock.aiConvictionScore.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                  stock.aiConvictionScore.marketPhase === 'RISK_OFF' || stock.aiConvictionScore.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" :
                  stock.aiConvictionScore.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                  stock.aiConvictionScore.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                  "bg-white/10 text-white/40 border-white/10"
                )} title={getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).description}>
                  {getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).label}
                  <Info className="w-3 h-3 opacity-50" />
                </div>
                <a
                  href={(() => {
                    const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
                    return cleanCode.length === 6
                      ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                      : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name)}+주가`;
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-xl transition-all group/link shadow-lg active:scale-95"
                >
                  <span className="text-[10px] font-black uppercase tracking-widest">Chart</span>
                  <ExternalLink className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-1.5 w-24 bg-gradient-to-r from-orange-500 via-orange-500/50 to-transparent rounded-full" />
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-[11px] font-black text-orange-500 uppercase tracking-[0.4em]">Institutional Grade AI Analysis</span>
          </div>
        </div>
      </div>

      {/* Quick Stats in Header */}
      <div className="flex items-center gap-4 sm:gap-8 bg-white/[0.03] p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-white/10 backdrop-blur-xl shadow-2xl flex-wrap lg:flex-nowrap justify-center lg:justify-start">
        <div className="flex flex-col min-w-fit">
          <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">Current Price</span>
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white tracking-tighter">₩{stock.currentPrice?.toLocaleString() || '0'}</span>
              <span className="text-[10px] font-bold text-white/20 uppercase">KRW</span>
            </div>
            {(stock.priceUpdatedAt || stock.dataSource) && (
              <div className="text-[8px] font-black text-white/30 uppercase tracking-tighter mt-1">
                {stock.priceUpdatedAt} {stock.dataSource && `via ${stock.dataSource}`}
              </div>
            )}
            {stock.financialUpdatedAt && (
              <div className="text-[8px] font-black text-blue-400/40 uppercase tracking-tighter mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-2 h-2" />
                DART: {stock.financialUpdatedAt}
              </div>
            )}
          </div>
        </div>
        <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
        <div className="flex flex-col min-w-fit">
          <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">Value / Momentum</span>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-center">
              <span className="text-lg sm:text-xl font-black text-blue-400">{stock.scores?.value || 0}</span>
              <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">VALUE</span>
            </div>
            <div className="w-px h-5 sm:h-6 bg-white/10" />
            <div className="flex flex-col items-center">
              <span className="text-lg sm:text-xl font-black text-orange-400">{stock.scores?.momentum || 0}</span>
              <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">MOMENTUM</span>
            </div>
          </div>
        </div>
        <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
        <div className="flex flex-col min-w-fit">
          <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">AI Conviction</span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black text-orange-500 tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
            <span className="text-[10px] font-bold text-white/20">/ 100</span>
          </div>
        </div>
      </div>
    </div>
  );
}
