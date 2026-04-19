import React from 'react';
import { Award, Sparkles, Info, ExternalLink, ShieldCheck } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { getMarketPhaseInfo } from '../../../constants/checklist';
import type { StockRecommendation } from '../../../services/stockService';

interface ModalHeaderProps {
  stock: StockRecommendation;
}

export function ModalHeader({ stock }: ModalHeaderProps) {
  return (
    <div className="mb-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      {/* Left: name + badges */}
      <div className="flex flex-col gap-2 min-w-0 flex-1 pr-28 lg:pr-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h2 className="text-2xl sm:text-3xl lg:text-[34px] font-black tracking-tighter text-white break-words leading-tight">
            {stock.name}
          </h2>
          <span className="text-[11px] font-black text-white/60 bg-white/10 px-2.5 py-1 rounded-lg border border-white/15 tracking-[0.15em] uppercase">
            {stock.code}
          </span>
          {stock.isSectorTopPick && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg">
              <Award className="w-3 h-3" />
              <span className="text-[9px] font-black uppercase tracking-widest">Sector Top Pick</span>
            </div>
          )}
          {stock.aiConvictionScore?.marketPhase && (
            <div className={cn(
              "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border flex items-center gap-1.5 whitespace-nowrap",
              stock.aiConvictionScore.marketPhase === 'RISK_ON' || stock.aiConvictionScore.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
              stock.aiConvictionScore.marketPhase === 'RISK_OFF' || stock.aiConvictionScore.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" :
              stock.aiConvictionScore.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
              stock.aiConvictionScore.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
              "bg-white/10 text-white/40 border-white/10"
            )} title={getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).description}>
              {getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).label}
              <Info className="w-2.5 h-2.5 opacity-50" />
            </div>
          )}
          <a
            href={(() => {
              const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
              return cleanCode.length === 6
                ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name)}+주가`;
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-lg transition-all group/link active:scale-95"
          >
            <span className="text-[9px] font-black uppercase tracking-widest">Chart</span>
            <ExternalLink className="w-2.5 h-2.5 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-16 bg-gradient-to-r from-orange-500 via-orange-500/50 to-transparent rounded-full" />
          <Sparkles className="w-3 h-3 text-orange-500" />
          <span className="text-[9px] font-black text-orange-500 uppercase tracking-[0.3em]">Institutional Grade AI Analysis</span>
        </div>
      </div>

      {/* Right: compact stats strip */}
      <div className="flex items-stretch gap-0 bg-white/[0.03] rounded-2xl border border-white/10 backdrop-blur-xl overflow-hidden shrink-0">
        <div className="flex flex-col justify-center px-4 py-2.5 min-w-fit">
          <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.15em] mb-0.5">Current Price</span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg sm:text-xl font-black text-white tracking-tighter">₩{stock.currentPrice?.toLocaleString() || '0'}</span>
            <span className="text-[9px] font-bold text-white/20 uppercase">KRW</span>
          </div>
          {(stock.priceUpdatedAt || stock.dataSource) && (
            <div className="text-[8px] font-black text-white/30 uppercase tracking-tight mt-0.5 truncate max-w-[180px]">
              {stock.priceUpdatedAt} {stock.dataSource && `· ${stock.dataSource}`}
            </div>
          )}
          {stock.financialUpdatedAt && (
            <div className="text-[8px] font-black text-blue-400/40 uppercase tracking-tight mt-0.5 flex items-center gap-1">
              <ShieldCheck className="w-2 h-2" />
              DART {stock.financialUpdatedAt}
            </div>
          )}
        </div>
        <div className="w-px bg-white/10 self-stretch" />
        <div className="flex flex-col justify-center px-4 py-2.5 min-w-fit">
          <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.15em] mb-0.5">Value / Momentum</span>
          <div className="flex items-center gap-2">
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-blue-400">{stock.scores?.value || 0}</span>
              <span className="text-[8px] font-black text-white/20 uppercase">V</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-orange-400">{stock.scores?.momentum || 0}</span>
              <span className="text-[8px] font-black text-white/20 uppercase">M</span>
            </div>
          </div>
        </div>
        <div className="w-px bg-white/10 self-stretch" />
        <div className="flex flex-col justify-center px-4 py-2.5 min-w-fit">
          <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.15em] mb-0.5">AI Conviction</span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg sm:text-xl font-black text-orange-500 tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
            <span className="text-[9px] font-bold text-white/20">/ 100</span>
          </div>
        </div>
      </div>
    </div>
  );
}
