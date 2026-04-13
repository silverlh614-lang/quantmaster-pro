import React from 'react';
import { MarketOverview } from '../services/stockService';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '../ui/cn';
import { debugWarn } from '../utils/debug';

interface MarketTickerProps {
  data: MarketOverview | null;
  loading: boolean;
  onRefresh: () => void;
}

export const MarketTicker: React.FC<MarketTickerProps> = ({ data, loading, onRefresh }) => {
  if (loading && !data) {
    return (
      <div className="h-10 bg-black/60 border-b border-white/5 flex items-center justify-center overflow-hidden">
        <div className="flex items-center gap-2 animate-pulse">
          <Activity className="w-3 h-3 text-indigo-400" />
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">실시간 시장 데이터 동기화 중...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    debugWarn('MarketTicker: market data 없음 - ticker 숨김');
    return (
      <div className="h-10 bg-black/60 border-b border-white/5 flex items-center justify-center">
        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">시장 데이터 대기 중...</span>
      </div>
    );
  }

  const mainIndices = (data.indices || []).filter(idx => 
    ['KOSPI', 'KOSDAQ', 'S&P 500', 'NASDAQ'].includes((idx.name || '').toUpperCase()) ||
    (idx.name || '').includes('코스피') || (idx.name || '').includes('코스닥')
  );

  return (
    <div className="h-10 bg-black/60 border-b border-white/5 flex items-center overflow-hidden relative group">
      <div className="absolute left-4 z-20 flex items-center gap-2 bg-black/80 px-3 py-1 rounded-full border border-white/10 backdrop-blur-md">
        <button 
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 group/btn"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full", loading ? "bg-indigo-500 animate-spin" : "bg-green-500 animate-pulse")} />
          <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter whitespace-nowrap group-hover/btn:text-white/60 transition-colors">
            LIVE: {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : 'SYNCING'}
          </span>
        </button>
      </div>

      <div className="flex items-center gap-8 pl-32 pr-6 animate-marquee whitespace-nowrap">
        {/* Repeat twice for seamless scrolling */}
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flex items-center gap-8">
            {mainIndices.map((idx, j) => {
              const isPositive = idx.change >= 0;
              return (
                <div key={`${i}-${j}`} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{idx.name}</span>
                  <span className="text-xs font-black text-white tracking-tighter font-num">{idx.value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <div className={cn(
                    "flex items-center text-[10px] font-black",
                    isPositive ? "text-red-400" : "text-blue-400"
                  )}>
                    {isPositive ? <TrendingUp size={10} className="mr-0.5" /> : <TrendingDown size={10} className="mr-0.5" />}
                    <span className="font-num">{isPositive ? '+' : ''}{idx.changePercent}%</span>
                  </div>
                </div>
              );
            })}
            {data.exchangeRates?.slice(0, 1).map((rate, j) => (
              <div key={`rate-${i}-${j}`} className="flex items-center gap-3">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{rate.name}</span>
                <span className="text-xs font-black text-white tracking-tighter font-num">{rate.value?.toLocaleString()}</span>
                <div className={cn(
                  "flex items-center text-[10px] font-black",
                  rate.change >= 0 ? "text-red-400" : "text-blue-400"
                )}>
                  {rate.change >= 0 ? '+' : ''}{rate.changePercent}%
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      
      {/* Gradient overlays for fade effect */}
      <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[#080B0F] to-transparent z-10" />
      <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[#080B0F] to-transparent z-10" />
      
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        .animate-marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
};
