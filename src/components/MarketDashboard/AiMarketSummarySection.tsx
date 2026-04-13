import React from 'react';
import { Zap, Clock, TrendingUp } from 'lucide-react';

interface AiMarketSummarySectionProps {
  summary: string;
  lastUpdated: string;
}

export const AiMarketSummarySection: React.FC<AiMarketSummarySectionProps> = ({ summary, lastUpdated }) => (
  <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl relative overflow-hidden group hover:border-white/20 transition-all duration-700">
    <div className="absolute top-0 right-0 p-12 opacity-5 group-hover:opacity-10 transition-opacity duration-700">
      <TrendingUp size={200} />
    </div>
    <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-indigo-500/10 blur-[120px] rounded-full group-hover:bg-indigo-500/20 transition-all duration-1000" />
    <div className="absolute -right-20 -top-20 w-96 h-96 bg-purple-500/10 blur-[120px] rounded-full group-hover:bg-purple-500/20 transition-all duration-1000" />

    <div className="relative z-10">
      <div className="flex items-center gap-4 mb-8">
        <div className="bg-indigo-500/20 p-3 rounded-2xl border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.3)] group-hover:shadow-[0_0_40px_rgba(99,102,241,0.5)] transition-all duration-700">
          <Zap size={24} className="text-indigo-400 animate-pulse" />
        </div>
        <div>
          <span className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.4em] block mb-1">AI Institutional Grade Analysis</span>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter drop-shadow-2xl">실시간 시장 지능 요약</h2>
        </div>
      </div>
      <p className="text-xl md:text-3xl font-black text-white/90 leading-tight mb-8 max-w-4xl tracking-tighter drop-shadow-lg">
        {summary}
      </p>
      <div className="flex items-center gap-3 text-[10px] font-black text-white/20 uppercase tracking-widest">
        <Clock size={14} />
        <span>최종 업데이트: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '-'}</span>
      </div>
    </div>
  </div>
);
