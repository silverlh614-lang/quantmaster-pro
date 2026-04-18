/**
 * Neo-Brutalism Sidebar
 * Bold border-right, thick accent indicators, uppercase group labels.
 */
import React, { useMemo } from 'react';
import {
  Zap, ShieldCheck, Settings,
} from 'lucide-react';
import { cn } from '../ui/cn';
import { useSettingsStore, useRecommendationStore, useTradeStore, useMarketStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { NAV_GROUPS } from '../config';
import type { TradeRecord } from '../types/quant';

interface SidebarProps {
  /** 드로어 안에서 렌더될 때는 자체 fixed 포지셔닝 대신 부모 컨테이너를 채운다. */
  asDrawer?: boolean;
}

export function Sidebar({ asDrawer = false }: SidebarProps = {}) {
  const { view, setView, setShowSettings, setShowMasterChecklist } = useSettingsStore();
  const { watchlist, setSearchQuery, lastUpdated } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { syncStatus } = useMarketStore();
  const { shadowTrades } = useShadowTradeStore();

  const openTradesCount = tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length;

  /** Merge dynamic badge counts into the static nav config */
  const countMap: Partial<Record<string, number>> = useMemo(() => ({
    WATCHLIST: (watchlist || []).length,
    TRADE_JOURNAL: openTradesCount,
    AUTO_TRADE: shadowTrades.length,
  }), [watchlist, openTradesCount, shadowTrades.length]);

  return (
    <aside
      className={cn(
        'neo-sidebar no-scrollbar no-print',
        asDrawer ? 'app-sidebar-drawer' : 'app-sidebar',
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b-2 border-slate-700/30 shrink-0 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/[0.03] to-transparent pointer-events-none" />
        <button
          onClick={() => { setView('DISCOVER' as any); setSearchQuery(''); }}
          className="flex items-center gap-3 group/logo relative z-[1]"
        >
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover/logo:shadow-blue-500/40 transition-all group-hover/logo:scale-105 border-2 border-blue-400/30">
              <Zap className="w-5 h-5 text-white" />
            </div>
            {syncStatus.isSyncing && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[var(--bg-elevated)] animate-pulse" />
            )}
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-black text-theme-text tracking-tight">QuantMaster</span>
            <span className="text-[10px] font-black text-gradient-blue">PRO</span>
          </div>
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 py-4 px-3 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-2">
              <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em]">
                {group.label}
              </span>
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = view === item.id;
                const Icon = item.icon;
                const count = countMap[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id as any); setSearchQuery(''); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold transition-all group/nav relative',
                      isActive
                        ? 'bg-gradient-to-r from-blue-500/[0.12] to-indigo-500/[0.06] text-blue-300 border border-blue-500/20 shadow-[2px_2px_0px_rgba(0,0,0,0.2)]'
                        : 'text-theme-text-secondary hover:text-theme-text hover:bg-white/[0.04]'
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-to-b from-blue-400 to-indigo-500" />
                    )}
                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-blue-400' : 'text-theme-text-muted group-hover/nav:text-theme-text-secondary')} />
                    <span className="truncate">{item.label}</span>
                    {count != null && count > 0 && (
                      <span className={cn(
                        'ml-auto text-[10px] font-black px-1.5 py-0.5 rounded-md font-num border',
                        isActive
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          : 'bg-white/[0.04] text-theme-text-muted border-white/[0.06]'
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Actions */}
      <div className="border-t-2 border-slate-700/30 p-3 space-y-1 shrink-0">
        <button
          onClick={() => setShowMasterChecklist(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-theme-text-muted hover:text-blue-300 hover:bg-blue-500/[0.06] transition-all"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>체크리스트</span>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/[0.04] transition-all"
        >
          <Settings className="w-4 h-4" />
          <span>설정</span>
        </button>

        {/* Last Updated */}
        {lastUpdated && (
          <div className="px-3 pt-2 flex flex-col gap-0.5">
            <span className="text-[9px] font-black text-theme-text-muted uppercase tracking-[0.15em]">마지막 업데이트</span>
            <span className="text-[11px] font-bold text-theme-text-secondary font-num">
              {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
