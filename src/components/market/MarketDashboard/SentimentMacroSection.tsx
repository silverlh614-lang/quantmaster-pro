import React from 'react';
import { MessageSquare, Hash, Globe } from 'lucide-react';
import { cn } from '../../../ui/cn';

interface SnsSentiment {
  score: number;
  status: string;
  summary: string;
  trendingKeywords?: string[];
}

interface MarketDataPoint {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

interface SentimentMacroSectionProps {
  snsSentiment?: SnsSentiment;
  exchangeRates?: MarketDataPoint[];
  commodities?: MarketDataPoint[];
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'EXTREME_GREED': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
    case 'GREED': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    case 'NEUTRAL': return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    case 'FEAR': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
    case 'EXTREME_FEAR': return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
    default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'EXTREME_GREED': return '극도의 탐욕';
    case 'GREED': return '탐욕';
    case 'NEUTRAL': return '중립';
    case 'FEAR': return '공포';
    case 'EXTREME_FEAR': return '극도의 공포';
    default: return status;
  }
};

const SnsSentimentCard = ({ sentiment }: { sentiment: SnsSentiment }) => (
  <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
    <div className="flex items-center justify-between mb-8">
      <h3 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-3">
        <MessageSquare className="w-5 h-5 text-indigo-400" />
        SNS 시장 참여자 분위기
      </h3>
      <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black border uppercase tracking-widest", getStatusColor(sentiment.status))}>
        {getStatusLabel(sentiment.status)}
      </div>
    </div>

    <div className="flex flex-col md:flex-row gap-10 items-center">
      <div className="relative w-48 h-48 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="96" cy="96" r="84" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="16" />
          <circle
            cx="96"
            cy="96"
            r="84"
            fill="none"
            stroke="currentColor"
            strokeWidth="16"
            strokeDasharray={527}
            strokeDashoffset={527 - (527 * sentiment.score) / 100}
            strokeLinecap="round"
            className={cn("transition-all duration-1000", getStatusColor(sentiment.status).split(' ')[0])}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-fluid-5xl font-black text-white tracking-tighter">{sentiment.score}</span>
          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mt-1">Sentiment</span>
        </div>
      </div>

      <div className="flex-1 space-y-6">
        <div className="bg-white/5 p-6 rounded-3xl border border-white/5 italic">
          <p className="text-base text-white/70 leading-relaxed font-medium">
            "{sentiment.summary}"
          </p>
        </div>

        <div>
          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-3 block">실시간 트렌드 키워드</span>
          <div className="flex flex-wrap gap-2">
            {sentiment.trendingKeywords?.map((keyword, idx) => (
              <div key={idx} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-white/60 rounded-xl text-xs font-black border border-white/10 hover:bg-white/10 transition-colors cursor-default">
                <Hash size={12} className="text-indigo-400" />
                {keyword}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const SentimentMacroSection: React.FC<SentimentMacroSectionProps> = React.memo(({
  snsSentiment,
  exchangeRates,
  commodities,
}) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
    {snsSentiment && <SnsSentimentCard sentiment={snsSentiment} />}

    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
      <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-8 flex items-center gap-3">
        <Globe className="w-5 h-5 text-emerald-400" />
        거시 지표 및 환율
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {exchangeRates?.slice(0, 2).map((idx, i) => (
          <div key={`${idx.name}-${i}`} className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">{idx.name}</span>
            <div className="flex items-center justify-between">
              <span className="text-lg font-black text-white">{idx.value?.toLocaleString() || '0'}</span>
              <span className={cn("text-[10px] font-black", idx.change >= 0 ? "text-red-400" : "text-blue-400")}>
                {idx.change >= 0 ? '+' : ''}{idx.changePercent}%
              </span>
            </div>
          </div>
        ))}
        {commodities?.map((idx, i) => (
          <div key={`${idx.name}-${i}`} className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">{idx.name}</span>
            <div className="flex items-center justify-between">
              <span className="text-lg font-black text-white">{idx.value?.toLocaleString() || '0'}</span>
              <span className={cn("text-[10px] font-black", idx.change >= 0 ? "text-red-400" : "text-blue-400")}>
                {idx.change >= 0 ? '+' : ''}{idx.changePercent}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
));
