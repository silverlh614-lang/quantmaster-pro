/**
 * Neo-Brutalism Status Banner
 * One-line "현재 상태 요약" at the top of the main content area.
 * Shows: market phase, recommended position, watchlist count, gate average.
 */
import React from 'react';
import { Activity, Eye, Target, TrendingUp, Zap } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore, useGlobalIntelStore } from '../../stores';
import { useTradeStore } from '../../stores';

export function StatusBanner() {
  const { recommendations, watchlist } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);

  const regime = bearRegimeResult?.regime ?? 'BULL';

  // Market phase label + color
  const phaseConfig = {
    BULL: { label: 'BULL PHASE', color: 'text-green-400', dot: 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]' },
    TRANSITION: { label: 'TRANSITION', color: 'text-yellow-400', dot: 'bg-yellow-400 shadow-[0_0_6px_rgba(234,179,8,0.6)]' },
    BEAR: { label: 'BEAR PHASE', color: 'text-red-400', dot: 'bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.6)]' },
  }[regime] ?? { label: 'BULL PHASE', color: 'text-green-400', dot: 'bg-green-400' };

  // Recommended position based on market neutral / regime
  const cashRatio = marketNeutralResult?.recommended?.cashRatio ?? (regime === 'BEAR' ? 50 : regime === 'TRANSITION' ? 30 : 10);
  const positionPct = 100 - cashRatio;

  // Counts
  const watchlistCount = (watchlist || []).length;
  const openTrades = tradeRecords.filter(t => t.status === 'OPEN').length;

  // Gate average score
  const scores = (recommendations || [])
    .map(r => r.aiConvictionScore?.totalScore)
    .filter((s): s is number => s != null);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  return (
    <div className="neo-status-banner no-print" role="banner">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-11 flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar">
        {/* Market Phase */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('w-2 h-2 rounded-full', phaseConfig.dot)} />
          <span className={cn('text-[11px] font-black uppercase tracking-[0.12em] font-num', phaseConfig.color)}>
            {phaseConfig.label}
          </span>
        </div>

        <Separator />

        {/* Recommended Position */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Target className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest hidden sm:inline">포지션</span>
          <span className={cn(
            'text-[11px] font-black font-num',
            positionPct >= 70 ? 'text-green-400' : positionPct >= 40 ? 'text-yellow-400' : 'text-red-400'
          )}>
            {positionPct}%
          </span>
        </div>

        <Separator />

        {/* Gate Average */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Zap className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest hidden sm:inline">Gate</span>
          <span className={cn(
            'text-[11px] font-black font-num',
            avgScore >= 80 ? 'text-green-400' : avgScore >= 60 ? 'text-yellow-400' : avgScore > 0 ? 'text-red-400' : 'text-theme-text-muted'
          )}>
            {avgScore > 0 ? avgScore : '--'}
          </span>
        </div>

        <Separator />

        {/* Watchlist Count */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Eye className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest hidden sm:inline">감시</span>
          <span className="text-[11px] font-black text-blue-400 font-num">{watchlistCount}개</span>
        </div>

        <Separator />

        {/* Open Trades */}
        <div className="flex items-center gap-1.5 shrink-0">
          <TrendingUp className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest hidden sm:inline">보유</span>
          <span className="text-[11px] font-black text-orange-400 font-num">{openTrades}건</span>
        </div>

        {/* AI Recommendations count - desktop */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto">
          <Activity className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest">
            AI 추천 {(recommendations || []).length}건
          </span>
        </div>
      </div>
    </div>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-white/10 shrink-0" />;
}
