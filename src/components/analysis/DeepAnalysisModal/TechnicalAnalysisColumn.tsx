// @responsibility analysis 영역 TechnicalAnalysisColumn 컴포넌트
import React from 'react';
import { Activity, TrendingUp, Zap, Sparkles, Target } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

function formatStatusToken(value: string | undefined): string | undefined {
  return value?.replace('_', ' ');
}

function resolveMaAlignmentClass(value: string | undefined): string {
  if (value === 'BULLISH') return 'bg-green-500/10 text-green-400 border-green-500/20';
  if (value === 'BEARISH') return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-white/5 text-white/40 border-white/10';
}

function resolveMacdStatusClass(value: string | undefined): string {
  return value === 'GOLDEN_CROSS'
    ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
    : 'bg-white/5 text-white/40 border-white/10';
}

function resolveIchimokuClass(value: string | undefined): string {
  if (value === 'ABOVE_CLOUD') return 'bg-green-500/10 text-green-400 border-green-500/20';
  if (value === 'BELOW_CLOUD') return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-white/5 text-white/40 border-white/10';
}

function resolveDisparityClass(value: number | undefined): string {
  const normalized = value || 100;
  if (normalized > 105) return 'text-red-400';
  if (normalized < 95) return 'text-green-400';
  return 'text-white/60';
}

function resolveChartPatternTypeClass(type: string | undefined, bullishClass: string, neutralClass: string): string {
  const value = type || '';
  if (value.includes('BULLISH')) return bullishClass;
  if (value.includes('BEARISH')) return 'bg-red-500/20 text-red-400 border-red-500/30';
  return neutralClass;
}

function TechnicalIndicatorPill({
  label,
  value,
  className,
  textSizeClass = 'text-xs',
}: {
  label: string;
  value: React.ReactNode;
  className: string;
  textSizeClass?: string;
}) {
  return (
    <div className="space-y-2">
      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">{label}</span>
      <div className={cn('px-3 py-2 rounded-xl font-black text-center border', textSizeClass, className)}>
        {value}
      </div>
    </div>
  );
}

function CompactMetricRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName: string;
}) {
  return (
    <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
      <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">{label}</span>
      <span className={cn('text-xs font-black', valueClassName)}>{value}</span>
    </div>
  );
}

function TechnicalIndicatorsGrid({ stock }: Props) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TechnicalIndicatorPill
          label="MA Alignment"
          value={stock.technicalSignals?.maAlignment}
          className={resolveMaAlignmentClass(stock.technicalSignals?.maAlignment)}
        />
        <TechnicalIndicatorPill
          label="RSI (14)"
          value={stock.technicalSignals?.rsi}
          className="bg-white/5 border-white/10 text-white/80"
        />
        <TechnicalIndicatorPill
          label="MACD Status"
          value={formatStatusToken(stock.technicalSignals?.macdStatus)}
          className={resolveMacdStatusClass(stock.technicalSignals?.macdStatus)}
        />
        <TechnicalIndicatorPill
          label="Ichimoku"
          value={formatStatusToken(stock.ichimokuStatus)}
          className={resolveIchimokuClass(stock.ichimokuStatus)}
          textSizeClass="text-[10px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <CompactMetricRow
          label="Volume Surge"
          value={stock.technicalSignals?.volumeSurge ? 'DETECTED' : 'NORMAL'}
          valueClassName={stock.technicalSignals?.volumeSurge ? 'text-orange-400' : 'text-white/20'}
        />
        <CompactMetricRow
          label="Disparity (20)"
          value={`${stock.technicalSignals?.disparity20}%`}
          valueClassName={resolveDisparityClass(stock.technicalSignals?.disparity20)}
        />
      </div>
    </>
  );
}

function ElliottWaveMiniCard({ stock }: Props) {
  if (!stock.elliottWaveStatus) return null;
  return (
    <div className="bg-gradient-to-br from-indigo-500/10 to-purple-600/5 rounded-3xl p-5 border border-indigo-500/20">
      <div className="flex items-center gap-3 mb-3">
        <Activity className="w-4 h-4 text-indigo-400" />
        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Elliott Wave Status</span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-lg font-black text-indigo-400">{formatStatusToken(stock.elliottWaveStatus.wave || '')}</span>
      </div>
      <p className="text-[11px] text-white/70 font-bold leading-relaxed">
        {stock.elliottWaveStatus.description}
      </p>
    </div>
  );
}

function ChartPatternMiniCard({ stock }: Props) {
  if (!stock.chartPattern) return null;
  return (
    <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/5 rounded-3xl p-5 border border-emerald-500/20">
      <div className="flex items-center gap-3 mb-3">
        <Target className="w-4 h-4 text-emerald-400" />
        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Chart Pattern</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-black text-white uppercase">{stock.chartPattern.name}</span>
        <div className={cn(
          'px-2 py-0.5 rounded-md text-[9px] font-black border',
          resolveChartPatternTypeClass(
            stock.chartPattern.type,
            'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            'bg-white/5 text-white/40 border-white/10',
          ),
        )}>
          {formatStatusToken(stock.chartPattern.type || '')}
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
  );
}

function TechnicalPatternCards({ stock }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
      <ElliottWaveMiniCard stock={stock} />
      <ChartPatternMiniCard stock={stock} />
    </div>
  );
}

function resolveMacdDetailDotClass(status: string): string {
  if (status === 'BULLISH') return 'bg-green-500 shadow-green-500/50';
  if (status === 'BEARISH') return 'bg-red-500 shadow-red-500/50';
  return 'bg-gray-400';
}

function resolveMacdDetailBadgeClass(status: string): string {
  if (status === 'BULLISH') return 'bg-green-500/20 text-green-400';
  if (status === 'BEARISH') return 'bg-red-500/20 text-red-400';
  return 'bg-white/10 text-white/60';
}

function resolveBbWidthDotClass(status: string): string {
  if (status === 'EXPANSION') return 'bg-orange-500 shadow-orange-500/50';
  if (status === 'SQUEEZE') return 'bg-blue-500 shadow-blue-500/50';
  return 'bg-gray-400';
}

function resolveBbWidthBadgeClass(status: string): string {
  if (status === 'EXPANSION') return 'bg-orange-500/20 text-orange-400';
  if (status === 'SQUEEZE') return 'bg-blue-500/20 text-blue-400';
  return 'bg-white/10 text-white/60';
}

function resolveStochRsiDotClass(status: string): string {
  if (status === 'OVERBOUGHT') return 'bg-red-500 shadow-red-500/50';
  if (status === 'OVERSOLD') return 'bg-green-500 shadow-green-500/50';
  return 'bg-gray-400';
}

function resolveStochRsiBadgeClass(status: string): string {
  if (status === 'OVERBOUGHT') return 'bg-red-500/20 text-red-400';
  if (status === 'OVERSOLD') return 'bg-green-500/20 text-green-400';
  return 'bg-white/10 text-white/60';
}

function TechnicalDetailCard({
  title,
  value,
  status,
  implication,
  dotClassName,
  badgeClassName,
}: {
  title: string;
  value: string;
  status: string;
  implication: string;
  dotClassName: string;
  badgeClassName: string;
}) {
  return (
    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]', dotClassName)} />
          <span className="text-xs font-black text-white/60 uppercase tracking-widest">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-white">{value}</span>
          <span className={cn('text-[10px] px-2 py-1 rounded-md font-black tracking-widest', badgeClassName)}>
            {status}
          </span>
        </div>
      </div>
      <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
        {implication}
      </p>
    </div>
  );
}

function TechnicalDetailCards({ stock }: Props) {
  const signals = stock.technicalSignals;
  return (
    <div className="mt-8 space-y-4">
      {signals?.macdHistogramDetail && (
        <TechnicalDetailCard
          title="MACD Histogram"
          value={signals.macdHistogram?.toFixed(2) || 'N/A'}
          status={signals.macdHistogramDetail.status}
          implication={signals.macdHistogramDetail.implication}
          dotClassName={resolveMacdDetailDotClass(signals.macdHistogramDetail.status)}
          badgeClassName={resolveMacdDetailBadgeClass(signals.macdHistogramDetail.status)}
        />
      )}
      {signals?.bbWidthDetail && (
        <TechnicalDetailCard
          title="Bollinger Band Width"
          value={signals.bbWidth?.toFixed(3) || 'N/A'}
          status={signals.bbWidthDetail.status}
          implication={signals.bbWidthDetail.implication}
          dotClassName={resolveBbWidthDotClass(signals.bbWidthDetail.status)}
          badgeClassName={resolveBbWidthBadgeClass(signals.bbWidthDetail.status)}
        />
      )}
      {signals?.stochRsiDetail && (
        <TechnicalDetailCard
          title="Stochastic RSI"
          value={signals.stochRsi?.toFixed(2) || 'N/A'}
          status={signals.stochRsiDetail.status}
          implication={signals.stochRsiDetail.implication}
          dotClassName={resolveStochRsiDotClass(signals.stochRsiDetail.status)}
          badgeClassName={resolveStochRsiBadgeClass(signals.stochRsiDetail.status)}
        />
      )}
    </div>
  );
}

function TechnicalIndicatorsPanel({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group/card">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Technical Indicators</h3>
      </div>
      <TechnicalIndicatorsGrid stock={stock} />
      <TechnicalPatternCards stock={stock} />
      <TechnicalDetailCards stock={stock} />
    </div>
  );
}

function ElliottWaveSummaryCard({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <Zap className="w-5 h-5 text-yellow-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Elliott Wave</h3>
      </div>
      {stock.elliottWaveStatus ? (
        <div className="space-y-4">
          <div className="inline-block px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-black">
            {formatStatusToken(stock.elliottWaveStatus.wave || '')}
          </div>
          <p className="text-sm text-white/70 leading-relaxed font-bold italic break-words">
            "{stock.elliottWaveStatus.description}"
          </p>
        </div>
      ) : (
        <p className="text-sm text-white/30 font-bold">No wave data available</p>
      )}
    </div>
  );
}

function ChartPatternAnalysisCard({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Chart Pattern Analysis</h3>
      </div>
      {stock.chartPattern ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className={cn(
              'px-4 py-1.5 rounded-full text-xs font-black border',
              resolveChartPatternTypeClass(
                stock.chartPattern.type,
                'bg-green-500/20 text-green-400 border-green-500/30',
                'bg-blue-500/20 text-blue-400 border-blue-500/30',
              ),
            )}>
              {stock.chartPattern.name} ({formatStatusToken(stock.chartPattern.type || '')})
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
  );
}

function resolveCyclePositionClass(value: string | undefined): string {
  if (value === 'NEW_LEADER') return 'bg-green-500/20 text-green-400';
  if (value === 'MATURING') return 'bg-blue-500/20 text-blue-400';
  return 'bg-red-500/20 text-red-400';
}

function StrategicInsightDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
      <span className="text-[9px] font-black text-white/30 uppercase block mb-1">{label}</span>
      <p className="text-xs text-white/70 font-bold leading-relaxed">{value}</p>
    </div>
  );
}

function StrategicInsightCard({ stock }: Props) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
      <div className="flex items-center gap-3 mb-4">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h3 className="text-lg font-black text-white uppercase tracking-tight">Strategic Insight</h3>
      </div>
      {stock.strategicInsight ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Cycle Position</span>
            <span className={cn('text-xs font-black px-2 py-0.5 rounded-md', resolveCyclePositionClass(stock.strategicInsight.cyclePosition))}>
              {formatStatusToken(stock.strategicInsight.cyclePosition || '')}
            </span>
          </div>
          <div className="space-y-3">
            <StrategicInsightDetail label="Earnings Quality" value={stock.strategicInsight.earningsQuality} />
            <StrategicInsightDetail label="Policy Context" value={stock.strategicInsight.policyContext} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-white/30 font-bold">No strategic insight available</p>
      )}
    </div>
  );
}

function TechnicalStrategicGrid({ stock }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <ElliottWaveSummaryCard stock={stock} />
      <ChartPatternAnalysisCard stock={stock} />
      <StrategicInsightCard stock={stock} />
    </div>
  );
}

export function TechnicalAnalysisColumn({ stock }: Props) {
  return (
    <>
      <TechnicalIndicatorsPanel stock={stock} />
      <TechnicalStrategicGrid stock={stock} />
    </>
  );
}
