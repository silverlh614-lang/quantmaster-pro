import React from 'react';
import { TrendingUp, TrendingDown, Minus, Users, Newspaper } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function SentimentSection({ stock }: Props) {
  return (
    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Analyst Sentiment */}
      <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <Users className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Analyst Sentiment</h3>
        </div>
        {stock.analystRatings ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-white/60 uppercase tracking-widest">Consensus</span>
              <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest",
                (stock.analystRatings.consensus?.toLowerCase().includes('buy') ?? false) ? 'bg-green-500/20 text-green-400' :
                (stock.analystRatings.consensus?.toLowerCase().includes('sell') ?? false) ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
              )}>
                {stock.analystRatings.consensus}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Buy</span>
                <span className="text-xl font-black text-red-500">{stock.analystRatings?.strongBuy}</span>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Buy</span>
                <span className="text-xl font-black text-orange-400">{stock.analystRatings?.buy}</span>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Sell</span>
                <span className="text-xl font-black text-blue-600">{stock.analystRatings?.strongSell}</span>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Sell</span>
                <span className="text-xl font-black text-blue-400">{stock.analystRatings?.sell}</span>
              </div>
            </div>

            <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
              <span className="text-[10px] font-black text-white/40 uppercase block mb-2">Target Price Range</span>
              <div className="flex justify-between items-center">
                <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceLow?.toLocaleString() || '0'}</span>
                <div className="flex-1 h-1 bg-white/10 mx-4 rounded-full relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
                </div>
                <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceHigh?.toLocaleString() || '0'}</span>
              </div>
              <div className="text-center mt-2">
                <span className="text-xs font-black text-blue-400">Avg: ₩{stock.analystRatings?.targetPriceAvg?.toLocaleString() || '0'}</span>
              </div>
            </div>

            {stock.analystSentiment && (
              <p className="text-sm text-white/70 leading-relaxed font-bold italic border-l-2 border-blue-500/30 pl-4 break-words">
                "{stock.analystSentiment}"
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-white/30 font-bold">No analyst data available</p>
        )}
      </div>

      {/* News Sentiment */}
      <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <Newspaper className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">News Sentiment</h3>
        </div>
        {stock.newsSentiment ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-white/60 uppercase tracking-widest">Status</span>
              <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest flex items-center gap-2",
                stock.newsSentiment.status === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                stock.newsSentiment.status === 'NEGATIVE' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
              )}>
                {stock.newsSentiment.status === 'POSITIVE' && <TrendingUp className="w-4 h-4" />}
                {stock.newsSentiment.status === 'NEGATIVE' && <TrendingDown className="w-4 h-4" />}
                {stock.newsSentiment.status === 'NEUTRAL' && <Minus className="w-4 h-4" />}
                {stock.newsSentiment.status}
              </span>
            </div>

            <div className="bg-black/20 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
              <div className="relative z-10 flex flex-col items-center">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Sentiment Score</span>
                <div className="text-5xl font-black mb-2" style={{
                  color: stock.newsSentiment.score >= 60 ? '#34d399' : stock.newsSentiment.score <= 40 ? '#f87171' : '#9ca3af'
                }}>
                  {stock.newsSentiment.score}
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-4">
                  <div
                    className={cn("h-full rounded-full transition-all duration-1000",
                      stock.newsSentiment.score >= 60 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' :
                      stock.newsSentiment.score <= 40 ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]' : 'bg-gray-400'
                    )}
                    style={{ width: `${stock.newsSentiment.score}%` }}
                  />
                </div>
              </div>
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
            </div>

            <p className="text-sm text-white/80 leading-relaxed font-bold bg-white/5 p-5 rounded-2xl border border-white/5 break-words">
              {stock.newsSentiment.summary}
            </p>
          </div>
        ) : (
          <p className="text-sm text-white/30 font-bold">No news sentiment data available</p>
        )}
      </div>
    </div>
  );
}
