import React from 'react';
import {
  Zap, LayoutGrid, Bookmark, Filter, Radar, Calculator,
  History, Shield, Activity, TrendingUp, ShieldCheck, Settings
} from 'lucide-react';
import { cn } from '../ui/cn';
import { useSettingsStore, useRecommendationStore, useTradeStore, useMarketStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { TradeRecord } from '../types/quant';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  activeColor: string;
  count?: number;
  group: 'discover' | 'analysis' | 'strategy' | 'journal';
}

export function AppHeader() {
  const { view, setView, showSettings, setShowSettings, showMasterChecklist, setShowMasterChecklist, lastUpdated } = useSettingsStore();
  const { watchlist, setSearchQuery } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { syncStatus } = useMarketStore();
  const { shadowTrades } = useShadowTradeStore();

  const navItems: NavItem[] = [
    { id: 'DISCOVER', label: '탐색', icon: LayoutGrid, activeColor: 'orange', group: 'discover' },
    { id: 'WATCHLIST', label: '관심 목록', icon: Bookmark, activeColor: 'orange', count: (watchlist || []).length, group: 'discover' },
    { id: 'SCREENER', label: '스크리너', icon: Filter, activeColor: 'blue', group: 'analysis' },
    { id: 'SUBSCRIPTION', label: '구독', icon: Radar, activeColor: 'amber', group: 'analysis' },
    { id: 'MANUAL_INPUT', label: '수동 퀀트', icon: Calculator, activeColor: 'indigo', group: 'analysis' },
    { id: 'BACKTEST', label: '백테스트', icon: History, activeColor: 'blue', group: 'strategy' },
    { id: 'WALK_FORWARD', label: '워크포워드', icon: Shield, activeColor: 'purple', group: 'strategy' },
    { id: 'MARKET', label: '시장', icon: Activity, activeColor: 'indigo', group: 'strategy' },
    { id: 'TRADE_JOURNAL', label: '매매일지', icon: TrendingUp, activeColor: 'emerald', count: tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length, group: 'journal' },
    { id: 'AUTO_TRADE', label: '자동매매', icon: Zap, activeColor: 'violet', count: shadowTrades.length, group: 'journal' },
  ];

  const colorMap: Record<string, { active: string; badge: string }> = {
    orange: { active: 'bg-orange-500/15 text-orange-400 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.25)]', badge: 'bg-orange-500/25 text-orange-300' },
    blue: { active: 'bg-blue-500/15 text-blue-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]', badge: 'bg-blue-500/25 text-blue-300' },
    amber: { active: 'bg-amber-500/15 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]', badge: 'bg-amber-500/25 text-amber-300' },
    indigo: { active: 'bg-indigo-500/15 text-indigo-400 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]', badge: 'bg-indigo-500/25 text-indigo-300' },
    purple: { active: 'bg-purple-500/15 text-purple-400 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.25)]', badge: 'bg-purple-500/25 text-purple-300' },
    emerald: { active: 'bg-emerald-500/15 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]', badge: 'bg-emerald-500/25 text-emerald-300' },
    violet: { active: 'bg-violet-500/15 text-violet-400 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.25)]', badge: 'bg-violet-500/25 text-violet-300' },
  };

  const groups = ['discover', 'analysis', 'strategy', 'journal'] as const;

  return (
    <header className="border-b border-theme-border bg-theme-bg/80 backdrop-blur-2xl sticky top-0 z-50 shadow-[0_2px_30px_rgba(0,0,0,0.3)] no-print">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-[56px] sm:h-[60px] flex items-center justify-between gap-3 sm:gap-4">


              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            {syncStatus.isSyncing && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[var(--bg-app)] animate-pulse" />
            )}
          </div>
          <div className="hidden sm:flex flex-col leading-none">

        {/* Navigation */}
        <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1 justify-center">
          {groups.map((group, gi) => (
            <React.Fragment key={group}>
              {gi > 0 && <div className="w-px h-4 bg-theme-border mx-0.5 sm:mx-1 shrink-0" />}
              {navItems.filter(n => n.group === group).map(item => {
                const isActive = view === item.id;
                const colors = colorMap[item.activeColor];
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id as any); setSearchQuery(''); }}
                    className={cn(
                      'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black transition-all whitespace-nowrap shrink-0',
                      isActive ? colors.active : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04]'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                    {item.count != null && item.count > 0 && (
                      <span className={cn(
                        'text-[9px] px-1.5 py-0.5 rounded font-black',
                        isActive ? colors.badge : 'bg-white/10 text-white/40'
                      )}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          {/* Checklist button */}
          <div className="w-px h-4 bg-theme-border mx-0.5 sm:mx-1 shrink-0" />
          <button
            onClick={() => setShowMasterChecklist(true)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black text-theme-text-muted hover:text-orange-400 hover:bg-orange-500/[0.06] transition-all whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="hidden md:inline">체크리스트</span>
          </button>
        </nav>

        {/* Right: status + settings */}
        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && (
            <div className="hidden lg:flex flex-col items-end leading-none gap-0.5">
              <span className="text-[8px] font-black text-theme-text-muted uppercase tracking-[0.15em]">마지막 업데이트</span>
              <span className="text-[10px] font-black text-theme-text-secondary tabular-nums">
                {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.06] transition-all border border-transparent hover:border-theme-border"
            title="설정"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
}
