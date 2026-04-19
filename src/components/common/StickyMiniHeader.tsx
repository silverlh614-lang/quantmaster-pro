/**
 * Neo-Brutalism Sticky Mini Header
 * Scroll-aware compact header with bold border + semantic colors.
 */
import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore, useMarketStore } from '../../stores';
import { AppMenuButton } from '../../layout/AppMenuButton';

export function StickyMiniHeader() {
  const [isVisible, setIsVisible] = useState(false);
  const { recommendations, watchlist, lastUpdated } = useRecommendationStore();
  const { syncStatus } = useMarketStore();

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > 200);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!isVisible) return null;

  const totalCount = (recommendations || []).length;
  const watchlistCount = (watchlist || []).length;

  // Calculate average gate score
  const scores = (recommendations || [])
    .map(r => r.aiConvictionScore?.totalScore)
    .filter((s): s is number => s != null);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const updateTime = (() => {
    if (!lastUpdated) return '--:--';
    const d = new Date(lastUpdated);
    if (Number.isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[45] lg:left-[var(--sidebar-width)]',
        'h-10 flex items-center justify-between px-4 gap-4',
        'border-b-2 border-slate-700/30 backdrop-blur-xl',
        'animate-fade-slide-up no-print'
      )}
      style={{ background: 'rgba(6, 9, 13, 0.92)' }}
    >
      {/* 모바일/태블릿 햄버거 (데스크톱에선 CSS 로 숨김) */}
      <AppMenuButton className="!h-8 !w-8 shrink-0" />

      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
        {/* Stock Count */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">AI추천</span>
          <span className="text-[11px] font-black text-violet-400 font-num">{totalCount}건</span>
        </div>

        <div className="w-px h-3.5 bg-slate-700/40 shrink-0" />

        {/* Watchlist */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">관심</span>
          <span className="text-[11px] font-black text-blue-400 font-num">{watchlistCount}</span>
        </div>

        <div className="w-px h-3.5 bg-slate-700/40 shrink-0" />

        {/* Average Score */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">Gate평균</span>
          <span className={cn(
            'text-[11px] font-black font-num',
            avgScore >= 80 ? 'text-green-400' : avgScore >= 60 ? 'text-yellow-400' : avgScore > 0 ? 'text-red-400' : 'text-theme-text-secondary'
          )}>
            {avgScore}
          </span>
        </div>

        <div className="w-px h-3.5 bg-slate-700/40 shrink-0" />

        {/* Last Update */}
        <div className="flex items-center gap-1.5 shrink-0">
          {syncStatus.isSyncing ? (
            <RefreshCw className="w-3 h-3 text-orange-400 animate-spin" />
          ) : (
            <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">&#8634;</span>
          )}
          <span className="text-[11px] font-black text-theme-text-secondary font-num">{updateTime}</span>
        </div>
      </div>
    </div>
  );
}
