import React from 'react';
import { Activity, TrendingUp, Zap, Sparkles, Target } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function TechnicalAnalysisColumn({ stock }: Props) {
  return (
    <>
      {/* Technical Indicators Grid */}
      <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10 relative overflow-hidden group/card">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Technical Indicators</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">MA Alignment</span>
            <div className={cn(
              "px-3 py-2 rounded-xl text-xs font-black text-center border",
              stock.technicalSignals?.maAlignment === 'BULLISH' ? "bg-green-500/10 text-green-400 border-green-500/20" :
              stock.technicalSignals?.maAlignment === 'BEARISH' ? "bg-red-500/10 text-red-400 border-red-500/20" :
              "bg-white/5 text-white/40 border-white/10"
            )}>
              {stock.technicalSignals?.maAlignment}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">RSI (14)</span>
            <div className="px-3 py-2 rounded-xl text-xs font-black text-center bg-white/5 border border-white/10 text-white/80">
              {stock.technicalSignals?.rsi}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">MACD Status</span>
            <div className={cn(
              "px-3 py-2 rounded-xl text-xs font-black text-center border",
              stock.technicalSignals?.macdStatus === 'GOLDEN_CROSS' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
              "bg-white/5 text-white/40 border-white/10"
            )}>
              {stock.technicalSignals?.macdStatus?.replace('_', ' ')}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Ichimoku</span>
            <div className={cn(
              "px-3 py-2 rounded-xl text-[10px] font-black text-center border",
              stock.ichimokuStatus === 'ABOVE_CLOUD' ? "bg-green-500/10 text-green-400 border-green-500/20" :
              stock.ichimokuStatus === 'BELOW_CLOUD' ? "bg-red-500/10 text-red-400 border-red-500/20" :
              "bg-white/5 text-white/40 border-white/10"
            )}>
              {stock.ichimokuStatus?.replace('_', ' ')}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Volume Surge</span>
            <span className={cn("text-xs font-black", stock.technicalSignals?.volumeSurge ? "text-orange-400" : "text-white/20")}>
              {stock.technicalSignals?.volumeSurge ? "DETECTED" : "NORMAL"}
            </span>
          </div>
          <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Disparity (20)</span>
            <span className={cn("text-xs font-black",
              (stock.technicalSignals?.disparity20 || 100) > 105 ? "text-red-400" :
              (stock.technicalSignals?.disparity20 || 100) < 95 ? "text-green-400" : "text-white/60"
            )}>
              {stock.technicalSignals?.disparity20}%
            </span>
          </div>
        </div>

        {/* Elliott Wave & Chart Pattern */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {stock.elliottWaveStatus && (
            <div className="bg-gradient-to-br from-indigo-500/10 to-purple-600/5 rounded-3xl p-5 border border-indigo-500/20">
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Elliott Wave Status</span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg font-black text-indigo-400">{(stock.elliottWaveStatus.wave || '').replace('_', ' ')}</span>
              </div>
              <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                {stock.elliottWaveStatus.description}
              </p>
            </div>
          )}

          {stock.chartPattern && (
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/5 rounded-3xl p-5 border border-emerald-500/20">
              <div className="flex items-center gap-3 mb-3">
                <Target className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Chart Pattern</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black text-white uppercase">{stock.chartPattern.name}</span>
                <div className={cn("px-2 py-0.5 rounded-md text-[9px] font-black border",
                  (stock.chartPattern.type || '').includes('BULLISH') ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                  (stock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                  "bg-white/5 text-white/40 border-white/10"
                )}>
                  {(stock.chartPattern.type || '').replace('_', ' ')}
                </div>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${stock.chartPattern.reliability}%` }} />
                </div>
                <span className="text-[9px] font-black text-white/40">{stock.chartPattern.reliability}% Reliability</span>
              </div>
              <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                {stock.chartPattern.description}
              </p>
            </div>
          )}
        </div>

        {/* Technical Details */}
        <div className="mt-8 space-y-4">
          {stock.technicalSignals?.macdHistogramDetail && (
            <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]",
                    stock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500 shadow-green-500/50' :
                    stock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500 shadow-red-500/50' : 'bg-gray-400'
                  )} />
                  <span className="text-xs font-black text-white/60 uppercase tracking-widest">MACD Histogram</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-white">{stock.technicalSignals.macdHistogram?.toFixed(2) || 'N/A'}</span>
                  <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                    stock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500/20 text-green-400' :
                    stock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/60'
                  )}>
                    {stock.technicalSignals.macdHistogramDetail.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                {stock.technicalSignals.macdHistogramDetail.implication}
              </p>
            </div>
          )}

          {stock.technicalSignals?.bbWidthDetail && (
            <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]",
                    stock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500 shadow-orange-500/50' :
                    stock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500 shadow-blue-500/50' : 'bg-gray-400'
                  )} />
                  <span className="text-xs font-black text-white/60 uppercase tracking-widest">Bollinger Band Width</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-white">{stock.technicalSignals.bbWidth?.toFixed(3) || 'N/A'}</span>
                  <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                    stock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500/20 text-orange-400' :
                    stock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/60'
                  )}>
                    {stock.technicalSignals.bbWidthDetail.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                {stock.technicalSignals.bbWidthDetail.implication}
              </p>
            </div>
          )}

          {stock.technicalSignals?.stochRsiDetail && (
            <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]",
                    stock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500 shadow-red-500/50' :
                    stock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500 shadow-green-500/50' : 'bg-gray-400'
                  )} />
                  <span className="text-xs font-black text-white/60 uppercase tracking-widest">Stochastic RSI</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-white">{stock.technicalSignals.stochRsi?.toFixed(2) || 'N/A'}</span>
                  <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                    stock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500/20 text-red-400' :
                    stock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60'
                  )}>
                    {stock.technicalSignals.stochRsiDetail.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                {stock.technicalSignals.stochRsiDetail.implication}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Elliott Wave & Strategic Insight */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <Zap className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Elliott Wave</h3>
          </div>
          {stock.elliottWaveStatus ? (
            <div className="space-y-4">
              <div className="inline-block px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-black">
                {(stock.elliottWaveStatus.wave || '').replace('_', ' ')}
              </div>
              <p className="text-sm text-white/70 leading-relaxed font-bold italic break-words">
                "{stock.elliottWaveStatus.description}"
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/30 font-bold">No wave data available</p>
          )}
        </div>

        {/* Chart Pattern Analysis */}
        <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Chart Pattern Analysis</h3>
          </div>
          {stock.chartPattern ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-black border",
                  (stock.chartPattern.type || '').includes('BULLISH') ? "bg-green-500/20 text-green-400 border-green-500/30" :
                  (stock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                  "bg-blue-500/20 text-blue-400 border-blue-500/30"
                )}>
                  {stock.chartPattern.name} ({(stock.chartPattern.type || '').replace('_', ' ')})
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Reliability</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        style={{ width: `${stock.chartPattern.reliability}%` }}
                      />
                    </div>
                    <span className="text-xs font-black text-white">{stock.chartPattern.reliability}%</span>
                  </div>
                </div>
              </div>
              <div className="bg-black/20 p-5 rounded-3xl border border-white/5">
                <p className="text-sm text-white/80 leading-relaxed font-bold italic">
                  "{stock.chartPattern.description}"
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/30 font-bold">No chart pattern identified</p>
          )}
        </div>

        <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Strategic Insight</h3>
          </div>
          {stock.strategicInsight ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Cycle Position</span>
                <span className={cn("text-xs font-black px-2 py-0.5 rounded-md",
                  stock.strategicInsight.cyclePosition === 'NEW_LEADER' ? 'bg-green-500/20 text-green-400' :
                  stock.strategicInsight.cyclePosition === 'MATURING' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                )}>
                  {(stock.strategicInsight.cyclePosition || '').replace('_', ' ')}
                </span>
              </div>
              <div className="space-y-3">
                <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                  <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Earnings Quality</span>
                  <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.strategicInsight.earningsQuality}</p>
                </div>
                <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                  <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Policy Context</span>
                  <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.strategicInsight.policyContext}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/30 font-bold">No strategic insight available</p>
          )}
        </div>
      </div>
    </>
  );
}
